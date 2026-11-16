import React from 'react'
import { Head, Body } from 'catalyst-core'
import manifest from '../src/js/generated/docsManifest.json'

// Carried over from the Docusaurus config's headTags — without these every
// shared link loses its social card.
const SOCIAL_PREVIEW_IMAGE =
    'https://onemg.gumlet.io/staging/2fdb0975-8f51-4fd1-bd7d-6375d793f581.svg'
const SITE_URL = (process.env.SITE_URL || 'https://catalyst.1mg.com').replace(
    /\/$/,
    ''
)
// originalUrl is percent-encoded; manifest URLs are not (53 old pages have spaces).
const CANONICAL_BY_PATH = new Map(
    manifest.map((page) => [encodeURI(page.url), encodeURI(page.canonical)])
)
// Release pages share their film's poster and the film itself, so a link
// posted for a release unfurls with that release's card. A release without a
// film keeps the site's card.
const RELEASE_BY_PATH = new Map(
    manifest
        .filter((page) => page.kind === 'release' && page.release.video)
        .map((page) => [encodeURI(page.url), page.release])
)

function Document(props) {
    // Both /content/faqs and /content/faqs/ serve the same page, so without a
    // canonical the two forms compete as duplicates in the index. Normalize to
    // the slash-less form the sitemap advertises.
    const rawPath = (props?.req?.originalUrl || '/').split('?')[0].split('#')[0]
    const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath
    // Older versions point their canonical at the latest page they came from.
    const canonicalPath = CANONICAL_BY_PATH.get(path) ?? path
    const release = RELEASE_BY_PATH.get(path)
    const image = release
        ? `${SITE_URL}${release.poster}`
        : SOCIAL_PREVIEW_IMAGE

    return (
        <html lang="en">
            <Head {...props}>
                <link rel="canonical" href={`${SITE_URL}${canonicalPath}`} />
                {/^\/v\/\d+\//.test(path) && (
                    <meta name="robots" content="noindex" />
                )}
                <link rel="icon" href="/img/favicon.ico" />
                <meta property="og:type" content="website" />
                <meta
                    property="og:url"
                    content={`${SITE_URL}${canonicalPath}`}
                />
                <meta property="og:image" content={image} />
                <meta property="og:image:secure_url" content={image} />
                <meta
                    property="og:image:type"
                    content={release ? 'image/jpeg' : 'image/svg+xml'}
                />
                {release && (
                    <meta property="og:video" content={release.video} />
                )}
                {release && (
                    <meta property="og:video:type" content="video/mp4" />
                )}
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:image" content={image} />
            </Head>
            <Body {...props} />
        </html>
    )
}
export default Document
