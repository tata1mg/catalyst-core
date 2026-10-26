import manifest from '../generated/docsManifest.json'

/**
 * Words that carry no signal in a docs query. Only stripped in relaxed mode —
 * the ⌘K palette keeps matching them literally, as it always has.
 */
const STOP_WORDS = new Set(
    `a about again all an and any are be between but can deeper do does
     explain for from give go has have how i in into is it its me more my of
     ok okay on or please should show so sure tell thanks that the their them
     there these this to up use used using was what when where which why will
     with work working works would yeah yep yes you your yup`.split(/\s+/)
)

const tokenize = (query) =>
    String(query || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)

/**
 * Relaxed terms: punctuation dropped, stop words removed, and camelCase
 * identifiers also contributed as their parts, so "how does serverFetcher
 * work" searches for serverfetcher/server/fetcher rather than for "how".
 */
const relaxedTerms = (query) => {
    const terms = new Set()
    for (const raw of tokenize(query)) {
        const word = raw.replace(/[^a-z0-9]+/gi, '')
        if (!word || STOP_WORDS.has(word)) continue
        terms.add(word)
        for (const part of raw.split(/[^a-zA-Z0-9]+|(?=[A-Z])/)) {
            const piece = part.toLowerCase()
            if (piece.length > 2 && !STOP_WORDS.has(piece)) terms.add(piece)
        }
    }
    return [...terms]
}

const countOccurrences = (haystack, term) => {
    let count = 0
    let index = haystack.indexOf(term)
    while (index !== -1 && count < 5) {
        count += 1
        index = haystack.indexOf(term, index + term.length)
    }
    return count
}

/**
 * In-browser docs search (same model as the docs site's local-search plugin):
 * the index is the build-time manifest; matching happens client-side.
 *
 * Default (strict) mode is the ⌘K palette's long-standing behaviour: a page
 * scores 10 for every query term found in its title and 1 for every term found
 * only in its body, and is dropped the moment a term is missing anywhere — so
 * every result contains every word typed.
 *
 * `relaxed: true` is for retrieval rather than for a dropdown: it strips stop
 * words, splits camelCase, and ranks by how many terms matched (and how often)
 * instead of demanding all of them. Natural-language questions such as "how
 * does server fetcher work" return nothing at all under strict matching, which
 * would leave the assistant ungrounded.
 */
const searchDocs = (query, { limit = 10, relaxed = false } = {}) => {
    const terms = relaxed ? relaxedTerms(query) : tokenize(query)
    if (!terms.length) return []

    return manifest
        .map((page) => {
            const title = page.title.toLowerCase()
            const body = page.searchText.toLowerCase()
            let score = 0
            for (const term of terms) {
                if (title.includes(term)) score += 10
                else if (relaxed) score += countOccurrences(body, term)
                else if (body.includes(term)) score += 1
                else return null
            }
            return score ? { page, score } : null
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.page)
}

export default searchDocs
