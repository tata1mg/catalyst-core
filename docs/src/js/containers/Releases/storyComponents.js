import React from 'react'
import styles from './Story.scss'

/**
 * Components available to release-stories/<version>.mdx through the
 * MDXProvider in ReleasePage. Each one is a section of the announcement:
 * try-it snippets, signed feature cards, a goodbye/hello note, small fixes,
 * a tip, and the contributor thanks. <FullNotes> is added by the generator
 * around the version's changelog section.
 */

const REPO = 'https://github.com/tata1mg/catalyst-core'

const avatar = (login) => `https://github.com/${login}.png?size=64`

/** "@login · #533", linked to the profile and the pull request. */
export const Byline = ({ by, pr }) => (
    <span className={styles.byline}>
        <a href={`https://github.com/${by}`} target="_blank" rel="noreferrer">
            <img
                src={avatar(by)}
                alt=""
                width="22"
                height="22"
                loading="lazy"
            />
            @{by}
        </a>
        {pr && (
            <a href={`${REPO}/pull/${pr}`} target="_blank" rel="noreferrer">
                #{pr}
            </a>
        )}
    </span>
)

export const Kicker = ({ children }) => (
    <p className={styles.kicker}>{children}</p>
)

export const Section = ({ eyebrow, title, children }) => (
    <section className={styles.section}>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        {title && <h2 className={styles.title}>{title}</h2>}
        {children}
    </section>
)

export const Snippets = ({ children }) => (
    <div className={styles.snippets}>{children}</div>
)

export const Snippet = ({ label, note, children }) => (
    <figure className={styles.snippet}>
        <figcaption>
            <span>{label}</span>
            {note && <span className={styles.snippetNote}>{note}</span>}
        </figcaption>
        {children}
    </figure>
)

export const Features = ({ children }) => (
    <div className={styles.features}>{children}</div>
)

/** `image` is a still from the film; `code` shows a code tile instead. */
export const Feature = ({ title, image, code, by, pr, tag, children }) => (
    <article className={styles.feature}>
        {image ? (
            <img
                src={image}
                alt=""
                loading="lazy"
                className={styles.featureImage}
            />
        ) : (
            <div className={styles.featureCode} aria-hidden="true">
                <code>{code}</code>
            </div>
        )}
        <div className={styles.featureBody}>
            <h3>
                {title}
                {tag && <span className={styles.tag}>{tag}</span>}
            </h3>
            {children}
            <Byline by={by} pr={pr} />
        </div>
    </article>
)

export const Farewell = ({ from, to, by, pr, children }) => (
    <div className={styles.farewell}>
        <p className={styles.farewellLine}>
            <span className={styles.goodbye}>
                Goodbye <code>{from}</code>,
            </span>{' '}
            <span className={styles.hello}>
                hello <code>{to}</code>.
            </span>
        </p>
        {children}
        <Byline by={by} pr={pr} />
    </div>
)

export const Fixes = ({ children }) => (
    <ul className={styles.fixes}>{children}</ul>
)

export const Fix = ({ by, pr, children }) => (
    <li>
        <span>{children}</span>
        <Byline by={by} pr={pr} />
    </li>
)

export const Tip = ({ title, children }) => (
    <aside className={styles.tip}>
        <p className={styles.eyebrow}>Tip of the release</p>
        <h2 className={styles.title}>{title}</h2>
        {children}
    </aside>
)

export const Thanks = ({ release, people }) => (
    <section className={styles.thanks}>
        <h2 className={styles.title}>Thank you.</h2>
        <p>Catalyst {release} was built by these people.</p>
        <ul className={styles.people}>
            {people.map((login) => (
                <li key={login}>
                    <a
                        href={`https://github.com/${login}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        <img
                            src={avatar(login)}
                            alt=""
                            width="48"
                            height="48"
                            loading="lazy"
                        />
                        <span>@{login}</span>
                    </a>
                </li>
            ))}
        </ul>
        <p className={styles.community}>
            Questions or ideas? Find us on{' '}
            <a
                href="https://discord.gg/GTzYzP8X6s"
                target="_blank"
                rel="noreferrer"
            >
                Discord
            </a>
            ,{' '}
            <a
                href="https://x.com/shipcatalyst"
                target="_blank"
                rel="noreferrer"
            >
                X
            </a>{' '}
            and{' '}
            <a href={`${REPO}/discussions`} target="_blank" rel="noreferrer">
                GitHub Discussions
            </a>
            .
        </p>
    </section>
)

export const FullNotes = ({ children }) => (
    <details className={styles.fullNotes}>
        <summary>Full release notes</summary>
        <div className={styles.fullNotesBody}>{children}</div>
    </details>
)

export const storyComponents = {
    Kicker,
    Section,
    Snippets,
    Snippet,
    Features,
    Feature,
    Farewell,
    Fixes,
    Fix,
    Tip,
    Thanks,
    FullNotes,
}
