---
title: Code Splitting
slug: code-splitting
id: code-splitting
---

# Code Splitting

## Catalyst 0.3.x+

Use `split()` from `catalyst-core` for Vite-aware code splitting that works with Catalyst SSR and
client hydration.

```jsx title="src/js/routes/index.js"
import { split } from "catalyst-core"
import HomeFallback from "@Fallback/HomeFallback/HomeFallback.js"

const Home = split(() => import("@pages/Home/Home.js"), {
    ssr: true,
    fallback: <HomeFallback />,
})

const Chart = split(() => import("@components/Chart/Chart.js"), {
    ssr: false,
    fallback: <div>Loading chart...</div>,
})
```

The client entry must wait for split modules used by SSR before hydrating:

```jsx title="client/index.js"
import { RouterProvider, hydrationReady } from "catalyst-core"
import { hydrateRoot } from "react-dom/client"

window.addEventListener("load", () => {
    hydrationReady().then(() => {
        hydrateRoot(document.getElementById("app"), <RouterProvider router={router} />)
    })
})
```

### Options

| Option | Type | Description |
| --- | --- | --- |
| `ssr` | boolean | Render on the server. Defaults to `true`. |
| `fallback` | ReactNode | Content rendered while the split module loads. |
| `rootOptions` | object | Intersection observer options for visibility-based loading. |
| `onVisible` | function | Called when a visibility-loaded split component becomes visible. |

Route components keep their `serverFetcher`, `clientFetcher`, and `setMetaData` statics when wrapped
with `split()`.

## Legacy Catalyst 0.2.x

Catalyst `0.2.x` uses `@loadable/component` and `loadableReady()`. Keep that implementation while
the application remains on `0.2.x`; replace it with `split()` and `hydrationReady()` as part of the
`0.3.x` migration. Do not install `@loadable/component` in a `0.3.x` application.

## Best Practices

1. Split route-level components before small leaf components.
2. Keep SSR enabled for above-the-fold and SEO-critical content.
3. Use `ssr: false` for browser-only components and provide a hydration-stable fallback.
4. Use meaningful loading skeletons that match the final component dimensions.
