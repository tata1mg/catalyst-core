---
title: File Conventions
slug: file-conventions
id: file-conventions
---

# File Conventions

Catalyst keeps the application structure explicit. Routes, server hooks, client entry points, and static assets each have clear locations so the framework can build, render, and hydrate the app predictably.

## The App Contract

Catalyst imports a fixed set of files from your app by path. These paths are not configurable. If a file is missing, or does not export what Catalyst expects, Catalyst reports it at startup with an error naming the file and the missing export.

| Path | Expected export | Used for |
|------|-----------------|----------|
| `server/document.js` | default export: React component | The outer HTML document |
| `server/index.js` (optional) | named exports: `preServerInit` and the SSR lifecycle hooks | Server lifecycle |
| `server/server.js` | named export: `addMiddlewares` function | Express middleware registration |
| `src/js/containers/App/index` | default export: React component | Application shell |
| `src/js/routes/utils` | named export: `getRoutes` function | Route configuration |
| `src/js/store/index.js` (optional) | default export: `configureStore` function | Redux store creation |

`server/index.js` is optional. Every importer wraps the import in a try/catch and continues, so a missing file simply means the app registers no server lifecycle hooks. Every hook the file exports is itself optional too.

`src/js/store/index.js` is optional. When the file is absent, a Vite plugin (`optionalTemplateStorePlugin`) substitutes a stub store exposing `getState`, `dispatch`, `subscribe`, and `replaceReducer`. The `none-js` and `none-ts` templates ship without a store file and rely on this stub.

The remaining four paths are mandatory.

### Required Module Aliases

Your root `package.json` must define a `_moduleAliases` object containing all six aliases below. Catalyst resolves app code through them during build and SSR.

| Alias | Conventional target |
|-------|---------------------|
| `@api` | `api.js` |
| `@containers` | `src/js/containers` |
| `@server` | `server` |
| `@config` | `config` |
| `@css` | `src/static/css` |
| `@routes` | `src/js/routes/` |

Alias names may not contain the string `catalyst`; that keyword is reserved for the framework's own internal aliases.

### Startup Validation

Catalyst checks part of the contract at load time and reports every violation it finds through the shared error reporter, then continues starting. Each report names the specific file and export involved along with what the app must provide, and its detail level follows the output mode (see the error handling guide). A violation is not fatal on its own: the app keeps booting and the real failure surfaces where the missing piece is used, so read the startup output when a render fails for no obvious reason.

Three checks are wired:

- `getRoutes` and `configureStore` are validated when the renderer module loads — at server startup in production, and on the first SSR request in development, where the handler is loaded lazily.
- The `addMiddlewares` export from `server/server.js` is validated for shape during server setup.
- A missing `server/server.js` does fail at startup outright: its import is unguarded, unlike the try/catch around `server/index.js`.

Module aliases and `config/config.json` keys are not validated at startup. A missing alias or config key surfaces as a resolution or runtime error where it is used. See [Configuration](/docs/configuration) for the full key list.

## Core Project Layout

| Path | Purpose |
|------|---------|
| `config/config.json` | Runtime and build configuration |
| `src/js/routes/index.js` | Route definitions |
| `src/js/routes/utils.js` | Route preparation and `RouterDataProvider` wiring |
| `client/index.js` | Client entry and hydration |
| `server/index.js` | Server lifecycle hooks |
| `server/server.js` | Express middleware registration |
| `server/document.js` | HTML document template |
| `public/` | Static files served as-is |
| `src/static/` | Source-controlled CSS, fonts, and other bundled static assets |

## Routing Files

Catalyst uses a central route definition file instead of file-based routing.

```javascript title="src/js/routes/index.js"
import HomePage from "@pages/HomePage";
import ProductPage from "@pages/ProductPage";

const routes = [
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/product/:id",
    element: <ProductPage />,
  },
];

export default routes;
```

Common route properties:

| Property | Purpose |
|----------|---------|
| `path` | URL pattern |
| `element` | React element to render |
| `children` | Nested routes |
| `data` or route fetchers | Route-level data loading, depending on the app setup |
| `preload` | Optional preloading behavior |

## Route Components

Page components typically live under your pages or containers directory and can define route fetchers on the component itself:

```javascript
function ProductPage() {
  return <div>...</div>;
}

ProductPage.serverFetcher = async ({ params }) => {
  return fetchProduct(params.id);
};

ProductPage.clientFetcher = async ({ params }) => {
  return fetchProduct(params.id);
};

export default ProductPage;
```

## Layout and Shell

Persistent UI such as headers, footers, and navigation belongs in the app shell rather than in every page component. The shell stays mounted while matched route components change inside it.

Typical responsibilities:

- global providers
- top-level layout structure
- navigation
- route outlet placement

## Server Files

### `server/index.js`

Export lifecycle hooks used by the SSR server:

- `preServerInit`
- `onRouteMatch`
- `onServerError`

An empty export is valid if the app does not need custom server hooks yet.

### `server/server.js`

Register Express middlewares, request handling extensions, and any app-specific server customisation.

### `server/document.js`

Controls the outer HTML document structure, including tags, metadata wrappers, and shell-level markup.

## Static Asset Conventions

| Location | Usage |
|----------|-------|
| `public/` | Files served without bundling |
| `src/static/css` | Global stylesheets |
| `src/static/fonts` | Font files |
| `public/android/` | Android-specific native assets |
| `public/ios/` | iOS-specific native assets |

For universal apps, keep platform assets under `public/android` and `public/ios` so the native build scripts can discover them during packaging.

## Recommended Team Convention

- Keep route definitions in `src/js/routes/index.js`.
- Keep route preparation logic in `src/js/routes/utils.js`.
- Keep reusable layout code in a dedicated app shell container.
- Treat `config/config.json` as the single source of truth for runtime configuration.
