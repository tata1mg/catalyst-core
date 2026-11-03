// Your starter page. Replace this file, or delete the whole Home folder
// (and its route in src/js/routes/index.js) when you are ready for your own.
import React, { useEffect, useState } from "react"
import Mark from "./Mark"
import css from "./Home.scss"

const DOCS = "https://catalyst.1mg.com/content"

const NEXT_STEPS = [
    {
        title: "Add a page",
        body: "Scaffold a route and its container. Run this from the app folder.",
        code: "npx create-catalyst-app new-route",
        href: `${DOCS}/Routing/routing/index`,
    },
    {
        title: "Load data",
        body: "Add a serverFetcher to this page, then read the result in your component.",
        code: "useCurrentRouteData()",
        href: `${DOCS}/data-fetching`,
    },
    {
        title: "Ship to a phone",
        body: "Build this same code into a native Android or iOS app.",
        code: "npm run buildApp:android",
        href: `${DOCS}/Guides%20and%20Tutorials/First%20Universal%20App/first-universal-app`,
    },
]

const HOOKS = [
    "useCamera",
    "useFilePicker",
    "useHapticFeedback",
    "useNotification",
    "useGoogleSignIn",
    "useNetworkStatus",
    "useSafeArea",
    "useAI",
]

function Home() {
    const [hydratedIn, setHydratedIn] = useState(null)

    // Effects never run on the server, so this fires once the page is hydrated.
    // performance.now() counts from the start of navigation.
    useEffect(() => {
        setHydratedIn(Math.round(performance.now()))
    }, [])

    return (
        <div className={css.page} data-hydrated={hydratedIn !== null}>
            <title>Your app is running | Catalyst</title>

            <nav className={css.nav}>
                <span className={css.brand}>Catalyst</span>
                <span className={css.navLinks}>
                    <a href="https://catalyst.1mg.com">Docs</a>
                    <a href="https://github.com/tata1mg/catalyst-core">GitHub</a>
                </span>
            </nav>

            <main>
                <section className={css.hero}>
                    <div className={css.stage}>
                        <span className={css.burst} aria-hidden="true" />
                        <Mark />
                        <span className={css.spark} aria-hidden="true" />
                    </div>

                    <div className={css.intro}>
                        <h1 className={css.title}>
                            Your app is <em>running.</em>
                        </h1>
                        <p className={css.lede}>
                            Open <code>src/js/containers/Home/Home.js</code>, change anything, and save. This
                            page updates on its own.
                        </p>
                        <p className={css.status} role="status">
                            <span>Rendered on the server</span>
                            <span>
                                {hydratedIn === null
                                    ? "Hydrating in your browser"
                                    : `Interactive in ${hydratedIn} ms`}
                            </span>
                        </p>
                    </div>
                </section>

                <section className={css.next} aria-labelledby="next-heading">
                    <h2 id="next-heading" className={css.heading}>
                        Build on it.
                    </h2>
                    <ul className={css.steps}>
                        {NEXT_STEPS.map((step) => (
                            <li key={step.title}>
                                <a className={css.step} href={step.href}>
                                    <strong>{step.title}</strong>
                                    <span>{step.body}</span>
                                    <code>{step.code}</code>
                                </a>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className={css.native} aria-labelledby="native-heading">
                    <h2 id="native-heading" className={css.heading}>
                        Native features are plain <em>React hooks.</em>
                    </h2>
                    <p className={css.hooksLede}>
                        Import them from <code>catalyst-core/hooks</code>. They work on Android and iOS, and
                        some work on the web too.
                    </p>
                    <p className={css.hooks}>
                        {HOOKS.map((hook) => (
                            <a key={hook} href={`${DOCS}/API%20Reference/hooks`}>
                                {hook}
                                <i>()</i>
                            </a>
                        ))}
                    </p>
                </section>
            </main>
        </div>
    )
}

export default Home
