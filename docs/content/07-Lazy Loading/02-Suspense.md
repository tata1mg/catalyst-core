---
title: Suspense
slug: suspense
id: suspense
---

Catalyst provides advanced Suspense support with intelligent SSR asset management powered by Vite. The latest version `v0.0.2-canary.1` introduces smart code splitting with per-component SSR control and automatic asset categorization.

## Installation

```bash
npx create-catalyst-app@v0.0.2-canary.1
```

## Overview

Catalyst's Suspense implementation runs on Vite's build pipeline and provides:

- **Smart Code Splitting**: Automatic asset categorization (essential, SSR-enabled, SSR-disabled)
- **Per-Component SSR Control**: Fine-grained control over server-side rendering
- **Intelligent Asset Loading**: Essential assets load first, non-essential assets load progressively
- **Streaming SSR**: Non-blocking server-side rendering with progressive enhancement
- **Automatic Asset Deduplication**: Prevents loading duplicate resources

## The `split()` Function

Use the `split()` function instead of `React.lazy()` for enhanced SSR compatibility and asset management:

### Basic Usage

```js
import { split } from "catalyst"

// Basic split with SSR enabled (default)
const LazyComponent = split(() => import("./LazyComponent"))

// With custom fallback
const LazyComponent = split(() => import("./LazyComponent"), {
    fallback: <div>Loading component...</div>
})

// Usage in component
const Home = () => {
    return (
        <div>
            <LazyComponent />
        </div>
    )
}
```

### SSR Control

Control whether components render on the server using the `ssr` flag:

```js
// Component renders on server (default)
const ServerRenderedComponent = split(() => import("./ServerComponent"), {
    ssr: true,
    fallback: <div>Loading...</div>
})

// Component only renders on client
const ClientOnlyComponent = split(() => import("./ClientComponent"), {
    ssr: false,
    fallback: <div>Client-side only component loading...</div>
})
```

### Real-World Examples

**Dashboard with Mixed SSR Strategy:**

```js
import { split } from "catalyst"

// Critical above-the-fold content - SSR enabled
const DashboardHeader = split(() => import("./DashboardHeader"), {
    ssr: true,
    fallback: <div className="header-skeleton">Loading header...</div>
})

// Interactive widgets - client-side only for better performance
const InteractiveChart = split(() => import("./InteractiveChart"), {
    ssr: false,
    fallback: <div className="chart-skeleton">Loading chart...</div>
})

// Settings modal - lazy load when needed
const SettingsModal = split(() => import("./SettingsModal"), {
    ssr: false,
    fallback: null // No fallback needed for modals
})

const Dashboard = () => {
    return (
        <div>
            <DashboardHeader />
            <div className="content">
                <InteractiveChart />
                {/* SettingsModal loads only when state changes trigger it */}
                <SettingsModal />
            </div>
        </div>
    )
}
```

## Asset Management

Catalyst automatically categorizes your assets based on how you use `split()`:

### Asset Categories

1. **Essential Assets**: Core app functionality, entry points, shared utilities
2. **SSR-Enabled Assets**: Components with `ssr: true` that load during server rendering
3. **SSR-Disabled Assets**: Components with `ssr: false` that load only on the client

### Loading Strategy

```js
// This happens automatically:
// 1. Essential assets load immediately
// 2. SSR-enabled assets load during server rendering
// 3. SSR-disabled assets load progressively on client
```

## Migration from React.lazy

If you're upgrading from standard `React.lazy`, here's how to migrate:

### Before (React.lazy)

```js
import React, { Suspense, lazy } from "react"

const LazyComponent = lazy(() => import("./LazyComponent"))

const App = () => (
    <Suspense fallback={<div>Loading...</div>}>
        <LazyComponent />
    </Suspense>
)
```

### After (Catalyst split)

```js
import { split } from "catalyst"

const LazyComponent = split(() => import("./LazyComponent"), {
    ssr: true, // or false based on your needs
    fallback: <div>Loading...</div>
})

const App = () => <LazyComponent />
```

## Advanced Patterns

### Conditional SSR Based on User Agent

```js
const MobileOptimizedComponent = split(() => import("./MobileComponent"), {
    ssr: true,
    fallback: <div>Loading mobile view...</div>
})

const DesktopComponent = split(() => import("./DesktopComponent"), {
    ssr: true,
    fallback: <div>Loading desktop view...</div>
})
```

### Progressive Enhancement

```js
// Base functionality loads with SSR
const BaseArticle = split(() => import("./BaseArticle"), {
    ssr: true,
    fallback: <div>Loading article...</div>
})

// Enhanced features load client-side
const ArticleInteractions = split(() => import("./ArticleInteractions"), {
    ssr: false,
    fallback: null
})

const ArticlePage = () => (
    <div>
        <BaseArticle />
        <ArticleInteractions />
    </div>
)
```

## Best Practices

### 1. SSR Strategy

- **Enable SSR** for above-the-fold content and SEO-critical components
- **Disable SSR** for highly interactive widgets, client-dependent features
- **Use progressive enhancement** by layering client-only features over SSR base content

### 2. Fallback Design

```js
// Good: Meaningful loading states
const Component = split(() => import("./Component"), {
    fallback: <div className="skeleton">Loading content...</div>
})

// Better: Match expected content structure
const Component = split(() => import("./Component"), {
    fallback: (
        <div className="article-skeleton">
            <div className="title-skeleton" />
            <div className="content-skeleton" />
        </div>
    )
})
```

### 3. Performance Optimization

```js
// Group related components to reduce chunk fragmentation
const UserProfile = split(() => import("./user/UserProfile"))
const UserSettings = split(() => import("./user/UserSettings"))
const UserActivity = split(() => import("./user/UserActivity"))
```

## Troubleshooting

### Components Not Loading on Server

If your component depends on `clientFetcher` data and fails on the server:

```js
const DataDependentComponent = split(() => import("./DataComponent"), {
    ssr: false, // Disable SSR for client-data dependent components
    fallback: <div>Loading data-driven content...</div>
})
```

### Asset Loading Issues

The build system automatically handles asset categorization. If you experience issues:

1. Check that imports use relative paths or configured aliases
2. Ensure components are properly exported as default exports

## Build System Integration

Catalyst's Suspense features integrate with Vite's build system:

- **Manifest Categorization Plugin**: Automatically categorizes assets during build
- **Cache Key Injection Plugin**: Optimizes asset tracking and loading
- **ChunkExtractor**: Intelligently manages asset dependencies during SSR

This integration ensures optimal performance without manual configuration.
