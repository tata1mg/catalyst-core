#!/usr/bin/env node
/**
 * Docs manifest generator.
 *
 * Walks ./content and reproduces the Docusaurus permalink scheme exactly
 * (numeric `NN-` prefixes stripped per path segment, spaces/case preserved,
 * frontmatter slug/id overrides honored). Those URLs are indexed, so keeping
 * them byte-identical is the whole point of this file surviving the move off
 * Docusaurus. It emits:
 *
 *   src/js/generated/docsManifest.json  — url, title, description, category
 *                                         chain, order, toc, searchText,
 *                                         prev/next, source path
 *   src/js/generated/docsRoutes.jsx     — one explicit route per page
 *                                         (ssr + offline) for the router
 *
 * Modes:
 *   node scripts/generate-docs-manifest.mjs           # generate both files
 *   node scripts/generate-docs-manifest.mjs --check <urls.txt>
 *       # print URL parity diff against a canonical list and exit non-zero
 *       # on mismatch (used against the built Docusaurus sitemap)
 *   node scripts/generate-docs-manifest.mjs --export
 *       # git archive each non-latest version into versions/. Needs .git, so
 *       # it never runs as part of npm run build (Docker has no .git). Run
 *       # it before `docker build` when versions.json lists a live old major.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import GithubSlugger from 'github-slugger'
import { compile } from '@mdx-js/mdx'
import remarkGfm from 'remark-gfm'
import remarkDirective from 'remark-directive'
import remarkFrontmatter from 'remark-frontmatter'
import rehypeSlug from 'rehype-slug'
import remarkAdmonitions, {
    normalizeAdmonitionTitles,
} from './remark-admonitions.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..')
const CONTENT_ROOT = path.resolve(APP_ROOT, 'content')
const OUT_DIR = path.join(APP_ROOT, 'src/js/generated')
const ROUTE_BASE = '/content'
const REPO_ROOT = path.resolve(APP_ROOT, '..')
const VERSIONS_DIR = path.join(APP_ROOT, 'versions')
const VERSIONS_FILE = path.resolve(
    APP_ROOT,
    process.env.DOCS_VERSIONS || 'versions.json'
)
const CHANGELOG = path.resolve(REPO_ROOT, 'packages/catalyst-core/changelog.md')

const readVersions = () => JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'))

const latestOf = (versions) => versions.find((entry) => entry.latest)

const versionDir = (version) => path.join(VERSIONS_DIR, String(version.major))

/** Live versions built from an export; archived ones are links only. */
const exportedVersions = (versions) =>
    versions.filter((version) => !version.latest && !version.archived)

const stripPrefix = (segment) => segment.replace(/^\d+-/, '')

const walk = (dir, files = []) => {
    for (const entry of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) =>
            a.name.localeCompare(b.name, 'en', { numeric: true })
        )) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            walk(full, files)
        } else if (/\.mdx?$/.test(entry.name) && !entry.name.startsWith('_')) {
            files.push(full)
        }
    }
    return files
}

const readCategoryMeta = (dir) => {
    const metaPath = path.join(dir, '_category_.json')
    if (!fs.existsSync(metaPath)) return null
    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    } catch {
        return null
    }
}

/** Order key: numeric prefix of each path segment (frontmatter sidebar_position wins for the file). */
const orderKeyFor = (relPath, frontmatter) => {
    const segments = relPath.split(path.sep)
    return segments.map((segment, index) => {
        const isFile = index === segments.length - 1
        if (isFile && typeof frontmatter.sidebar_position === 'number') {
            return frontmatter.sidebar_position
        }
        const match = segment.match(/^(\d+)-/)
        return match ? Number(match[1]) : 999
    })
}

const compareOrderKeys = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const left = a[i] ?? -1
        const right = b[i] ?? -1
        if (left !== right) return left - right
    }
    return 0
}

/** Docusaurus doc URL: routeBase + cleaned dir segments + doc id (slug/id/frontmatter aware). */
const urlFor = (relPath, frontmatter, urlBase) => {
    const segments = relPath.split(path.sep)
    const fileName = segments.pop().replace(/\.mdx?$/, '')
    const dirSegments = segments.map(stripPrefix)

    if (typeof frontmatter.slug === 'string' && frontmatter.slug.trim()) {
        const slug = frontmatter.slug.trim()
        if (slug.startsWith('/')) {
            // Absolute slug replaces the whole path under the route base.
            return `${urlBase}${slug === '/' ? '' : slug}`.replace(/\/$/, '')
        }
        return [urlBase, ...dirSegments, slug].join('/')
    }

    const id =
        typeof frontmatter.id === 'string' && frontmatter.id.trim()
            ? frontmatter.id.trim()
            : stripPrefix(fileName)
    return [urlBase, ...dirSegments, id].join('/')
}

