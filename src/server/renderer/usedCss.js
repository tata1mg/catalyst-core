/**
 * Used CSS — inline only the CSS rules the server-rendered HTML uses.
 *
 * Each built CSS file is parsed once per process and split into "units" (style rules, @font-face,
 * @keyframes, other at-rules) in source order, each style rule indexed by the classes and ids its
 * selectors require. While the HTML streams out, the class and id names in it are collected; a rule
 * is used when every class and id in at least one of its selectors appears in the document. Element,
 * attribute and pseudo parts are ignored and :not()/:is()/:where()/:has() arguments are not required,
 * so matching can over-include but never drops a rule the markup needs.
 *
 * <head> is streamed before the body is rendered, so the head carries the rules this route has used on
 * earlier requests (learned per route pattern, across logged-in and anonymous variants). Rules a
 * request uses that the route has not seen yet are sent in a <style> after the body and learned.
 */
import fs from "fs"
import path from "path"
import postcss from "postcss"

// ── Selector tokens ────────────────────────────────────────────────────

const FUNCTIONAL_PSEUDO = /:(?:not|is|where|has|matches|-webkit-any|-moz-any)\((?:[^()]|\([^()]*\))*\)/g
const ATTRIBUTE = /\[[^\]]*\]/g
const unescapeCss = (s) => s.replace(/\\(.)/g, "$1")

