# Changelog - SSR Asset Management Refactor

## Version: [0.0.2-canary.1]

**Date:** 05-08-2025

### 🚀 Major Features

#### **New Asset Management System**

-   **Added `ChunkExtractor` class** (`src/server/renderer/ChunkExtractor.js`)
    -   Intelligent asset tracking during SSR rendering
    -   Separates essential vs non-essential assets for optimal loading
    -   Compatible with Vite's manifest and chunk splitting system
    -   Enhanced CSS registry support for deduplication

#### **Smart Code Splitting with SSR Control**

-   **Added `Split` component** (`src/web-router/components/Split.jsx`)
    -   SSR-aware code splitting with `ssr` flag support
    -   Seamless fallback handling for client-side rendering
    -   Automatic asset tracking integration with ChunkExtractor

#### **Advanced Build Pipeline**

-   **Added Manifest Categorization Plugin** (`src/vite/manifest-categorization-plugin.js`)

    -   Automatically categorizes assets into: `essential`, `ssrTrue`, `ssrFalse`
    -   Generates `asset-categories.json` for build-time asset optimization
    -   Tracks split module dependencies and chunk relationships

-   **Added Cache Key Injection Plugin** (`src/vite/inject-cache-key-plugin.js`)
    -   Automatically injects cache keys into split calls for better asset tracking
    -   Resolves import paths using Vite aliases
    -   Enables precise manifest key matching

### 🔧 Core Improvements

#### **Server-Side Rendering Enhancements**

-   **Refactored `handler.jsx`**:
    -   Replaced legacy asset extraction with ChunkExtractor-based system
    -   Implemented streaming SSR with `renderToPipeableStream`
    -   Added two-phase asset loading (essential + non-essential)
    -   Improved error handling and fallback mechanisms
    -   Dynamic store loading with better validation

#### **Asset Loading Strategy**

-   **Enhanced `extract.js`**:
    -   New CSS stylesheet link generation (replaces inline CSS)
    -   Proper asset URL resolution with protocol/host handling
    -   Deduplication of assets to prevent duplicates
    -   Support for both React elements and HTML string generation

#### **Document Structure Updates**

-   **Updated `Head.jsx`**:

    -   Changed from inline CSS to stylesheet links
    -   Added support for CSS loading strategies
    -   Better separation of critical and non-critical resources

-   **Updated `Body.jsx`**:
    -   Removed legacy `firstFoldCss` and `firstFoldJS` props
    -   Cleaner prop structure and validation

### ⚙️ Configuration & Build Changes

#### **Vite Configuration Updates**

-   **Client Config** (`vite.config.client.js`):

    -   Integrated manifest categorization plugin
    -   Enhanced asset processing pipeline

-   **Server Config** (`vite.config.server.js`):

    -   Added cache key injection for split calls
    -   Improved SSR build optimization

-   **Base Config** (`vite.config.js`):
    -   Added manual chunk splitting for vendor code
    -   Improved build output structure (`public` → `client`)
    -   Enhanced sourcemap and minification settings

#### **Express Server Updates**

-   **Enhanced `expressServer.js`**:
    -   Added `assetManifest` loading and processing
    -   Updated static asset serving paths
    -   Better error handling for manifest loading
    -   CSS loading strategies tracking

### 🏗️ API & Export Changes

#### **New Exports**

-   Added `split` function export from main index
-   Added `ChunkExtractor` class export
-   Enhanced component and utility exports

#### **Prop Changes**

-   **Head Component**:

    -   `pageCss`: Changed from `string` to `array` for stylesheet links

-   **Body Component**:
    -   Removed `firstFoldCss` and `firstFoldJS` props
    -   Streamlined component interface

### 🗑️ Removals & Deprecations

#### **Removed Legacy Features**

-   Removed `.eslintrc` configuration file
-   Eliminated legacy CSS caching system (`cacheCSS`, `cacheJS` functions)
-   Removed inline CSS injection in favor of stylesheet links
-   Deprecated two-pass component tracking system

#### **Simplified Architecture**

-   Removed complex asset processing logic in favor of ChunkExtractor
-   Eliminated legacy loadable-stats.json dependencies
-   Streamlined asset URL generation and management

### 🔄 Breaking Changes

1. **CSS Loading**: Changed from inline CSS to stylesheet links
2. **Asset Paths**: Updated from `/public/` to `/client/` for built assets
3. **Component Props**: Removed `firstFoldCss` and `firstFoldJS` from Body component
4. **Build Output**: Modified build directory structure
5. **Store Loading**: Changed from async import to dynamic resolution

### 📈 Performance Improvements

-   **Reduced Bundle Size**: Better chunk splitting and tree shaking
-   **Faster Initial Load**: Essential vs non-essential asset separation
-   **Improved Caching**: Enhanced asset categorization for better cache strategies
-   **Streaming SSR**: Non-blocking server-side rendering with progressive enhancement
-   **Asset Deduplication**: Prevents loading duplicate resources

### 🛠️ Developer Experience

-   **Better Debugging**: Enhanced error messages and warnings
-   **Improved Build Process**: Clearer asset categorization and tracking
-   **Flexible SSR Control**: Per-component SSR enable/disable via `split` function
-   **Enhanced Development**: Better hot reload and asset serving in development mode

### 📋 Migration Notes

1. **Update Split Usage**: Replace legacy code splitting with new `split()` function
2. **Asset Paths**: Update any hardcoded asset paths from `/public/` to `/client/`
3. **CSS Loading**: Remove any custom CSS inlining logic - now handled automatically
4. **Build Scripts**: Ensure new Vite plugins are included in build configuration
5. **Store Configuration**: Update store imports to use dynamic loading pattern

### 🐛 Bug Fixes

-   Fixed asset URL resolution in different environments
-   Improved error handling in asset loading
-   Better fallback mechanisms for failed component loads
-   Enhanced compatibility with different hosting setups
-   Fixed chunk dependency tracking accuracy

---

### Technical Details

**New Dependencies**: None (uses existing Vite and React ecosystem)
**Minimum Requirements**: Vite-based build system, React 18+ for Suspense improvements
**Backward Compatibility**: Limited - requires migration of existing split usage
