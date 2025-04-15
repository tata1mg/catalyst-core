# Changelog

## [0.0.1-beta.13] - 04-04-2025

-   Fixes a bug for client fetcher when importing components through loadable

## [0.0.1-beta.12] - 06-03-2025

## Cache Management Updates

## Overview
This PR introduces native WebView implementations for Android, along with significant cache management improvements and bug fixes.

## Changes

- Increased buffer size for `BufferedInputStream` in `WebCacheManager.kt` to 32KB (32 * 1024) for optimized cache file reading
- Refactored `MainActivity.kt` to use `properties.getProperty` instead of `jsonObject.optString` for configuration values

### Fixed
- Corrected prompt string in `utils.js` from "CSS pattern" to "Cache pattern"

## Version
- Target version: 0.0.3-canary.3
