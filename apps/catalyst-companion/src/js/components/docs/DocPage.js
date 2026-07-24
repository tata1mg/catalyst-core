import React, { useMemo, useState } from "react"
import { MDXProvider } from "@mdx-js/react"
import { Link } from "catalyst-core"
import manifest from "../../generated/docsManifest.json"
import DocsSidebar from "./DocsSidebar"
import CodeBlock from "./CodeBlock"

const bySourcePath = new Map(manifest.map((page) => [page.sourcePath, page]))

/**
 * Resolve a markdown file link to its canonical URL. Docusaurus supports two
 * forms in content: relative (./x.md, ../dir/y.mdx) and absolute-from-content
 * source paths (/content/11-API%20Reference/04-SSR-Lifecycle.md).
 */
const resolveDocFileLink = (href, fromSourcePath) => {
    const [rawTarget, hash = ""] = href.split("#")
    const target = decodeURIComponent(rawTarget)
    if (!/\.mdx?$/.test(target)) return null

    let sourceKey
    if (target.startsWith("/content/")) {
        sourceKey = target.slice("/content/".length)
    } else {
        const segments = fromSourcePath.split("/").slice(0, -1)
        for (const part of target.split("/")) {
            if (part === "." || part === "") continue
            else if (part === "..") segments.pop()
            else segments.push(part)
        }
        sourceKey = segments.join("/")
    }

    const resolved = bySourcePath.get(sourceKey)
    return resolved ? resolved.url + (hash ? `#${hash}` : "") : null
}

const buildComponents = (meta) => {
    const sourceDir = meta.sourcePath.split("/").slice(0, -1).join("/")

    return {
        a: ({ href = "", children, ...rest }) => {
            if (/^[a-z]+:/i.test(href)) {
                return (
                    <a href={href} target="_blank" rel="noreferrer" {...rest}>
                        {children}
                    </a>
                )
            }
            if (href.startsWith("#")) {
                return (
                    <a href={href} {...rest}>
                        {children}
                    </a>
                )
            }
            const docUrl = resolveDocFileLink(href, meta.sourcePath)
            return (
                <Link to={docUrl || href} {...rest}>
                    {children}
                </Link>
            )
        },
        img: ({ src = "", alt = "", ...rest }) => {
            let resolved = src
            if (!/^([a-z]+:|\/)/i.test(src)) {
                const clean = src.replace(/^\.\//, "")
                resolved = `/docs-assets/${sourceDir ? `${sourceDir}/` : ""}${clean}`
            }
            return <img src={resolved} alt={alt} loading="lazy" {...rest} />
        },
        pre: (props) => {
            const child = props.children?.props
            if (child && typeof child.children === "string") {
                return <CodeBlock className={child.className || ""}>{child.children}</CodeBlock>
            }
            return <pre {...props} />
        },
    }
}

const Toc = ({ toc }) => {
    if (!toc.length) return null
    return (
        <nav className="doc-toc" aria-label="Table of contents">
            <div className="doc-toc-title">On this page</div>
            <ul>
                {toc.map((entry) => (
                    <li key={entry.id} className={`doc-toc-depth-${entry.depth}`}>
                        <a href={`#${entry.id}`}>{entry.text}</a>
                    </li>
                ))}
            </ul>
        </nav>
    )
}

const DocPage = ({ meta, Content }) => {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const components = useMemo(() => buildComponents(meta), [meta])

    return (
        <div className="docs-shell">
            <button className="docs-mobile-sidebar-toggle" onClick={() => setSidebarOpen(true)}>
                ☰ Menu
            </button>
            <DocsSidebar
                currentUrl={meta.url}
                mobileOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />
            <div className="doc-main">
                <nav className="doc-breadcrumbs" aria-label="Breadcrumbs">
                    <Link to="/">Home</Link>
                    {meta.categories.map((category) => (
                        <span key={category}> › {category}</span>
                    ))}
                    <span> › {meta.title}</span>
                </nav>
                <article className="doc-article markdown-body">
                    <MDXProvider components={components}>
                        <Content />
                    </MDXProvider>
                </article>
                <nav className="doc-pagination">
                    {meta.prev ? (
                        <Link to={meta.prev.url} className="doc-pagination-link prev">
                            <span>Previous</span>
                            {meta.prev.title}
                        </Link>
                    ) : (
                        <span />
                    )}
                    {meta.next ? (
                        <Link to={meta.next.url} className="doc-pagination-link next">
                            <span>Next</span>
                            {meta.next.title}
                        </Link>
                    ) : (
                        <span />
                    )}
                </nav>
            </div>
            <Toc toc={meta.toc} />
        </div>
    )
}

export default DocPage