const stripMarkdown = (markdown) => {
    return markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/^import\s.+$/gm, ' ')
        .replace(/^export\s.+$/gm, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[#>*`~_|-]/g, ' ')
        .replace(/:{3,}\w*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const extractToc = (markdown) => {
    const slugger = new GithubSlugger()
    const toc = []
    let inFence = false
    for (const line of markdown.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence
            continue
        }
        if (inFence) continue
        const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/)
        if (match) {
            const text = match[2]
                .replace(/[*_`]/g, '')
                .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
                .trim()
            toc.push({ depth: match[1].length, text, id: slugger.slug(text) })
        }
    }
    return toc
}

const firstHeading = (markdown) => {
    let inFence = false
    for (const line of markdown.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence
            continue
        }
        if (inFence) continue
        const match = line.match(/^#\s+(.+?)\s*#*\s*$/)
        if (match) return match[1].trim()
    }
    return null
}

/** The package changelog, rendered as the last page in the latest partition. */
const releasePage = (version) => {
    const raw = fs.readFileSync(CHANGELOG, 'utf8')
    const plain = stripMarkdown(raw)
    return {
        url: `${ROUTE_BASE}/releases`,
        sourcePath: path
            .relative(REPO_ROOT, CHANGELOG)
            .split(path.sep)
            .join('/'),
        absPath: CHANGELOG,
        title: 'Releases',
        sidebarLabel: 'Releases',
        description: plain.slice(0, 160),
        categories: [],
        orderKey: [Number.MAX_SAFE_INTEGER],
        toc: extractToc(raw),
        searchText: `Releases ${plain}`.slice(0, 5000),
        isMdx: false,
        version,
    }
}

const buildPages = (contentRoot, urlBase, version) => {
    if (!fs.existsSync(contentRoot)) {
        throw new Error(`Docs content root not found: ${contentRoot}`)
    }

    const pages = walk(contentRoot).map((absPath) => {
        const relPath = path.relative(contentRoot, absPath)
        const raw = fs.readFileSync(absPath, 'utf8')
        const { data: frontmatter, content } = matter(raw)

        const dirSegments = relPath.split(path.sep).slice(0, -1)
        const categories = dirSegments.map((segment, index) => {
            const meta = readCategoryMeta(
                path.join(contentRoot, ...dirSegments.slice(0, index + 1))
            )
            return meta?.label || stripPrefix(segment)
        })

        const fileTitle = stripPrefix(
            path.basename(relPath).replace(/\.mdx?$/, '')
        )
        const title = frontmatter.title || firstHeading(content) || fileTitle
        const plain = stripMarkdown(content)

        return {
            url: urlFor(relPath, frontmatter, urlBase),
            sourcePath: relPath.split(path.sep).join('/'),
            title,
            sidebarLabel: frontmatter.sidebar_label || title,
            description: frontmatter.description || plain.slice(0, 160),
            categories,
            orderKey: orderKeyFor(relPath, frontmatter),
            toc: extractToc(content),
            searchText: `${title} ${plain}`.slice(0, 5000),
            isMdx: absPath.endsWith('.mdx'),
            absPath,
            version,
        }
    })

    if (version.latest) pages.push(releasePage(version))

    pages.sort((a, b) => compareOrderKeys(a.orderKey, b.orderKey))

    const duplicates = new Map()
    for (const page of pages) {
        if (duplicates.has(page.url)) {
            throw new Error(
                `Duplicate URL generated: ${page.url}\n  ${duplicates.get(page.url)}\n  ${page.sourcePath}`
            )
        }
        duplicates.set(page.url, page.sourcePath)
    }

    return pages.map((page, index) => ({
        ...page,
        prev:
            index > 0
                ? { url: pages[index - 1].url, title: pages[index - 1].title }
                : null,
        next:
            index < pages.length - 1
                ? { url: pages[index + 1].url, title: pages[index + 1].title }
                : null,
    }))
}

const IMAGE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.webp',
    '.ico',
])

/**
 * Copy image assets so rendered pages resolve them:
 * - docs/static/img/**            -> public/img/**            (absolute /img/... refs)
 * - docs/content/** (images)      -> public/docs-assets/**    (relative ./x.png refs,
 *                                     rewritten at render time from the page's sourcePath)
 */
const copyAssets = (contentRoot, staticRoot, imgOut, assetsOut) => {
    const copyTree = (from, to) => {
        if (!fs.existsSync(from)) return 0
        let count = 0
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
            const src = path.join(from, entry.name)
            const dest = path.join(to, entry.name)
            if (entry.isDirectory()) {
                count += copyTree(src, dest)
            } else if (
                IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
            ) {
                fs.mkdirSync(path.dirname(dest), { recursive: true })
                fs.copyFileSync(src, dest)
                count++
            }
        }
        return count
    }

    // Clear first: copyTree merges, so a file deleted from the source would
    // otherwise linger here forever and get shipped in the Docker image.
    fs.rmSync(imgOut, { recursive: true, force: true })
    fs.rmSync(assetsOut, { recursive: true, force: true })

    const staticCount = copyTree(staticRoot, imgOut)
    const contentCount = copyTree(contentRoot, assetsOut)
    console.log(
        `Copied ${staticCount} static + ${contentCount} content image asset(s)`
    )
}

/**
 * Compile a content file to ESM at generation time. The app then hands stock
 * .mjs modules to the framework, keeping generated docs source out of .js
 * module-format handling. Same pipeline Docusaurus applies: md and mdx both
 * compile as MDX.
 */
const compileDoc = async (page) => {
    const compiled = await compile(
        {
            path: page.absPath,
            value: normalizeAdmonitionTitles(
                fs.readFileSync(page.absPath, 'utf8')
            ),
        },
        {
            format: 'mdx',
            providerImportSource: '@mdx-js/react',
            remarkPlugins: [
                remarkFrontmatter,
                remarkGfm,
                remarkDirective,
                remarkAdmonitions,
            ],
            rehypePlugins: [rehypeSlug],
            development: false,
        }
    )
    // Docusaurus-era aliases → the ported components (relative to generated/docs/).
    return String(compiled)
        .replace(
            /(["'])@site\/src\/components\//g,
            '$1../../components/docs/site/'
        )
        .replace(
            /(["'])@site\/src\/data\//g,
            '$1../../components/docs/site/data/'
        )
}

const compiledFileName = (page, index) =>
    `page-${index}-${page.sourcePath.replace(/\.mdx?$/, '').replace(/[^a-zA-Z0-9]+/g, '_')}.mjs`

const emit = async (pages, versions) => {
    fs.mkdirSync(OUT_DIR, { recursive: true })

    copyAssets(
        CONTENT_ROOT,
        path.resolve(APP_ROOT, 'static/img'),
        path.join(APP_ROOT, 'public/img'),
        path.join(APP_ROOT, 'public/docs-assets')
    )
    // Mirrors the latest layout under public/v/<major>/, mounted by server.js.
    for (const version of exportedVersions(versions)) {
        const root = versionDir(version)
        const out = path.join(APP_ROOT, 'public/v', String(version.major))
        copyAssets(
            path.join(root, 'content'),
            path.join(root, 'static/img'),
            path.join(out, 'img'),
            path.join(out, 'docs-assets')
        )
    }

    // Internal-only bookkeeping; the manifest keeps the shape the app reads.
    const manifest = pages.map(({ orderKey, absPath, version, ...page }) => ({
        ...page,
        version: version.label,
    }))
    fs.writeFileSync(
        path.join(OUT_DIR, 'docsManifest.json'),
        JSON.stringify(manifest, null, 2)
    )

    const docsDir = path.join(OUT_DIR, 'docs')
    fs.rmSync(docsDir, { recursive: true, force: true })
    fs.mkdirSync(docsDir, { recursive: true })
    for (const [index, page] of pages.entries()) {
        fs.writeFileSync(
            path.join(docsDir, compiledFileName(page, index)),
            await compileDoc(page)
        )
    }

    // Synchronous imports on purpose: split() routes SSR an empty Suspense
    // shell on the first (cold) request per process, which crawlers would
    // index. The docs set is small; correctness beats code-splitting here.
    const importLines = pages
        .map(
            (page, index) =>
                `import Doc${index} from "./docs/${compiledFileName(page, index)}"`
        )
        .join('\n')

    // Once a third live major ships, wrap the non-latest routes in split() —
    // old versions are cold traffic and need not sit in the main bundle.
    const routeEntries = pages
        .map((page, index) => {
            return `    {
        path: ${JSON.stringify(page.url)},
        end: true,
        offline: true,
        component: makeDocPage(${index}, Doc${index}),
    },`
        })
        .join('\n')

    const routesFile = `// AUTO-GENERATED by scripts/generate-docs-manifest.mjs — do not edit.
import React from "react"
import DocPage from "../components/docs/DocPage"
import manifest from "./docsManifest.json"
${importLines}

const makeDocPage = (manifestIndex, Content) => {
    const meta = manifest[manifestIndex]
    const Page = () => <DocPage meta={meta} Content={Content} />
    Page.displayName = "DocPage_" + manifestIndex
    Page.setMetaData = () => [
        <title key="title">{meta.title + " | Catalyst"}</title>,
        <meta key="description" name="description" content={meta.description} />,
    ]
    return Page
}

const docsRoutes = [
${routeEntries}
]

export default docsRoutes
`
    fs.writeFileSync(path.join(OUT_DIR, 'docsRoutes.jsx'), routesFile)
    fs.writeFileSync(
        path.join(OUT_DIR, 'versions.json'),
        JSON.stringify(versions, null, 2)
    )
    emitSeoFiles(pages.filter((page) => page.version.latest))
    console.log(`Generated manifest + routes for ${pages.length} pages`)
}

/**
 * sitemap.xml + robots.txt for the public site, served by server/server.js.
 * SITE_URL overrides the canonical origin (defaults to the production host).
 */
const emitSeoFiles = (pages) => {
    const siteUrl = (
        process.env.SITE_URL || 'https://catalyst.1mg.com'
    ).replace(/\/$/, '')
    // Companion surfaces (/app, /try, /showcase) are noindexed and deliberately
    // left out of the sitemap.
    const staticUrls = ['/']
    const allUrls = [...staticUrls, ...pages.map((page) => page.url)]

    const sitemap = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        ...allUrls.map((url) => {
            const escaped = `${siteUrl}${url === '/' ? '' : encodeURI(url)}`
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
            return `    <url><loc>${escaped || siteUrl}</loc></url>`
        }),
        `</urlset>`,
        '',
    ].join('\n')

    const robots = [
        'User-agent: *',
        'Allow: /',
        '',
        `Sitemap: ${siteUrl}/sitemap.xml`,
        '',
    ].join('\n')

    const publicDir = path.join(APP_ROOT, 'public')
    fs.mkdirSync(publicDir, { recursive: true })
    fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), sitemap)
    fs.writeFileSync(path.join(publicDir, 'robots.txt'), robots)
    console.log(`Generated sitemap.xml (${allUrls.length} URLs) + robots.txt`)
}

/** git archive each non-latest, non-archived version into versions/<major>/. */
const exportVersions = () => {
    for (const version of exportedVersions(readVersions())) {
        const dest = versionDir(version)
        fs.rmSync(dest, { recursive: true, force: true })
        fs.mkdirSync(dest, { recursive: true })
        // Two calls, no shell: a pipeline hides a bad ref behind tar's status.
        const archive = execFileSync(
            'git',
            ['archive', version.ref, 'docs/content', 'docs/static/img'],
            { cwd: REPO_ROOT, maxBuffer: 1 << 28 }
        )
        execFileSync('tar', ['-x', '-C', dest, '--strip-components=1'], {
            input: archive,
        })
        console.log(
            `Exported ${version.label} -> ${path.relative(APP_ROOT, dest)}`
        )
    }
}

const main = async () => {
    if (process.argv.includes('--export')) {
        exportVersions()
        return
    }

    const versions = readVersions()
    const pages = [
        ...buildPages(CONTENT_ROOT, ROUTE_BASE, latestOf(versions)),
        ...exportedVersions(versions).flatMap((version) =>
            buildPages(
                path.join(versionDir(version), 'content'),
                `/v/${version.major}${ROUTE_BASE}`,
                version
            )
        ),
    ]

    const latestBySource = new Map(
        pages
            .filter((page) => page.version.latest)
            .map((page) => [page.sourcePath, page])
    )
    for (const page of pages) {
        page.canonical = latestBySource.get(page.sourcePath)?.url ?? page.url
    }

    const checkIndex = process.argv.indexOf('--check')
    if (checkIndex !== -1) {
        const canonicalPath = process.argv[checkIndex + 1]
        const canonical = new Set(
            fs
                .readFileSync(canonicalPath, 'utf8')
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
        )
        const generated = new Set(
            pages.filter((page) => page.version.latest).map((page) => page.url)
        )
        const missing = [...canonical]
            .filter((url) => !generated.has(url))
            .sort()
        const extra = [...generated].filter((url) => !canonical.has(url)).sort()

        console.log(
            `canonical: ${canonical.size}, generated: ${generated.size}`
        )
        if (missing.length)
            console.log(
                'MISSING (in canonical, not generated):\n  ' +
                    missing.join('\n  ')
            )
        if (extra.length)
            console.log(
                'EXTRA (generated, not canonical):\n  ' + extra.join('\n  ')
            )
        if (missing.length || extra.length) process.exit(1)
        console.log('URL parity: exact match ✓')
        return
    }

    await emit(pages, versions)
}

await main()
