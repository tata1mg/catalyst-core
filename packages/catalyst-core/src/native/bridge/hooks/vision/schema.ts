// Structured output for useVision. A small JSON-Schema subset (enough to describe a form or a report), validated
// here instead of pulling in a validator: the prompt asks the model for JSON, and small on-device models often
// answer with prose, code fences or a wrong field, so the reply must be parsed and checked before the app sees it.

export type JsonType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"

export interface Schema {
    type?: JsonType | JsonType[]
    description?: string
    properties?: Record<string, Schema>
    required?: string[]
    items?: Schema
    enum?: unknown[]
    /** Shorthand for a type that may also be null (a value the page does not show). */
    nullable?: boolean
}

const typeOf = (value: unknown): JsonType =>
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object" : (typeof value as JsonType)

function matchesType(value: unknown, type: JsonType): boolean {
    if (type === "integer") return typeof value === "number" && Number.isInteger(value)
    if (type === "number") return typeof value === "number" && Number.isFinite(value)
    return typeOf(value) === type
}

/** Problems with `value` against `schema`, as readable lines. Empty means valid. */
export function validate(schema: Schema, value: unknown, path = "$"): string[] {
    const problems: string[] = []
    const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type]
    const allowed = schema.nullable ? [...types, "null" as JsonType] : types
    if (allowed.length && !allowed.some((t) => matchesType(value, t))) {
        problems.push(`${path} should be ${allowed.join(" or ")}, got ${typeOf(value)}`)
        return problems
    }
    if (schema.enum && !schema.enum.some((e) => e === value)) {
        problems.push(`${path} should be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}, got ${JSON.stringify(value)}`)
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>
        for (const key of schema.required ?? []) {
            if (!(key in record)) problems.push(`${path}.${key} is missing`)
        }
        for (const [key, child] of Object.entries(schema.properties ?? {})) {
            if (key in record) problems.push(...validate(child, record[key], `${path}.${key}`))
        }
    }
    if (Array.isArray(value) && schema.items) {
        value.forEach((item, i) => problems.push(...validate(schema.items as Schema, item, `${path}[${i}]`)))
    }
    return problems
}

/** The prompt that asks for the schema's shape and nothing else. */
export function buildPrompt(schema: Schema, instructions?: string): string {
    return [
        instructions?.trim() || "Read the image and extract the requested information.",
        "Reply with ONLY a JSON value that matches this JSON Schema. No prose, no explanation, no code fences.",
        "If a value is not visible in the image, use null for it when the schema allows that; never invent one.",
        JSON.stringify(schema),
    ].join("\n\n")
}

// One shape rather than a union: the package builds without `strict`, where a boolean tag does not narrow.
export interface Extracted {
    ok: boolean
    value?: unknown
    error?: string
}

/**
 * Fixes the two slips small models make most when writing JSON, outside string values only (text inside a string is
 * never touched): a key left without a value (`"title":,` -> `"title":null`) and a trailing comma (`[1,2,]`).
 * Used only after a strict parse has failed, and the result is still validated against the schema, so a `null` that the
 * schema does not allow is reported as a problem rather than accepted.
 */
export function repairJson(text: string): string {
    let out = ""
    let inString = false
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inString) {
            out += ch
            if (ch === "\\") out += text[++i] ?? ""
            else if (ch === '"') inString = false
            continue
        }
        if (ch === '"') {
            inString = true
            out += ch
            continue
        }
        const next = () => {
            let j = i + 1
            while (j < text.length && /\s/.test(text[j])) j++
            return text[j]
        }
        if (ch === ":" && (next() === "," || next() === "}" || next() === "]")) out += ":null"
        else if (ch === "," && (next() === "}" || next() === "]")) continue
        else out += ch
    }
    return out
}

/**
 * Pulls one JSON value out of a model reply: the whole text, a fenced block, or the first balanced {...} / [...]
 * (a model that explains itself before or after the JSON still yields it). If none parses as it stands, the same
 * candidates are tried again after repairJson.
 */
export function extractJson(text: string): Extracted {
    const trimmed = (text ?? "").trim()
    if (!trimmed) return { ok: false, error: "the reply was empty" }
    const candidates = [trimmed]
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
    if (fenced) candidates.push(fenced[1].trim())
    const balanced = firstBalanced(trimmed)
    if (balanced) candidates.push(balanced)
    for (const candidate of candidates) {
        try {
            return { ok: true, value: JSON.parse(candidate) }
        } catch {
            // try the next candidate
        }
    }
    for (const candidate of candidates) {
        try {
            return { ok: true, value: JSON.parse(repairJson(candidate)) }
        } catch {
            // nothing usable in this one either
        }
    }
    // A reply that opens a JSON value and never closes it ran out of room (the model's output limit), which needs a different
    // fix from a typo: say so, so neither the developer nor the retry is told to "fill in a blank field".
    if (trimmed.search(/[{[]/) !== -1 && !firstBalanced(trimmed)) {
        return { ok: false, error: "the reply was cut off before the JSON was complete (it hit the output limit): raise genConfig.maxTokens, and keep text fields short" }
    }
    return { ok: false, error: "the reply was not valid JSON (every field needs a value: use null or an empty string, never leave one blank)" }
}

function firstBalanced(text: string): string | null {
    const start = text.search(/[{[]/)
    if (start === -1) return null
    const open = text[start]
    const close = open === "{" ? "}" : "]"
    let depth = 0
    let inString = false
    for (let i = start; i < text.length; i++) {
        const ch = text[i]
        if (inString) {
            if (ch === "\\") i++
            else if (ch === '"') inString = false
        } else if (ch === '"') inString = true
        else if (ch === open) depth++
        else if (ch === close && --depth === 0) return text.slice(start, i + 1)
    }
    return null
}

/** What the model is told when its reply failed, so the second attempt can fix the specific problem. */
export function correctionPrompt(problems: string[]): string {
    return `That reply was not usable: ${problems.slice(0, 6).join("; ")}. Reply again with ONLY the JSON value, nothing else.`
}
