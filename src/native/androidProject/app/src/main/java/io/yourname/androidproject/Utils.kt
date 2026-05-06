package io.yourname.androidproject

import android.net.Uri

/**
 * Checks if a URL matches any of the cache patterns
 * Handles query parameters, hashes, and version strings
 *
 * Examples:
 * - Pattern "*.css" matches:
 *   - "http://example.com/app.css"
 *   - "http://example.com/app.d4e5dea6.css"
 *   - "http://example.com/app.css?v=123"
 *   - "http://example.com/path/to/style.css#section"
 *
 * - Pattern "*.js" matches:
 *   - "http://example.com/bundle.js"
 *   - "http://example.com/bundle.abc123.js"
 *   - "http://example.com/bundle.js?t=456"
 */
fun matchesCachePattern(url: String, cachePatterns: List<String>): Boolean {
    if (cachePatterns.isEmpty()) return false

    try {
        val parsedUrl = Uri.parse(url) ?: return false
        // Get the path without query params or hash
        val path = parsedUrl.path ?: return false

        // Extract filename from path
        val filename = path.substringAfterLast('/')
        if (filename.isEmpty()) return false

        return cachePatterns.any { pattern ->
            when {
                pattern.contains("*") -> {
                    // Convert wildcard pattern to regex
                    // *.css becomes .*\.css$
                    val regexPattern = pattern
                        .replace(".", "\\.")  // Escape dots
                        .replace("*", ".*")   // Convert * to .*
                        .let { "^$it$" }      // Anchor at start and end

                    val regex = regexPattern.toRegex(RegexOption.IGNORE_CASE)

                    // Try matching against filename
                    regex.matches(filename)
                }
                else -> {
                    // Exact match against filename
                    filename.equals(pattern, ignoreCase = true)
                }
            }
        }
    } catch (e: Exception) {
        // If parsing fails, return false
        return false
    }
}