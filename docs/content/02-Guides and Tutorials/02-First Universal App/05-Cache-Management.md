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
      "buildType": "debug",
      "cachePattern": "*.css,*.js"
    }
  }
}
```

Configuration options:
- `buildType`: Set to "debug" to bypass caching. This is crucial for development with Hot Module Replacement (HMR), ensuring that WebView receives real-time updates without cache interference
- `cachePattern`: Comma-separated list of file patterns to cache (e.g., "*.css,*.js")

### iOS Configuration
Configure caching by setting cache patterns in constants:
- Define patterns for files to be cached (e.g., CSS and JS files)
- Multiple patterns can be specified in an array

## Cache Pattern Format

Both platforms support wildcard patterns for cache matching:
- `*.css`: Matches all CSS files
- `*.js`: Matches all JavaScript files
- Multiple patterns can be specified
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
   - Use debug buildType for development to bypass cache
   - Test cache patterns thoroughly in production builds

3. Memory Management:
   - Monitor cache size in low-memory conditions
   - Implement cache cleanup when app goes to background

### Production vs Development
```json
{
  "WEBVIEW_CONFIG": {
    "android": {
      "buildType": "debug",  // Development: enables HMR
      "cachePattern": "*.css,*.js"
    }
  }
}
```
```json
{
  "WEBVIEW_CONFIG": {
    "android": {
      "buildType": "release",  // Production: enables caching
      "cachePattern": "*.css,*.js"
    }
  }
}
```
