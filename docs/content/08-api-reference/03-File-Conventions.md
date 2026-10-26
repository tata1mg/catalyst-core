---
title: File Conventions
slug: file-conventions
id: file-conventions
---

# File Conventions

Catalyst keeps the application structure explicit. Routes, server hooks, client entry points, and static assets each have clear locations so the framework can build, render, and hydrate the app predictably.

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
