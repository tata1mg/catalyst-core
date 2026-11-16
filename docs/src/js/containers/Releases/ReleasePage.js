import React, { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router'
import { MDXProvider } from '@mdx-js/react'
import CopyButton from '../../components/CopyButton'
import { buildComponents } from '../../components/docs/DocPage'
import ReleaseVideo from './ReleaseVideo'
import { storyComponents } from './storyComponents'
import {
    LATEST_RELEASE,
    RELEASES,
    formatDate,
    githubReleaseUrl,
    npmUrl,
} from './releaseData'
import styles from './Releases.scss'
import story from './Story.scss'

/** `code` spans in a plain string (film notes come from JSON, not MDX). */
const withCode = (text) =>
    text
        .split('`')
        .map((part, index) =>
            index % 2 ? <code key={index}>{part}</code> : part
        )

/** "Splash screens, animated. Your app, ready for agents." -> two lines. */
const splitHeadline = (headline) => {
    const cut = headline.indexOf('. ')
    return cut === -1
        ? [headline, null]
        : [headline.slice(0, cut + 1), headline.slice(cut + 2)]
}

const Arrow = ({ flip }) => (
    <svg
        className={`${story.arrow} ${flip ? story.arrowFlip : ''}`}
        viewBox="0 0 120 60"
        fill="none"
        aria-hidden="true"
    >
        <path
            d="M4 10c22-6 52 2 66 18 9 10 18 16 40 18"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
        />
        <path
            d="M98 36l12 10-14 6"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

/**
 * The breadcrumb's version, opening a list of every release. A <details> of
 * plain links, so it works before hydration and crawlers see every release.
 * Mount it with key={url}: the remount on navigation closes it.
 */
const VersionSwitcher = ({ current }) => {
    const ref = useRef(null)

    useEffect(() => {
        const close = (event) => {
            const details = ref.current
            if (!details?.open) return
            if (event.type === 'keydown') {
                if (event.key !== 'Escape') return
                details.open = false
                details.querySelector('summary').focus()
            } else if (!details.contains(event.target)) {
                details.open = false
            }
        }
        document.addEventListener('pointerdown', close)
        document.addEventListener('keydown', close)
        return () => {
            document.removeEventListener('pointerdown', close)
            document.removeEventListener('keydown', close)
        }
    }, [])

    return (
        <details ref={ref} className={styles.switcher}>
            <summary aria-label={`Version ${current.version}, switch release`}>
                v{current.version}
                <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path
                        d="M3 4.5l3 3 3-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </summary>
            <ul className={styles.switcherMenu}>
                {RELEASES.map((page) => (
                    <li key={page.url}>
                        <Link
                            to={page.url}
                            aria-current={
                                page.release.version === current.version
                                    ? 'page'
                                    : undefined
                            }
                        >
                            <span>v{page.release.version}</span>
                            {page === LATEST_RELEASE && (
                                <span className={styles.badge}>Latest</span>
                            )}
                            <time dateTime={page.release.date}>
                                {formatDate(page.release.date)}
                            </time>
                        </Link>
                    </li>
                ))}
            </ul>
        </details>
    )
}

/** Header for a release with a story: version line, headline, annotated film. */
const StoryHero = ({ meta, latest }) => {
    const { release } = meta
    const [first, second] = splitHeadline(release.headline)
    const [left, right] = release.notes ?? []

    return (
        <>
            <header className={story.hero}>
                <p className={story.versionLine}>
                    <span>v{release.version}</span>
                    <span aria-hidden="true">|</span>
                    <time dateTime={release.date}>
                        {formatDate(release.date)}
                    </time>
                    {latest && <span className={styles.badge}>Latest</span>}
                </p>
                <h1 className={story.headline}>
                    {first}
                    {second && <span>{second}</span>}
                </h1>
                <p className={story.lead}>{release.summary}</p>
            </header>

            <div className={story.stage}>
                {left && (
                    <p className={`${story.note} ${story.noteLeft}`}>
                        {withCode(left)}
                        <Arrow />
                    </p>
                )}
                <ReleaseVideo release={release} title={meta.title} />
                {right && (
                    <p className={`${story.note} ${story.noteRight}`}>
                        <Arrow flip />
                        {withCode(right)}
                    </p>
                )}
            </div>
        </>
    )
}

/**
 * One release announcement: the film, then the page body. The body is the
 * version's changelog section, preceded by its story when
 * release-stories/<version>.mdx exists. Rendered by the generated routes
 * (makeReleasePage) for each release-pages.json entry.
 */
const ReleasePage = ({ meta, Content }) => {
    const { release } = meta
    const components = useMemo(
        () => ({ ...buildComponents(meta), ...storyComponents }),
        [meta]
    )
    const install = `npm i catalyst-core@${release.version}`
    const latest = meta.url === LATEST_RELEASE.url

    return (
        <div className={styles.page}>
            <div className={release.story ? story.column : styles.column}>
                <nav
                    className={`doc-breadcrumbs ${release.story ? story.narrow : ''}`}
                    aria-label="Breadcrumbs"
                >
                    <Link to="/releases">Releases</Link>
                    <span aria-hidden="true"> › </span>
                    <VersionSwitcher key={meta.url} current={release} />
                </nav>

                {release.story ? (
                    <StoryHero meta={meta} latest={latest} />
                ) : (
                    <>
                        <header className={styles.header}>
                            <p className={styles.meta}>
                                <time dateTime={release.date}>
                                    {formatDate(release.date)}
                                </time>
                                {latest && (
                                    <span className={styles.badge}>Latest</span>
                                )}
                            </p>
                            <h1 className={styles.title}>
                                Catalyst <span>{release.version}</span>
                            </h1>
                            <p className={styles.headline}>
                                {release.headline}
                            </p>
                        </header>
                        <ReleaseVideo release={release} title={meta.title} />
                    </>
                )}

                <div
                    className={`${styles.actions} ${release.story ? story.actions : ''}`}
                >
                    <div className={styles.install}>
                        <code>{install}</code>
                        <CopyButton text={install} />
                    </div>
                    <div className={styles.links}>
                        <a
                            href={githubReleaseUrl(release.tag)}
                            target="_blank"
                            rel="noreferrer"
                        >
                            GitHub release
                        </a>
                        <a
                            href={npmUrl(release.version)}
                            target="_blank"
                            rel="noreferrer"
                        >
                            npm
                        </a>
                        <Link to="/content/changelog">Full changelog</Link>
                    </div>
                </div>

                <article
                    className={`doc-article markdown-body ${styles.body} ${release.story ? story.body : ''}`}
                >
                    <MDXProvider components={components}>
                        <Content />
                    </MDXProvider>
                </article>

                <nav
                    className={`doc-pagination ${release.story ? story.narrow : ''}`}
                >
                    {meta.prev ? (
                        <Link
                            to={meta.prev.url}
                            className="doc-pagination-link prev"
                        >
                            <span>Older</span>
                            {meta.prev.title}
                        </Link>
                    ) : (
                        <span />
                    )}
                    {meta.next ? (
                        <Link
                            to={meta.next.url}
                            className="doc-pagination-link next"
                        >
                            <span>Newer</span>
                            {meta.next.title}
                        </Link>
                    ) : (
                        <span />
                    )}
                </nav>
            </div>
        </div>
    )
}

export default ReleasePage