/** Classes and ids a selector requires on some element; empty = matches any document. */
export const selectorTokens = (selector) => {
    const s = selector.replace(ATTRIBUTE, "").replace(FUNCTIONAL_PSEUDO, "")
    return {
        classes: [...s.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => unescapeCss(m[1])),
        ids: [...s.matchAll(/#((?:\\.|[\w-])+)/g)].map((m) => unescapeCss(m[1])),
    }
}

// ── Per-file rule index (parsed once per process) ──────────────────────

const GROUPING = /^(media|supports|layer|container)$/i
const ANIMATION_NAME = /(?:^|[\s,])([-\w]+)(?=[\s,]|$)/g

const indexCss = (text, from) => {
    const units = []
    const visit = (parent, context) => {
        parent.each((node) => {
            if (node.type === "rule") {
                const animations = []
                node.walkDecls(/^(-webkit-)?animation(-name)?$/i, (d) => {
                    for (const m of d.value.matchAll(ANIMATION_NAME)) animations.push(m[1])
                })
                units.push({
                    kind: "rule",
                    context,
                    css: node.toString(),
                    alternatives: node.selectors.map(selectorTokens),
                    animations,
                })
            } else if (node.type === "atrule") {
                if (GROUPING.test(node.name) && node.nodes) {
                    visit(node, [...context, `@${node.name} ${node.params}`])
                } else if (/keyframes$/i.test(node.name)) {
                    units.push({ kind: "keyframes", context, css: node.toString(), name: node.params.trim() })
                } else if (node.name === "font-face") {
                    let family = ""
                    node.walkDecls("font-family", (d) => (family = d.value.replace(/["']/g, "").trim().toLowerCase()))
                    units.push({ kind: "font-face", context, css: node.toString(), family })
                } else {
                    units.push({ kind: "always", context, css: node.toString() })
                }
            }
        })
    }
    visit(postcss.parse(text, { from }), [])
    return units
}

if (!process.usedCssIndex) process.usedCssIndex = new Map() // absolute path → units | null
const fileUnits = (filePath) => {
    if (!process.usedCssIndex.has(filePath)) {
        let units = null
        try {
            units = indexCss(fs.readFileSync(filePath, "utf8"), filePath)
        } catch {
            // unreadable file — callers fall back to linking it
        }
        process.usedCssIndex.set(filePath, units)
    }
    return process.usedCssIndex.get(filePath)
}

// ── Document tokens, collected from the streamed HTML ──────────────────

const ATTR = /\s(class|id)="([^"]*)"/g

/** Incremental scanner: feed HTML chunks, read .classes / .ids. Handles tags split across chunks. */
export const createTokenCollector = () => {
    const classes = new Set()
    const ids = new Set()
    let carry = ""
    const scan = (text) => {
        for (const m of text.matchAll(ATTR)) {
            if (m[1] === "id") ids.add(m[2])
            else for (const c of m[2].split(/\s+/)) if (c) classes.add(c)
        }
    }
    return {
        classes,
        ids,
        push(chunk) {
            const text = carry + chunk
            const lt = text.lastIndexOf("<")
            const open = lt !== -1 && text.indexOf(">", lt) === -1
            scan(open ? text.slice(0, lt) : text)
            carry = open ? text.slice(lt) : ""
        },
        end() {
            scan(carry)
            carry = ""
        },
    }
}

// ── Selecting and serialising units ────────────────────────────────────

const usedIndexes = (units, tokens) => {
    const used = new Set()
    const animations = new Set()
    units.forEach((u, i) => {
        // @font-face is selected here and dropped in serialise() unless the selected CSS names its family.
        if (u.kind === "always" || u.kind === "font-face") used.add(i)
        else if (
            u.kind === "rule" &&
            u.alternatives.some(
                (a) => a.classes.every((c) => tokens.classes.has(c)) && a.ids.every((id) => tokens.ids.has(id))
            )
        ) {
            used.add(i)
            u.animations.forEach((a) => animations.add(a))
        }
    })
    units.forEach((u, i) => {
        if (u.kind === "keyframes" && animations.has(u.name)) used.add(i)
    })
    return used
}

// Selected CSS text without @font-face, across all files of the render: decides which faces are kept.
const familyText = (parts) =>
    parts
        .flatMap(({ units, indexes }) => [...indexes].filter((i) => units[i].kind !== "font-face").map((i) => units[i].css))
        .join("")
        .toLowerCase()

const serialise = (units, indexes, text) => {
    let out = ""
    let stack = []
    const sorted = [...indexes].sort((a, b) => a - b)
    for (const i of sorted) {
        const u = units[i]
        if (u.kind === "font-face" && u.family && !text.includes(u.family)) continue
        let common = 0
        while (common < stack.length && common < u.context.length && stack[common] === u.context[common]) common++
        out += "}".repeat(stack.length - common)
        for (const c of u.context.slice(common)) out += `${c}{`
        stack = u.context
        out += u.css
    }
    return out + "}".repeat(stack.length)
}

// ── Per-route learned rules ────────────────────────────────────────────

if (!process.usedCssByRoute) process.usedCssByRoute = new Map() // routeKey → { files: Map<path, Set<i>>, version, cache }

const resolve = (cssPaths, buildDir) =>
    [...new Set(cssPaths)].filter((p) => p && !p.startsWith("http")).map((p) => ({
        rel: p,
        abs: path.isAbsolute(p) ? p : path.join(buildDir, p.replace(/^\/+/, "")),
    }))

/**
 * CSS learned for this route, ready to inline in <head>, or null when the route has not been rendered
 * yet in this process (the caller then inlines the full files and learns from this render).
 */
export const getLearnedUsedCss = (routeKey, cssPaths, buildDir) => {
    const rec = routeKey && process.usedCssByRoute.get(routeKey)
    if (!rec) return null
    const key = cssPaths.join("|")
    if (rec.cache?.key === key && rec.cache.version === rec.version) return rec.cache.css
    const parts = resolve(cssPaths, buildDir)
        .map(({ abs }) => ({ units: fileUnits(abs), indexes: rec.files.get(abs) }))
        .filter((p) => p.units && p.indexes)
    const text = familyText(parts)
    const css = parts.map((p) => serialise(p.units, p.indexes, text)).join("")
    rec.cache = { key, version: rec.version, css }
    return css
}

/**
 * After a render: learn the rules this document used and return the ones the route had not seen yet
 * (CSS to send after the body), plus files that could not be indexed.
 * @param {boolean} headHadLearnedCss - false on the route's first render (head carried full files)
 */
export const learnUsedCss = (routeKey, cssPaths, buildDir, tokens, headHadLearnedCss) => {
    if (!routeKey) return { lateCss: "" }
    let rec = process.usedCssByRoute.get(routeKey)
    if (!rec) {
        rec = { files: new Map(), version: 0, cache: null }
        process.usedCssByRoute.set(routeKey, rec)
    }
    const late = []
    const usedParts = []
    for (const { abs } of resolve(cssPaths, buildDir)) {
        const units = fileUnits(abs)
        if (!units) continue
        const used = usedIndexes(units, tokens)
        usedParts.push({ units, indexes: used })
        const learned = rec.files.get(abs) || new Set()
        const missing = new Set([...used].filter((i) => !learned.has(i)))
        if (missing.size) {
            missing.forEach((i) => learned.add(i))
            rec.files.set(abs, learned)
            rec.version++
            late.push({ units, indexes: missing })
        }
    }
    if (!headHadLearnedCss || !late.length) return { lateCss: "" }
    const text = familyText(usedParts)
    return { lateCss: late.map((p) => serialise(p.units, p.indexes, text)).join("") }
}

/** On when config.json has INLINE_USED_CSS_ENABLE: true and the matched route sets `inlineUsedCss: true`. */
export const isUsedCssRoute = (allMatches = []) =>
    String(process.env.INLINE_USED_CSS_ENABLE) === "true" && !!allMatches?.[allMatches.length - 1]?.route?.inlineUsedCss
