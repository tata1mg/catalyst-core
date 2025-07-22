# SSR Code-Splitting with Vite

This document explains how to use the server-side rendering (SSR) code-splitting solution that's compatible with Vite, similar to the `@loadable/component` library but specifically designed for Vite's module system.

## Overview

The SSR code-splitting solution provides:

1. **Split Component**: Wraps React's lazy and Suspense for SSR compatibility
2. **ChunkExtractor Class**: Tracks which chunks/modules are loaded during SSR
3. **Server-Side Integration**: Extracts chunk information and injects script tags
4. **Vite Compatibility**: Works with Vite's ES modules and build system

## Quick Start

### Basic Usage

```jsx
import React from "react"
import { Split } from "catalyst-core"

const MyComponent = () => (
    <Split ssr={true} fallback={<div>Loading...</div>}>
        {() => import("./components/MyLazyComponent")}
    </Split>
)
```

### Helper Functions

```jsx
import { createSplit, split } from "catalyst-core"

// Using createSplit
const LazyComponent = createSplit(() => import("./components/MyComponent"), {
    ssr: true,
    fallback: <div>Loading...</div>,
})

// Using split utility
const AnotherComponent = split(
    () => import("./components/AnotherComponent"),
    <div>Loading...</div>, // fallback
    true // ssr enabled
)
```

## API Reference

### Split Component

The `Split` component wraps React's lazy loading with SSR support.

#### Props

| Prop       | Type                                                | Default  | Description                                     |
| ---------- | --------------------------------------------------- | -------- | ----------------------------------------------- |
| `ssr`      | `boolean`                                           | `true`   | Whether to render the component on the server   |
| `fallback` | `React.ComponentType \| React.ReactElement \| null` | `null`   | Fallback component for loading state            |
| `children` | `() => Promise<{ default: React.ComponentType }>`   | Required | Function that returns the lazy component import |

#### Behavior

-   **Server with SSR enabled**: Attempts to render the actual component
-   **Server with SSR disabled**: Always returns the fallback
-   **Client**: Uses normal lazy loading with Suspense

### createSplit Function

Higher-order function to create a split component with predefined options.

```jsx
createSplit(importFn, options)
```

#### Parameters

-   `importFn`: Function that returns a dynamic import
-   `options`: Configuration object with `ssr` and `fallback` properties

### split Function

Utility function to create a split component with explicit parameters.

```jsx
split(importFn, fallback, ssr)
```

#### Parameters

-   `importFn`: Function that returns a dynamic import
-   `fallback`: Fallback component or element
-   `ssr`: Boolean to enable/disable SSR

### ChunkExtractor Class

Tracks and extracts chunks during SSR for proper client-side hydration.

#### Constructor

```jsx
import { ChunkExtractor } from "catalyst-core"

const chunkExtractor = new ChunkExtractor({
    manifest: clientManifest, // Vite client manifest
    ssrManifest: ssrManifest, // Vite SSR manifest
    entrypoints: ["main"], // Entry point names
})
```

#### Methods

| Method                   | Description                   | Returns                         |
| ------------------------ | ----------------------------- | ------------------------------- |
| `addChunk(chunkName)`    | Add a chunk by name or path   | `void`                          |
| `addComponent(importFn)` | Add a component for tracking  | `void`                          |
| `getChunks()`            | Get all tracked chunks        | `string[]`                      |
| `getAssets()`            | Get all extracted assets      | `{js: string[], css: string[]}` |
| `getScriptTags(options)` | Get script tags for JS assets | `TagProps[]`                    |
| `getLinkTags(options)`   | Get link tags for CSS assets  | `TagProps[]`                    |
| `reset()`                | Reset the extractor state     | `void`                          |
| `cleanup()`              | Clean up global references    | `void`                          |

## Server-Side Integration

### Basic Integration

```jsx
import { ChunkExtractor } from "catalyst-core"
import { renderToString } from "react-dom/server"

export const renderWithChunks = (req, res, App) => {
    // Create ChunkExtractor with Vite manifests
    const chunkExtractor = new ChunkExtractor({
        manifest: req.manifest,
        ssrManifest: req.ssrManifest,
        entrypoints: ["main", "client/index.jsx"],
    })

    // Render app (this populates the ChunkExtractor)
    const html = renderToString(<App />)

    // Get extracted assets
    const scriptTags = chunkExtractor.getScriptTags()
    const linkTags = chunkExtractor.getLinkTags()

    // Generate full HTML
    const fullHtml = `
        <!DOCTYPE html>
        <html>
            <head>
                ${linkTags.map((tag) => renderTag(tag)).join("")}
            </head>
            <body>
                <div id="root">${html}</div>
                ${scriptTags.map((tag) => renderTag(tag)).join("")}
            </body>
        </html>
    `

    chunkExtractor.cleanup()
    res.send(fullHtml)
}
```

