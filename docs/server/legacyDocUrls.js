/**
 * Old docs URL → current docs URL, for the one content restructure that moved
 * them (category folders kebab-cased, several pages regrouped into new
 * categories, a handful of frontmatter slugs rewritten).
 *
 * Every key here was a live, indexed permalink before that restructure — the
 * Docusaurus-era scheme this app deliberately preserved when it took over those
 * URLs (see scripts/generate-docs-manifest.mjs) — and resolves to nothing now.
 * server/server.js 301s each one straight to its current home so search
 * results, external links and bookmarks keep working.
 *
 * Derived mechanically from the restructure's git renames: for each moved file,
 * the URL its old path produced under the manifest generator's rules, mapped to
 * the URL its new path produces today. Every value is a real, current manifest
 * URL. Keys are the decoded form ("/content/Guides and Tutorials/..." with
 * literal spaces); server.js decodes the request path before looking one up.
 *
 * This is a closed migration artifact, not a growing redirect system: it
 * describes one restructure that already happened. A future move of the same
 * kind wants its own pass over the same git-rename derivation, and any entry
 * whose value changes again should be rewritten to point at the newest URL so
 * every old link stays a single hop.
 */
const legacyDocUrls = new Map([
    [
        '/content/Introduction/why-catalyst',
        '/content/introduction/why-catalyst',
    ],
    [
        '/content/Introduction/features-overview',
        '/content/introduction/features-overview',
    ],
    [
        '/content/Introduction/universal-app',
        '/content/introduction/universal-app',
    ],
    [
        '/content/Introduction/getting-started',
        '/content/getting-started/overview',
    ],
    [
        '/content/Guides and Tutorials/First Catalyst App/installation',
        '/content/getting-started/installation',
    ],
    [
        '/content/Guides and Tutorials/First Catalyst App/quick-start',
        '/content/getting-started/quick-start',
    ],
    [
        '/content/Guides and Tutorials/First Catalyst App/folder-structure',
        '/content/getting-started/folder-structure',
    ],
    [
        '/content/Guides and Tutorials/First Catalyst App/configuration',
        '/content/getting-started/configuration',
    ],
    [
        '/content/Guides and Tutorials/First Catalyst App/environment-variables',
        '/content/getting-started/environment-variables',
    ],
    ['/content/Routing/routing/index', '/content/routing/defining-routes'],
    ['/content/Routing/navigation', '/content/routing/navigation'],
    [
        '/content/Routing/routing/router-data-provider',
        '/content/routing/router-data-provider',
    ],
    ['/content/styling', '/content/styling-and-assets/styling'],
    ['/content/fonts', '/content/styling-and-assets/fonts'],
    ['/content/Best Practices/Assets', '/content/styling-and-assets/Assets'],
    [
        '/content/Core Concepts/caching-of-assets-in-catalyst',
        '/content/styling-and-assets/caching-of-assets-in-catalyst',
    ],
    ['/content/Core Concepts/ssr-flow', '/content/core-concepts/ssr-flow'],
    [
        '/content/Core Concepts/universal-app-state-management-flow',
        '/content/core-concepts/universal-app-state-management-flow',
    ],
    [
        '/content/Core Concepts/universal-app-cache-management',
        '/content/core-concepts/cache-layers-overview',
    ],
    [
        '/content/Core Concepts/route-offline-snapshots',
        '/content/core-concepts/route-offline-snapshots',
    ],
    [
        '/content/Core Concepts/performance-profiling',
        '/content/core-concepts/performance-profiling',
    ],
    ['/content/API Reference/overview', '/content/api-reference/overview'],
    ['/content/API Reference/hooks', '/content/api-reference/hooks'],
    [
        '/content/API Reference/configuration-api',
        '/content/api-reference/configuration-api',
    ],
    [
        '/content/API Reference/file-conventions',
        '/content/api-reference/file-conventions',
    ],
    [
        '/content/API Reference/ssr-lifecycle',
        '/content/api-reference/ssr-lifecycle',
    ],
    [
        '/content/Guides and Tutorials/First Universal App/first-universal-app',
        '/content/guides-and-tutorials/first-universal-app/first-universal-app',
    ],
    [
        '/content/Guides and Tutorials/First Universal App/RunUniversalApp',
        '/content/guides-and-tutorials/first-universal-app/RunUniversalApp',
    ],
    [
        '/content/Guides and Tutorials/First Universal App/Offline-Support',
        '/content/guides-and-tutorials/first-universal-app/Offline-Support',
    ],
    [
        '/content/Guides and Tutorials/First Universal App/Cache-Management',
        '/content/guides-and-tutorials/first-universal-app/configuring-cache-behavior',
    ],
    [
        '/content/Guides and Tutorials/First Universal App/universal-app-configuration',
        '/content/guides-and-tutorials/first-universal-app/universal-app-configuration',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/pet-adoption-introduction',
        '/content/guides-and-tutorials/building-pet-adoption-app/pet-adoption-introduction',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/installation',
        '/content/guides-and-tutorials/building-pet-adoption-app/installation',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/route-with-mock-data',
        '/content/guides-and-tutorials/building-pet-adoption-app/route-with-mock-data',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/server-fetcher',
        '/content/guides-and-tutorials/building-pet-adoption-app/server-fetcher',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/navigation',
        '/content/guides-and-tutorials/building-pet-adoption-app/navigation',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/client-fetcher',
        '/content/guides-and-tutorials/building-pet-adoption-app/client-fetcher',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/styling',
        '/content/guides-and-tutorials/building-pet-adoption-app/styling',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/layout-setup',
        '/content/guides-and-tutorials/building-pet-adoption-app/layout-setup',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/asset-loading',
        '/content/guides-and-tutorials/building-pet-adoption-app/asset-loading',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/font-loading',
        '/content/guides-and-tutorials/building-pet-adoption-app/font-loading',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/code-splitting',
        '/content/guides-and-tutorials/building-pet-adoption-app/code-splitting',
    ],
    [
        '/content/Guides and Tutorials/Building Pet Adoption App/conclusion',
        '/content/guides-and-tutorials/building-pet-adoption-app/conclusion',
    ],
    [
        '/content/Guides and Tutorials/android-emulator-setup',
        '/content/guides-and-tutorials/native-development-setup/android-emulator-setup',
    ],
    [
        '/content/Guides and Tutorials/ios-emulator-setup',
        '/content/guides-and-tutorials/native-development-setup/ios-emulator-setup',
    ],
    [
        '/content/Guides and Tutorials/opentelemetry-integration',
        '/content/guides-and-tutorials/observability-and-ops/opentelemetry-integration',
    ],
    [
        '/content/Guides and Tutorials/sentry-integration',
        '/content/guides-and-tutorials/observability-and-ops/sentry-integration',
    ],
    [
        '/content/Guides and Tutorials/logging',
        '/content/guides-and-tutorials/observability-and-ops/logging',
    ],
    [
        '/content/Guides and Tutorials/adding-express-middlewares',
        '/content/guides-and-tutorials/server-customization/adding-express-middlewares',
    ],
    [
        '/content/Guides and Tutorials/customising-shell',
        '/content/guides-and-tutorials/server-customization/customising-shell',
    ],
    [
        '/content/Guides and Tutorials/linting',
        '/content/guides-and-tutorials/build-and-tooling/linting',
    ],
    [
        '/content/Guides and Tutorials/vite-customization',
        '/content/guides-and-tutorials/build-and-tooling/vite-customization',
    ],
    [
        '/content/Guides and Tutorials/module-aliases',
        '/content/guides-and-tutorials/build-and-tooling/module-aliases',
    ],
    [
        '/content/Guides and Tutorials/webpack-customization',
        '/content/guides-and-tutorials/legacy-0-2-x/webpack-customization',
    ],
    [
        '/content/Guides and Tutorials/react-compiler',
        '/content/guides-and-tutorials/legacy-0-2-x/react-compiler',
    ],
    ['/content/faqs', '/content/community-and-meta/faqs'],
    ['/content/contribution', '/content/community-and-meta/contribution'],
    ['/content/conferences', '/content/community-and-meta/conferences'],
    ['/content/Best Practices/seo', '/content/best-practices/seo'],
    ['/content/Best Practices/security', '/content/best-practices/security'],
    [
        '/content/Best Practices/data-fetching',
        '/content/best-practices/data-fetching-patterns',
    ],
    [
        '/content/Best Practices/universal-app',
        '/content/best-practices/universal-app',
    ],
    [
        '/content/Best Practices/android-build-optimization',
        '/content/best-practices/android-build-optimization',
    ],
    [
        '/content/Deployment/catalyst-app-deployment',
        '/content/deployment/catalyst-app-deployment',
    ],
    [
        '/content/Deployment/universal-app-deployment',
        '/content/deployment/universal-app-deployment',
    ],
    [
        '/content/Deployment/ios-production-release',
        '/content/deployment/ios-production-release',
    ],
    [
        '/content/Migration/NextJS-to-Catalyst',
        '/content/migration/NextJS-to-Catalyst',
    ],
    ['/content/Migration/0.0.1-beta.4', '/content/migration/0.0.1-beta.4'],
    [
        '/content/Migration/react-app-to-catalyst',
        '/content/migration/react-app-to-catalyst',
    ],
    [
        '/content/Lazy Loading/code-splitting',
        '/content/best-practices/code-splitting',
    ],
    ['/content/Lazy Loading/suspense', '/content/best-practices/suspense'],

    // Data Fetching, CLI Reference and MCP Integration moved out of the
    // uncategorized content root into a real category — see server/server.js
    // history around the docs-sidebar IA fix.
    ['/content/data-fetching', '/content/api-reference/data-fetching'],
    ['/content/cli-reference', '/content/api-reference/cli-reference'],
    [
        '/content/mcp-integration',
        '/content/guides-and-tutorials/mcp-integration',
    ],

    // The sidebar reorder that followed. Renumbering a folder's `NN-` prefix
    // is invisible to the URL (the generator strips it), so that pass moved
    // only three pages between categories — and only those three changed URL:
    // the Introduction roadmap page became the Getting Started category's own
    // landing item (retitled "Overview" so it stops reading as a duplicate of
    // the category it sits in), and the two-page Lazy Loading category was
    // folded into Best Practices. The three keys below were current URLs of
    // this app until then, so they redirect like the Docusaurus-era ones
    // above; the pre-existing keys that used to resolve to them were rewritten
    // in place to these destinations, keeping every old link a single hop.
    [
        '/content/introduction/getting-started',
        '/content/getting-started/overview',
    ],
    [
        '/content/lazy-loading/code-splitting',
        '/content/best-practices/code-splitting',
    ],
    ['/content/lazy-loading/suspense', '/content/best-practices/suspense'],
])

export default legacyDocUrls
