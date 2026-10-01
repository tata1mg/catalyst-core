---
title: Vite Customization (0.3.x+)
slug: vite-customization
id: vite-customization
---

# Vite Customization (Catalyst 0.3.x+)

Catalyst `0.3.x` builds the browser and SSR runtimes with Vite. Applications can append plugins to
either pipeline through a root-level `buildConfig.js` file.

```javascript title="buildConfig.js"
import svgr from "vite-plugin-svgr"

export default {
    clientPlugins: [svgr()],
    ssrPlugins: [],
}
```

## Configuration Contract

`clientPlugins` are appended to the production browser build. `ssrPlugins` are appended to the
production server-renderer build. Both values default to empty arrays.

Use client-only plugins only in `clientPlugins`. Plugins that transform modules required during SSR
must also be included in `ssrPlugins` when their server behavior is compatible.

Catalyst owns the rest of the Vite configuration, including aliases, React transformation, SSR
externals, output directories, manifests, split-component cache keys, and asset categorization.
The application hook is intentionally limited to plugins so project customization cannot replace
those runtime contracts.

## Legacy Filename Compatibility

Catalyst `0.3.x` also looks for `webpackConfig.js` when `buildConfig.js` does not exist. This only
preserves the filename during migration. The file must export the Vite plugin object shown above;
legacy webpack configuration callbacks and webpack plugins do not run under Vite.

Prefer `buildConfig.js` for new and upgraded applications.

## Development And Production

`npm run start` starts Vite middleware mode with SSR and Fast Refresh. `npm run build` creates the
client and server production outputs, and `npm run serve` runs the built renderer.

`devBuild` and `devServe` are legacy Catalyst `0.2.x` commands and are not available in `0.3.x`.

## Output Layout

The default production layout is:

```text
build/
├── client/
│   └── assets/
├── server/
│   └── index.js
├── .vite/
├── catalyst-offline-manifest.json
├── catalyst-sw.js
└── offline.html
```

`offline.html` is present only when the application provides `public/offline.html`.
