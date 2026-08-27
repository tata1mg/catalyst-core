import React from 'react'
import { Head, Body } from 'catalyst-core'

// Carried over from the Docusaurus config's headTags — without these every
// shared link loses its social card.
const SOCIAL_PREVIEW_IMAGE =
    'https://onemg.gumlet.io/staging/2fdb0975-8f51-4fd1-bd7d-6375d793f581.svg'
const SITE_URL = (process.env.SITE_URL || 'https://catalyst.1mg.com').replace(
    /\/$/,
    ''
)

function Document(props) {
    // Both /content/faqs and /content/faqs/ serve the same page, so without a
    // canonical the two forms compete as duplicates in the index. Normalize to
    // the slash-less form the sitemap advertises.
    const rawPath = (props?.req?.originalUrl || '/').split('?')[0].split('#')[0]
    const canonicalPath =
        rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath

    return (
        <html lang="en">
            <Head {...props}>
                <link rel="canonical" href={`${SITE_URL}${canonicalPath}`} />
                <link rel="icon" href="/img/favicon.ico" />
                <meta property="og:type" content="website" />
                <meta
                    property="og:url"
                    content={`${SITE_URL}${canonicalPath}`}
                />
                <meta property="og:image" content={SOCIAL_PREVIEW_IMAGE} />
                <meta
                    property="og:image:secure_url"
                    content={SOCIAL_PREVIEW_IMAGE}
                />
                <meta property="og:image:type" content="image/svg+xml" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:image" content={SOCIAL_PREVIEW_IMAGE} />
            </Head>
            <Body {...props} />
        </html>
    )
}
export default Document
