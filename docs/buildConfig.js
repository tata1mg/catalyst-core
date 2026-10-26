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
            // Dev only (`catalyst build` also spins up a Vite server for the
            // offline manifest, so key off NODE_ENV, not Vite's `command`): Vite matches noExternal by package name, so in a
            // production build it also inlines catalyst-core's CJS subpaths
            // (catalyst-core/hooks → "exports is not defined"). The
            // dual-instance problem is a dev-SSR artifact; built output
            // runs under plain Node ESM, one module record per file.
            config: () => (process.env.NODE_ENV === 'production' ? {} : {
                ssr: {
                    noExternal: ['catalyst-core'],
                },
            }),
        },
    ],
}
