import express from 'express'
import path from 'path'
import expressStaticGzip from 'express-static-gzip'
import { mountAnthropicAI } from './aiAnthropic.js'
import legacyDocUrls from './legacyDocUrls.js'

// Server middlewares are added here.

export function addMiddlewares(app) {
    // catalyst-ai only knows about openai and gemini. These routes claim
    // /ai/anthropic/* first — catalyst-core runs addMiddlewares before it
    // mounts the catalyst-ai router, and Express matches in registration
    // order, so the other providers are unaffected. See server/aiAnthropic.js.
    mountAnthropicAI(app)

    // Mount prefixes the old docs platform served under. None of them is a
    // real path in this app; each is only ever stripped off the front.
    const LEGACY_PREFIXES = ['/public_docs', '/private_docs', '/docs']

    /** `req.path` with `prefix` removed, original query string reattached. */
    function stripPrefix(req, prefix) {
        const path = '/' + req.path.slice(prefix.length).replace(/^[/\\]+/, '')
        const qs = req.originalUrl.indexOf('?')
        return qs === -1 ? path : path + req.originalUrl.slice(qs)
    }

    /** `req.originalUrl`'s query string (including `?`), or '' when there is none. */
    function queryString(req) {
        const qs = req.originalUrl.indexOf('?')
        return qs === -1 ? '' : req.originalUrl.slice(qs)
    }

    /**
     * The permalink a request is really asking for: any legacy mount prefix
     * removed, percent-decoding applied so the space-bearing Docusaurus-era
     * paths ("/content/Guides and Tutorials/…", which crawlers send as %20)
     * match the map's keys, and a trailing slash dropped. Returns null when the
     * path can't be decoded, so a malformed URL falls through untouched instead
     * of throwing.
     */
    function legacyLookupPath(reqPath) {
        let candidate = reqPath
        for (const prefix of LEGACY_PREFIXES) {
            if (candidate === prefix || candidate.startsWith(`${prefix}/`)) {
                candidate =
                    '/' + candidate.slice(prefix.length).replace(/^[/\\]+/, '')
                break
            }
        }
        try {
            candidate = decodeURIComponent(candidate)
        } catch {
            return null
        }
        return candidate.length > 1 ? candidate.replace(/\/$/, '') : candidate
    }

    // The restructure that regrouped content/ (category folders kebab-cased,
    // several pages moved to new categories, a few slugs rewritten) changed the
    // URL of most pages. Those old URLs were live and indexed right up until it
    // landed, and nothing serves them now — the prefix strips below would only
    // turn a prefixed one into an unprefixed 404. So resolve them here first,
    // in a single 301 straight to the page's current home, for both the bare
    // "/content/…" form and every legacy-prefixed form. See legacyDocUrls.js.
    //
    // Deliberately narrow: only exact keys from that map redirect. A URL that
    // was never valid, or one that is already current, falls through with its
    // behavior unchanged.
    app.use((req, res, next) => {
        const target = legacyDocUrls.get(legacyLookupPath(req.path))
        if (!target) return next()
        return res.redirect(301, `${target}${queryString(req)}`)
    })

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
        res.redirect(301, '/content/introduction/why-catalyst')
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

    // Browsers request /favicon.ico regardless of the <link rel="icon">, and the
    // icon only exists under the generated img/ tree — express.static needs a
    // directory root, so serve the file directly.
    app.get('/favicon.ico', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/img/favicon.ico'))
    })
}
