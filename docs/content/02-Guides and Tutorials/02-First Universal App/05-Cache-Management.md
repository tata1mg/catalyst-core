# Universal App Cache Management

## Overview
The cache manager implementation provides efficient caching mechanisms for web resources in both Android and iOS WebView applications. It supports configurable caching patterns, revalidation strategies, and automatic cache cleanup.

## Configuration

### Android Configuration
Configure caching through the `config.json` file:

```json
{
  "WEBVIEW_CONFIG": {
    "android": {
      "cachePattern": "*.css,*.js"
    }
  }
}
```

Configuration options:
- `cachePattern`: Comma-separated list of file patterns to cache (e.g., "*.css,*.js")

The command decides the build type, not the config: `npm run android` makes a debug build for development with Hot Module Replacement (HMR), and `npm run android:release` makes the release build. `buildType` in `WEBVIEW_CONFIG.android` is deprecated.

### iOS Configuration
Configure caching through `WEBVIEW_CONFIG.ios.cachePattern`:

```json
{
  "WEBVIEW_CONFIG": {
    "ios": {
      "cachePattern": ["*.css", "*.js"]
    }
  }
}
```

Configuration options:
- `cachePattern`: An array of file patterns to cache (e.g., `["*.css", "*.js"]`). A single string is read as one pattern, not split on commas.

`npm run ios` makes a debug build for development, and `npm run ios:release` makes the release build. `buildType` in `WEBVIEW_CONFIG.ios` is deprecated.

## Cache Pattern Format

Both platforms support wildcard patterns for cache matching:
- `*.css`: Matches all CSS files
- `*.js`: Matches all JavaScript files
- Multiple patterns go in one comma-separated string on Android, and in an array on iOS
- File extensions are case-insensitive

## Internal Implementation

### Android Cache Manager

The Android implementation features:

1. Two-Level Caching:
   - Memory cache using LruCache for fast access
   - Disk cache for persistence
   
2. Cache Entry Management:
   - Cache entries include:
     - Response data
     - Timestamp
     - ETag
     - Last-Modified headers

3. Cache Validation Strategy:
   - Implements stale-while-revalidate pattern
   - Handles cache expiration
   - Supports background revalidation

4. Automatic Cache Maintenance:
   - Maximum cache size: 100MB
   - Automatic cleanup of expired entries
   - LRU (Least Recently Used) eviction policy

### iOS Cache Manager

The iOS implementation uses a custom URL protocol :

1. Request Interception:
   - Intercepts WebView requests matching cache patterns
   - Handles both HTTP and HTTPS schemes

2. Caching Strategy:
   - Checks cache before network requests
   - Supports conditional requests (ETag, Last-Modified)
   - Automatic cache invalidation

3. Resource Handling:
   - MIME type preservation
   - Content validation
   - Error handling

## Cache Lifecycle

The cache implements a sophisticated lifecycle management strategy that balances performance with data freshness:

### Content States

1. Fresh Content (< 24 hours)
   - Content is served directly from cache
   - No network requests made
   - Fastest possible response time

2. Stale Content (24-25 hours)
   - Content is served from cache immediately
   - Background revalidation is triggered
   - User sees cached content while fresh data is fetched
   - Updates cache if content has changed

3. Expired Content (> 25 hours)
   - Cache entry is considered invalid
   - Fresh content is fetched from network
   - New cache entry is created
   - User waits for network response

This stale-while-revalidate pattern provides:
- Optimal user experience with immediate responses
- Efficient network usage
- Up-to-date content without sacrificing performance
- Graceful handling of network issues

## Best Practices

1. Cache Pattern Selection:
   - Cache static assets (CSS, JS, images)
   - Avoid caching dynamic content
   - Use specific patterns to prevent over-caching

2. Development Workflow:
   - Develop with debug builds (`npm run android`, `npm run ios`)
   - Test cache patterns thoroughly in release builds (`npm run android:release`, `npm run ios:release`)

3. Memory Management:
   - Monitor cache size in low-memory conditions
   - Implement cache cleanup when app goes to background

### Production vs Development

Keep one `cachePattern` for both and pick the build with the command:

```bash
# Development: debug build against the dev server, with HMR
npm run android
npm run ios

# Production: signed release build
npm run android:release
npm run ios:release
```

In apps created before Catalyst 1.2.0, run `npm run buildApp:android` and `npm run buildApp:ios`, and add `-- --release` for the release build, for example `npm run buildApp:android -- --release`. Setting `buildType` to `release` still builds a release, with a deprecation warning.
