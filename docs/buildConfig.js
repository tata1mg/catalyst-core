export default {
    clientPlugins: [],
    ssrPlugins: [
        // catalyst-core's main entry (RouterDataProvider, useRouterState) and
        // its `catalyst-core/webmcp` subpath both need to see the SAME
        // React context instances — WebMcpProvider reads router state
        // through OneMgRouterContext rather than calling react-router hooks
        // itself specifically to avoid this. Under Vite's dev SSR, treating
        // catalyst-core as an externalized node_modules dependency lets its
        // main entry and its subpath resolve as two separate module
        // records, each with its own `createContext()` call — this
        // noExternal forces the whole package through Vite's transform
        // pipeline instead, so it shares one module graph with the app.
        // (Same fix as examples/webmcp-poc/buildConfig.js.)
        {
            name: 'docs-ssr-no-external-catalyst-core',
            config: () => ({
                ssr: {
                    noExternal: ['catalyst-core'],
                },
            }),
        },
    ],
}
