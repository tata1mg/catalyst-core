import manifest from '../../generated/docsManifest.json'

/** Release pages from release-pages.json, newest first (generator order). */
export const RELEASES = manifest.filter((page) => page.kind === 'release')

export const LATEST_RELEASE = RELEASES[0]

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
]

/**
 * "2026-10-22" -> "22 October 2026". Formatted by hand rather than with
 * toLocaleDateString so the server and the browser render the same text.
 */
export const formatDate = (isoDate) => {
    const [year, month, day] = isoDate.split('-').map(Number)
    return `${day} ${MONTHS[month - 1]} ${year}`
}

export const githubReleaseUrl = (tag) =>
    `https://github.com/tata1mg/catalyst-core/releases/tag/${encodeURIComponent(tag)}`

export const npmUrl = (version) =>
    `https://www.npmjs.com/package/catalyst-core/v/${version}`
