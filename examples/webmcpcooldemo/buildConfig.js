export default {
    clientPlugins: [],
    ssrPlugins: [
        // catalyst-core's main entry (RouterDataProvider, useRouterState) and its
        // `catalyst-core/webmcp` subpath must share the SAME React context
        // instances. Under Vite's dev SSR an externalized catalyst-core can resolve
        // the main entry and the subpath as two module records, each with its own
        // createContext(). noExternal pushes the whole package through Vite's
        // transform pipeline so it shares one module graph with the app.
        {
            name: "webmcp-lab-ssr-no-external-catalyst-core",
            config: () => ({
                ssr: {
                    noExternal: ["catalyst-core"],
                },
            }),
        },
    ],
}
