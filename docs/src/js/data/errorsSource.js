/**
 * Single source of truth for where the error catalog is fetched from.
 *
 * The catalog (`errors/index.json`) and the per-code `.md` files live at the
 * repo root. This docs app loads them live from GitHub at request time rather
 * than bundling a snapshot, so a code added upstream shows up without a docs
 * redeploy.
 *
 * REF is the branch these are read from. It currently points at `epic/329`
 * because the error story has not merged to `main` yet — `errors/index.json`
 * does not exist on `main` today. Flip REF to `"main"` in the same change that
 * repoints catalyst-core's `getDocUrl()` at this docs site (issue #362, PR D),
 * once epic/329 has merged.
 */

export const GITHUB_REPO = 'tata1mg/catalyst-core'

// TODO(#362): change to "main" once epic/329 merges (do it with the getDocUrl flip).
export const ERRORS_REF = 'epic/329'

/** Raw JSON index — fetched by the /errors route. */
export const ERRORS_INDEX_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/${ERRORS_REF}/errors/index.json`

/** Human-facing blob URL for one code's generated markdown. */
export function githubBlobUrlFor(category, code) {
    if (!category || !code) {
        return `https://github.com/${GITHUB_REPO}/tree/${ERRORS_REF}/errors`
    }
    return `https://github.com/${GITHUB_REPO}/blob/${ERRORS_REF}/errors/${category}/${code}.md`
}
