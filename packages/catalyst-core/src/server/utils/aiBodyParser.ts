import bodyParser from "body-parser"

// Image and audio requests to the AI route are far larger than body-parser's 100 kb default, so the AI path gets its own
// JSON parser with a bigger limit. It is mounted BEFORE the global parser, which skips bodies that are already parsed.
// Every other route keeps the default limit. AI_CONFIG.maxRequestMB overrides the 20 MB default (Gemini's inline
// request limit is about 20 MB, so more would be rejected upstream anyway).

const DEFAULT_LIMIT_MB = 20
const MAX_LIMIT_MB = 100

export function parseAIConfig(raw: string | undefined): Record<string, any> {
    try {
        const parsed = JSON.parse(raw || "{}")
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

/** { basePath, limit } for the AI body parser, or null when AI is disabled. */
export function resolveAIBodyConfig(aiConfig: Record<string, any>): { basePath: string; limit: string } | null {
    if (aiConfig?.enabled === false) return null
    const requested = aiConfig?.maxRequestMB
    const megabytes =
        typeof requested === "number" && Number.isFinite(requested) && requested > 0 && requested <= MAX_LIMIT_MB
            ? requested
            : DEFAULT_LIMIT_MB
    return { basePath: aiConfig?.basePath || "/ai", limit: `${megabytes}mb` }
}

export function mountAIBodyParser(app: { use: (...args: any[]) => unknown }, aiConfig: Record<string, any>) {
    const resolved = resolveAIBodyConfig(aiConfig)
    if (!resolved) return
    app.use(resolved.basePath, bodyParser.json({ limit: resolved.limit }))
}
