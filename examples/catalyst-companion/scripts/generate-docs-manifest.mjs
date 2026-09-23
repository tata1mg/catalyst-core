#!/usr/bin/env node
/**
 * Docs manifest generator for the Catalyst Hub.
 *
 * Walks the canonical docs source (docs/content at the monorepo root),
 * reproduces the Docusaurus permalink scheme exactly (numeric `NN-` prefixes
 * stripped per path segment, spaces/case preserved, frontmatter slug/id
 * overrides honored), and emits:
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
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import matter from "gray-matter"
import GithubSlugger from "github-slugger"
import { compile } from "@mdx-js/mdx"
import remarkGfm from "remark-gfm"
import remarkDirective from "remark-directive"
import remarkFrontmatter from "remark-frontmatter"
import rehypeSlug from "rehype-slug"
import remarkAdmonitions from "./remark-admonitions.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, "..")
const CONTENT_ROOT = path.resolve(APP_ROOT, "../../docs/content")
const OUT_DIR = path.join(APP_ROOT, "src/js/generated")
const ROUTE_BASE = "/content"

const stripPrefix = (segment) => segment.replace(/^\d+-/, "")

const walk = (dir, files = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            walk(full, files)
        } else if (/\.mdx?$/.test(entry.name) && !entry.name.startsWith("_")) {
            files.push(full)
        }
    }
    return files
}

const readCategoryMeta = (dir) => {
    const metaPath = path.join(dir, "_category_.json")
    if (!fs.existsSync(metaPath)) return null
    try {
        return JSON.parse(fs.readFileSync(metaPath, "utf8"))
    } catch {
        return null
    }
}

/** Order key: numeric prefix of each path segment (frontmatter sidebar_position wins for the file). */
const orderKeyFor = (relPath, frontmatter) => {
    const segments = relPath.split(path.sep)
    return segments.map((segment, index) => {
        const isFile = index === segments.length - 1
        if (isFile && typeof frontmatter.sidebar_position === "number") {
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
const urlFor = (relPath, frontmatter) => {
    const segments = relPath.split(path.sep)
    const fileName = segments.pop().replace(/\.mdx?$/, "")
    const dirSegments = segments.map(stripPrefix)

    if (typeof frontmatter.slug === "string" && frontmatter.slug.trim()) {
        const slug = frontmatter.slug.trim()
        if (slug.startsWith("/")) {
            // Absolute slug replaces the whole path under the route base.
            return `${ROUTE_BASE}${slug === "/" ? "" : slug}`.replace(/\/$/, "")
        }
        return [ROUTE_BASE, ...dirSegments, slug].join("/")
    }

    const id = typeof frontmatter.id === "string" && frontmatter.id.trim() ? frontmatter.id.trim() : stripPrefix(fileName)
    return [ROUTE_BASE, ...dirSegments, id].join("/")
}

const stripMarkdown = (markdown) => {
    return markdown
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/^import\s.+$/gm, " ")
        .replace(/^export\s.+$/gm, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[#>*`~_|-]/g, " ")
        .replace(/:{3,}\w*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

const extractToc = (markdown) => {
    const slugger = new GithubSlugger()
    const toc = []
    let inFence = false
    for (const line of markdown.split("\n")) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence
            continue
        }
        if (inFence) continue
        const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/)
        if (match) {
            const text = match[2].replace(/[*_`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim()
            toc.push({ depth: match[1].length, text, id: slugger.slug(text) })
        }
    }
    return toc
}

const firstHeading = (markdown) => {
    let inFence = false
    for (const line of markdown.split("\n")) {
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

const buildPages = () => {
    if (!fs.existsSync(CONTENT_ROOT)) {
        throw new Error(`Docs content root not found: ${CONTENT_ROOT}`)
    }

    const pages = walk(CONTENT_ROOT).map((absPath) => {
        const relPath = path.relative(CONTENT_ROOT, absPath)
        const raw = fs.readFileSync(absPath, "utf8")
        const { data: frontmatter, content } = matter(raw)

        const dirSegments = relPath.split(path.sep).slice(0, -1)
        const categories = dirSegments.map((segment, index) => {
            const meta = readCategoryMeta(path.join(CONTENT_ROOT, ...dirSegments.slice(0, index + 1)))
            return meta?.label || stripPrefix(segment)
        })

        const fileTitle = stripPrefix(path.basename(relPath).replace(/\.mdx?$/, ""))
        const title = frontmatter.title || firstHeading(content) || fileTitle
        const plain = stripMarkdown(content)

        return {
            url: urlFor(relPath, frontmatter),
            sourcePath: relPath.split(path.sep).join("/"),
            title,
            sidebarLabel: frontmatter.sidebar_label || title,
            description: frontmatter.description || plain.slice(0, 160),
            categories,
            orderKey: orderKeyFor(relPath, frontmatter),
            toc: extractToc(content),
            searchText: `${title} ${plain}`.slice(0, 5000),
            isMdx: absPath.endsWith(".mdx"),
        }
    })

    pages.sort((a, b) => compareOrderKeys(a.orderKey, b.orderKey))

    const duplicates = new Map()
    for (const page of pages) {
        if (duplicates.has(page.url)) {
            throw new Error(`Duplicate URL generated: ${page.url}\n  ${duplicates.get(page.url)}\n  ${page.sourcePath}`)
        }
        duplicates.set(page.url, page.sourcePath)
    }

    return pages.map((page, index) => ({
        ...page,
        prev: index > 0 ? { url: pages[index - 1].url, title: pages[index - 1].title } : null,
        next: index < pages.length - 1 ? { url: pages[index + 1].url, title: pages[index + 1].title } : null,
    }))
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"])

/**
 * Copy image assets so rendered pages resolve them:
 * - docs/static/img/**            -> public/img/**            (absolute /img/... refs)
 * - docs/content/** (images)      -> public/docs-assets/**    (relative ./x.png refs,
 *                                     rewritten at render time from the page's sourcePath)
 */
const copyAssets = () => {
    const copyTree = (from, to) => {
        if (!fs.existsSync(from)) return 0
        let count = 0
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
            const src = path.join(from, entry.name)
            const dest = path.join(to, entry.name)
            if (entry.isDirectory()) {
                count += copyTree(src, dest)
            } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                fs.mkdirSync(path.dirname(dest), { recursive: true })
                fs.copyFileSync(src, dest)
                count++
            }
        }
        return count
    }

    const staticCount = copyTree(path.resolve(APP_ROOT, "../../docs/static/img"), path.join(APP_ROOT, "public/img"))
    const contentCount = copyTree(CONTENT_ROOT, path.join(APP_ROOT, "public/docs-assets"))
    console.log(`Copied ${staticCount} static + ${contentCount} content image asset(s)`)
}

/**
 * Compile a content file to ESM at generation time. The app then hands stock
 * .mjs modules to the framework, keeping generated docs source out of .js
 * module-format handling. Same pipeline Docusaurus applies: md and mdx both
 * compile as MDX.
 */
const compileDoc = async (page) => {
    const absPath = path.join(CONTENT_ROOT, ...page.sourcePath.split("/"))
    const compiled = await compile(
        { path: absPath, value: fs.readFileSync(absPath, "utf8") },
        {
            format: "mdx",
            providerImportSource: "@mdx-js/react",
            remarkPlugins: [remarkFrontmatter, remarkGfm, remarkDirective, remarkAdmonitions],
            rehypePlugins: [rehypeSlug],
            development: false,
        }
    )
    // Docusaurus-era aliases → the ported components (relative to generated/docs/).
    return String(compiled)
        .replace(/(["'])@site\/src\/components\//g, "$1../../components/docs/site/")
        .replace(/(["'])@site\/src\/data\//g, "$1../../components/docs/site/data/")
}

const compiledFileName = (page, index) =>
    `page-${index}-${page.sourcePath.replace(/\.mdx?$/, "").replace(/[^a-zA-Z0-9]+/g, "_")}.mjs`

const emit = async (pages) => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    copyAssets()

    const manifest = pages.map(({ orderKey, ...page }) => page)
    fs.writeFileSync(path.join(OUT_DIR, "docsManifest.json"), JSON.stringify(manifest, null, 2))

    const docsDir = path.join(OUT_DIR, "docs")
    fs.rmSync(docsDir, { recursive: true, force: true })
    fs.mkdirSync(docsDir, { recursive: true })
    for (const [index, page] of pages.entries()) {
        fs.writeFileSync(path.join(docsDir, compiledFileName(page, index)), await compileDoc(page))
    }

    // Synchronous imports on purpose: split() routes SSR an empty Suspense
    // shell on the first (cold) request per process, which crawlers would
    // index. The docs set is small; correctness beats code-splitting here.
    const importLines = pages
        .map((page, index) => `import Doc${index} from "./docs/${compiledFileName(page, index)}"`)
        .join("\n")

    const routeEntries = pages
        .map((page, index) => {
            return `    {
        path: ${JSON.stringify(page.url)},
        end: true,
        offline: true,
        component: makeDocPage(${index}, Doc${index}),
    },`
        })
        .join("\n")

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
    fs.writeFileSync(path.join(OUT_DIR, "docsRoutes.jsx"), routesFile)
    emitSeoFiles(pages)
    console.log(`Generated manifest + routes for ${pages.length} pages`)
}

/**
 * sitemap.xml + robots.txt for the public site, served by server/server.js.
 * SITE_URL overrides the canonical origin (defaults to the production host).
 */
const emitSeoFiles = (pages) => {
    const siteUrl = (process.env.SITE_URL || "https://catalyst.1mg.com").replace(/\/$/, "")
    // Companion surfaces (/app, /try, /showcase) are noindexed and deliberately
    // left out of the sitemap.
    const staticUrls = ["/"]
    const allUrls = [...staticUrls, ...pages.map((page) => page.url)]

    const sitemap = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        ...allUrls.map((url) => {
            const escaped = `${siteUrl}${url === "/" ? "" : encodeURI(url)}`
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
            return `    <url><loc>${escaped || siteUrl}</loc></url>`
        }),
        `</urlset>`,
        "",
    ].join("\n")

    const robots = ["User-agent: *", "Allow: /", "", `Sitemap: ${siteUrl}/sitemap.xml`, ""].join("\n")

    const publicDir = path.join(APP_ROOT, "public")
    fs.mkdirSync(publicDir, { recursive: true })
    fs.writeFileSync(path.join(publicDir, "sitemap.xml"), sitemap)
    fs.writeFileSync(path.join(publicDir, "robots.txt"), robots)
    console.log(`Generated sitemap.xml (${allUrls.length} URLs) + robots.txt`)
}

const main = async () => {
    const pages = buildPages()

    const checkIndex = process.argv.indexOf("--check")
    if (checkIndex !== -1) {
        const canonicalPath = process.argv[checkIndex + 1]
        const canonical = new Set(
            fs.readFileSync(canonicalPath, "utf8").split("\n").map((line) => line.trim()).filter(Boolean)
        )
        const generated = new Set(pages.map((page) => page.url))
        const missing = [...canonical].filter((url) => !generated.has(url)).sort()
        const extra = [...generated].filter((url) => !canonical.has(url)).sort()

        console.log(`canonical: ${canonical.size}, generated: ${generated.size}`)
        if (missing.length) console.log("MISSING (in canonical, not generated):\n  " + missing.join("\n  "))
        if (extra.length) console.log("EXTRA (generated, not canonical):\n  " + extra.join("\n  "))
        if (missing.length || extra.length) process.exit(1)
        console.log("URL parity: exact match ✓")
        return
    }

    await emit(pages)
}

await main()
