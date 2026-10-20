/**
 * Critical (first-fold) CSS extraction — shared by the build-time generator and analysis tooling.
 *
 * The original CSS text is parsed with postcss (so vendor-prefixed declarations that Chrome would
 * drop from the CSSOM survive), every selector is reduced to a "matchable" form, and a headless
 * browser answers two questions per selector: does it match anything, and does it match anything
 * above the fold. Pruning then keeps rules — in their original order — that match above the fold in
 * at least one measured viewport.
 */
import postcss from "postcss"

// Pseudo-elements never match querySelector; state pseudo-classes depend on interaction.
// Removing them makes a selector match *more*, which is the safe direction for critical CSS.
const PSEUDO_ELEMENT = /::[\w-]+(\([^)]*\))?|:(before|after|first-line|first-letter)\b/gi
const STATE_PSEUDO =
    /:(hover|focus-visible|focus-within|focus|active|visited|target|link|any-link|placeholder-shown|autofill|-webkit-autofill|checked|disabled|enabled|indeterminate|default|valid|invalid|required|optional|read-only|read-write|empty)(?![\w-])/gi

export const matchableSelector = (selector) => {
    let s = selector.replace(PSEUDO_ELEMENT, "").replace(STATE_PSEUDO, "")
    s = s.replace(/:(not|is|where|has)\(\s*\)/g, "").trim()
    if (!s || /[>+~]$/.test(s)) s = `${s} *`.trim()
    return s
}

const isInKeyframes = (node) => {
    for (let p = node.parent; p; p = p.parent) {
        if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true
    }
    return false
}

export const parseCss = (text, from) => postcss.parse(text, { from })

/** Unique selectors / media / supports conditions a browser must evaluate for these roots. */
export const collectQueries = (roots) => {
    const selectors = new Set()
    const media = new Set()
    const supports = new Set()
    for (const root of roots) {
        root.walkRules((rule) => {
            if (isInKeyframes(rule)) return
            for (const sel of rule.selectors) selectors.add(matchableSelector(sel))
        })
        root.walkAtRules((at) => {
            if (at.name === "media") media.add(at.params)
            else if (at.name === "supports") supports.add(at.params)
        })
    }
    return { selectors: [...selectors], media: [...media], supports: [...supports] }
}

/**
 * Runs inside the page (page.evaluate). Must stay self-contained.
 * An element counts as above the fold when its top edge (document coordinates) is above foldHeight.
 * Elements that are not rendered (display:none → empty rect at 0,0) count too, so rules that hide
 * first-fold elements are kept.
 */
export function matchInPage({ selectors, media, supports, foldHeight }) {
    const seen = new Map()
    const above = (el) => {
        let v = seen.get(el)
        if (v === undefined) {
            const r = el.getBoundingClientRect()
            v = r.top + window.scrollY < foldHeight
            seen.set(el, v)
        }
        return v
    }
    const sel = {}
    for (const s of selectors) {
        try {
            const els = document.querySelectorAll(s)
            let a = false
            for (const el of els) {
                if (above(el)) {
                    a = true
                    break
                }
            }
            sel[s] = [els.length > 0 ? 1 : 0, a ? 1 : 0]
        } catch {
            // Unknown to this browser (e.g. a -moz- pseudo-class): keep it rather than guess.
            sel[s] = [1, 1]
        }
    }
    const m = {}
    for (const q of media) m[q] = window.matchMedia(q).matches
    const sup = {}
    for (const q of supports) {
        try {
            sup[q] = CSS.supports(q)
        } catch {
            sup[q] = true
        }
    }
    return { sel, media: m, supports: sup, viewport: { width: innerWidth, height: innerHeight }, foldHeight }
}

const contextApplies = (node, result) => {
    for (let p = node.parent; p && p.type !== "root"; p = p.parent) {
        if (p.type !== "atrule") continue
        if (p.name === "media" && result.media[p.params] === false) return false
        if (p.name === "supports" && result.supports[p.params] === false) return false
    }
    return true
}

const ANIMATION_NAME = /(?:^|[\s,])([-\w]+)(?=[\s,]|$)/g

/**
 * Keep only rules that matched in at least one viewport result.
 * @param {postcss.Root} root
 * @param {object[]} results - matchInPage() outputs (one per viewport/URL)
 * @param {"above"|"any"} mode - "above" = first fold, "any" = used anywhere on the page
 * @returns {{ css: string, keptRules: number, totalRules: number }}
 */
export const pruneRoot = (root, results, mode = "above") => {
    const idx = mode === "above" ? 1 : 0
    const out = root.clone()
    let totalRules = 0
    let keptRules = 0
    out.walkRules((rule) => {
        if (isInKeyframes(rule)) return
        totalRules++
        const keep = results.some(
            (r) => contextApplies(rule, r) && rule.selectors.some((s) => r.sel[matchableSelector(s)]?.[idx])
        )
        if (keep) keptRules++
        else rule.remove()
    })
    // Drop now-empty grouping at-rules (repeat for nesting).
    for (let changed = true; changed; ) {
        changed = false
        out.walkAtRules((at) => {
            if (["media", "supports", "layer", "container"].includes(at.name) && at.nodes && at.nodes.length === 0) {
                at.remove()
                changed = true
            }
        })
    }
    // Keep @keyframes only when a kept declaration animates with them.
    const used = new Set()
    out.walkDecls(/^(-webkit-)?animation(-name)?$/i, (d) => {
        for (const m of d.value.matchAll(ANIMATION_NAME)) used.add(m[1])
    })
    out.walkAtRules(/keyframes$/i, (at) => {
        if (!used.has(at.params.trim())) at.remove()
    })
    // Keep @font-face only for families the kept CSS mentions (directly or through a custom property).
    const faces = []
    out.walkAtRules("font-face", (at) => faces.push(at))
    if (faces.length) {
        const rest = out.clone()
        rest.walkAtRules("font-face", (at) => at.remove())
        const text = rest.toString().toLowerCase()
        for (const at of faces) {
            let family = ""
            at.walkDecls("font-family", (d) => {
                family = d.value.replace(/["']/g, "").trim().toLowerCase()
            })
            if (family && !text.includes(family)) at.remove()
        }
    }
    return { css: out.toString(), keptRules, totalRules }
}
