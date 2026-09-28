import express from 'express'
import path from 'path'
import expressStaticGzip from 'express-static-gzip'

// Server middlewares are added here.

export function addMiddlewares(app) {
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