### Integration with Existing SSR

The solution integrates with the existing SSR setup by enhancing the two-pass rendering:

```jsx
// In src/server/renderer/handler.jsx
const performTwoPassRendering = (store, context, req, fetcherData, ssrManifest, manifest) => {
    const chunkExtractor = new ChunkExtractor({
        manifest: manifest || {},
        ssrManifest: ssrManifest || {},
        entrypoints: ["main", "client/index.jsx"],
    })

    // First pass renders and tracks components
    renderToString(<App />)

    // Extract discovered assets
    const discoveredAssets = chunkExtractor.getAssets()

    chunkExtractor.cleanup()
    return discoveredAssets
}
```

## Advanced Usage

### Conditional SSR

```jsx
const ConditionalComponent = ({ userAgent }) => {
    const isBot = /googlebot|bingbot/i.test(userAgent)

    return (
        <Split
            ssr={isBot} // Only SSR for bots
            fallback={<div>Loading for humans...</div>}
        >
            {() => import("./components/HeavyComponent")}
        </Split>
    )
}
```

### Route-Level Code Splitting

```jsx
import { Split } from "catalyst-core"

const routes = [
    {
        path: "/dashboard",
        component: () => (
            <Split ssr={true} fallback={<div>Loading dashboard...</div>}>
                {() => import("./pages/Dashboard")}
            </Split>
        ),
    },
]
```

### Performance Optimization

```jsx
// Preload critical components
const CriticalComponent = split(
    () => import("./components/Critical"),
    null, // No fallback for critical components
    true // Always SSR
)

// Client-only components for interactivity
const InteractiveComponent = split(
    () => import("./components/Interactive"),
    <div>Interactive features loading...</div>,
    false // Never SSR
)
```

## Vite Configuration

Ensure your Vite configuration supports SSR manifests:

```js
// vite.config.client.js
export default defineConfig({
    build: {
        manifest: true,
        ssrManifest: true,
        rollupOptions: {
            input: {
                main: 'client/index.jsx'
            }
        }
    }
})

// vite.config.server.js
export default defineConfig({
    build: {
        manifest: true,
        ssrManifest: true,
        rollupOptions: {
            input: {
                server: 'src/server/renderer/index.js'
            }
        }
    }
})
```

## Best Practices

1. **Use SSR for SEO-critical components**: Enable SSR for components that need to be crawled by search engines
2. **Disable SSR for interactive components**: Interactive components that don't affect SEO can be client-only
3. **Provide meaningful fallbacks**: Always provide loading states that match your design system
4. **Clean up ChunkExtractor**: Always call `cleanup()` after rendering to prevent memory leaks
5. **Monitor bundle sizes**: Use Vite's bundle analyzer to ensure code splitting is effective

## Troubleshooting

### Common Issues

1. **Components not being tracked**: Ensure the import function contains a literal string path
2. **Missing assets**: Check that Vite manifests are being passed correctly to ChunkExtractor
3. **Hydration mismatches**: Ensure SSR and client rendering conditions are consistent

### Debug Mode

Enable debug logging by setting the environment variable:

```bash
DEBUG=catalyst:ssr-splitting npm start
```

## Migration from @loadable/component

If migrating from `@loadable/component`, here's the mapping:

```jsx
// Before (@loadable/component)
import loadable from "@loadable/component"

const LazyComponent = loadable(() => import("./Component"), {
    ssr: true,
    fallback: <div>Loading...</div>,
})

// After (catalyst-core)
import { split } from "catalyst-core"

const LazyComponent = split(() => import("./Component"), <div>Loading...</div>, true)
```

## Performance Impact

The SSR code-splitting solution provides:

-   **Reduced initial bundle size**: Only critical components are included in the main bundle
-   **Faster page loads**: Non-critical components load asynchronously
-   **Better SEO**: Server-rendered content is immediately available to crawlers
-   **Improved user experience**: Progressive loading with meaningful fallbacks

## Browser Support

The solution works in all modern browsers that support:

-   ES6 modules
-   Dynamic imports
-   React 18+

For older browsers, ensure your build process includes appropriate polyfills.
