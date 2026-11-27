import express from 'express'
import path from 'path'
import expressStaticGzip from 'express-static-gzip'

// Server middlewares are added here.

// The SSR shell ships inline bootstrap scripts and styles, so script-src and
// style-src need 'unsafe-inline'. The policy still blocks scripts from other
// origins, plugins, <base> hijacking, form posts and fetches to other
// origins, and framing by other sites. Every origin below is one the site
// loads today:
//   img-src     onemg.gumlet.io                  landing and social images
//               img.youtube.com, placehold.co    video thumbnails (VideoLinkGrid)
//               github.com, avatars.githubusercontent.com
//                                                contributor avatars on release
//                                                pages (github.com/<login>.png
//                                                redirects to avatars.*)
//   media-src   github.com, release-assets.githubusercontent.com
//                                                release films (release-pages.json;
//                                                /releases/download redirects to
//                                                release-assets.*)
//   connect-src raw.githubusercontent.com        error catalogue (data/errorsSource.js)
//               cloudflareinsights.com           Cloudflare Web Analytics beacon
//   script-src  static.cloudflareinsights.com    Cloudflare Web Analytics script,
//                                                injected at the edge
// Production only: the dev build loads assets and hot updates from the
// webpack dev server on another port.
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://onemg.gumlet.io https://img.youtube.com https://placehold.co https://github.com https://avatars.githubusercontent.com",
    "media-src 'self' https://github.com https://release-assets.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' https://raw.githubusercontent.com https://cloudflareinsights.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
].join('; ')

const PERMISSIONS_POLICY = [
    'accelerometer=()',
    'camera=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
].join(', ')

// The docs are public and fully same-origin (assets, search, pages), so no
// cross-origin caller needs access. Pin CORS to the site itself and to
// read-only methods instead of a wildcard. If a proxy in front of the app
// also injects `Access-Control-Allow-Origin: *`, that rule has to be removed
// there: this header cannot override a value added after the app responds.
const SITE_ORIGIN = (
    process.env.SITE_URL || 'https://catalyst.1mg.com'
).replace(/\/$/, '')

// X-Frame-Options and X-Content-Type-Options are not set here: the nginx in
// front of catalyst.1mg.com already adds both, and sending them from the app
// too produced duplicate headers. Framing is also covered by the CSP's
// frame-ancestors, which applies to every response.
export function securityHeaders(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', SITE_ORIGIN)
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    res.vary('Origin')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY)
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    }
    next()
}

export function addMiddlewares(app) {
    app.disable('x-powered-by')
    app.use(securityHeaders)

    function stripPrefix(req, prefix) {
        const path = '/' + req.path.slice(prefix.length).replace(/^[/\\]+/, '')
        const qs = req.originalUrl.indexOf('?')
        return qs === -1 ? path : path + req.originalUrl.slice(qs)
    }

    // The Docusaurus site this replaced was mounted under /public_docs, and
    // every indexed URL carries that prefix (catalyst.1mg.com/public_docs/content/...).
    // This app serves the same permalinks at the root, so the old prefix has to
    // keep resolving or the whole search index breaks.
    app.use((req, res, next) => {
        if (
            req.path === '/public_docs' ||
            req.path.startsWith('/public_docs/')
        ) {
            return res.redirect(301, stripPrefix(req, '/public_docs'))
        }
        next()
    })

    // The private mount is gone — everything is public now. Its URLs were
    // indexed too, and the content behind them still exists at the same
    // permalink, so send them to the public copy rather than 404ing.
    app.use((req, res, next) => {
        if (
            req.path === '/private_docs' ||
            req.path.startsWith('/private_docs/')
        ) {
            return res.redirect(301, stripPrefix(req, '/private_docs'))
        }
        next()
    })

    // Legacy entry point → first docs page.
    app.get(['/docs', '/docs/'], (req, res) => {
        res.redirect(301, '/content/Introduction/why-catalyst')
    })

    // The changelog page used to be called Releases; /releases is now the
    // release announcements, so the old changelog URL follows the page.
    app.get(['/content/releases', '/content/releases/'], (req, res) => {
        res.redirect(301, '/content/changelog')
    })

    // Pages the old docs platform shipped that this site does not: admin
    // surfaces, and two Docusaurus starter pages that were never real content.
    // They are all in the live sitemap, so answer deliberately (410 Gone)
    // rather than letting them fall through to a soft 404.
    app.get(
        [
            '/jwt-gen',
            '/servicelist',
            '/access',
            '/create',
            '/create-doc',
            '/blog',
            '/markdown-page',
        ],
        (req, res) => {
            res.status(410)
                .type('text/plain')
                .send('This page has been removed.')
        }
    )

    // SEO files (generated into public/ by scripts/generate-docs-manifest.mjs).
    app.get('/sitemap.xml', (req, res) => {
        res.type('application/xml')
        res.sendFile(path.join(__dirname, '../public/sitemap.xml'))
    })
    app.get('/robots.txt', (req, res) => {
        res.type('text/plain')
        res.sendFile(path.join(__dirname, '../public/robots.txt'))
    })

    if (process.env.NODE_ENV === 'production') {
        app.use(
            `${process.env.PUBLIC_STATIC_ASSET_PATH}/client`,
            expressStaticGzip(
                path.join(
                    __dirname,
                    `../${process.env.BUILD_OUTPUT_PATH}/client`
                ),
                {
                    enableBrotli: true,
                    orderPreference: ['br', 'gz'],
                    serveStatic: { maxAge: '1y', etag: true },
                }
            )
        )
    }

    // Docs image assets (generated into public/ by scripts/generate-docs-manifest.mjs).
    app.use(
        '/img',
        express.static(path.join(__dirname, '../public/img'), { maxAge: '1d' })
    )
    app.use(
        '/docs-assets',
        express.static(path.join(__dirname, '../public/docs-assets'), {
            maxAge: '1d',
        })
    )
    // Older versions keep the same layout under /v/<major>/. Misses fall
    // through to the router, which owns /v/<major>/content/... pages.
    app.use(
        '/v',
        express.static(path.join(__dirname, '../public/v'), { maxAge: '1d' })
    )

    // Browsers request /favicon.ico regardless of the <link rel="icon">, and the
    // icon only exists under the generated img/ tree — express.static needs a
    // directory root, so serve the file directly.
    app.get('/favicon.ico', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/img/favicon.ico'))
    })
}
