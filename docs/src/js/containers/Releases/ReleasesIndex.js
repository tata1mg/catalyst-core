import React from 'react'
import { Link } from 'react-router'
import ReleaseVideo from './ReleaseVideo'
import { RELEASES, LATEST_RELEASE, formatDate } from './releaseData'
import styles from './Releases.scss'

/** /releases: the latest release with its film up front, then the rest. */
const ReleasesIndex = () => {
    const latest = LATEST_RELEASE
    const earlier = RELEASES.slice(1)

    return (
        <div className={styles.page}>
            <div className={styles.indexColumn}>
                <header className={styles.indexHeader}>
                    <h1>Releases</h1>
                    <p>
                        What each version of Catalyst ships, with the film we
                        made for it. Every change is also listed in the{' '}
                        <Link to="/content/changelog">changelog</Link>.
                    </p>
                </header>

                <section className={styles.featured}>
                    <ReleaseVideo
                        release={latest.release}
                        title={latest.title}
                    />
                    <div className={styles.featuredText}>
                        <p className={styles.meta}>
                            <time dateTime={latest.release.date}>
                                {formatDate(latest.release.date)}
                            </time>
                            <span className={styles.badge}>Latest</span>
                        </p>
                        <h2 className={styles.featuredTitle}>
                            <Link to={latest.url}>
                                Catalyst <span>{latest.release.version}</span>
                            </Link>
                        </h2>
                        <p className={styles.headline}>
                            {latest.release.headline}
                        </p>
                        <p className={styles.summary}>
                            {latest.release.summary}
                        </p>
                        <Link to={latest.url} className={styles.more}>
                            {"Read what's new"}
                        </Link>
                    </div>
                </section>

                {earlier.length > 0 && (
                    <>
                        <h2 className={styles.sectionLabel}>
                            Earlier releases
                        </h2>
                        <ul className={styles.grid}>
                            {earlier.map((page) => (
                                <li key={page.url}>
                                    <Link to={page.url} className={styles.card}>
                                        {page.release.poster ? (
                                            <img
                                                src={page.release.poster}
                                                alt=""
                                                loading="lazy"
                                                className={styles.cardPoster}
                                            />
                                        ) : (
                                            <span
                                                className={`${styles.cardPoster} ${styles.cardPosterEmpty}`}
                                                aria-hidden="true"
                                            >
                                                v{page.release.version}
                                            </span>
                                        )}
                                        <span className={styles.cardBody}>
                                            <span className={styles.cardTitle}>
                                                Catalyst {page.release.version}
                                            </span>
                                            <time
                                                className={styles.cardDate}
                                                dateTime={page.release.date}
                                            >
                                                {formatDate(page.release.date)}
                                            </time>
                                            <span
                                                className={styles.cardHeadline}
                                            >
                                                {page.release.headline}
                                            </span>
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                <p className={styles.footnote}>
                    Pre-1.0 betas are listed in the{' '}
                    <Link to="/content/changelog">changelog</Link>.
                </p>
            </div>
        </div>
    )
}

ReleasesIndex.setMetaData = () => [
    <title key="title">Releases | Catalyst</title>,
    <meta
        key="description"
        name="description"
        content="What each version of Catalyst ships, with the release film for each one."
    />,
]

export default ReleasesIndex
