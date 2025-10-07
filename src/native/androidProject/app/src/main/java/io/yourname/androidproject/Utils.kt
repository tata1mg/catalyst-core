package io.yourname.androidproject

import android.net.Uri

fun isUrlAllowed(url: String, allowedUrls: List<String>): Boolean {
    // Always allow framework server URLs (localhost with /framework- pattern)
    // These are internal infrastructure URLs used for large file handling
    // Use strict regex to prevent bypass attacks
    val frameworkUrlPattern = Regex("^https?://(?:localhost|127\\.0\\.0\\.1)(?::\\d+)?/framework-[a-zA-Z0-9_-]+", RegexOption.IGNORE_CASE)
    if (frameworkUrlPattern.containsMatchIn(url)) {
        return true
    }

    if (allowedUrls.isEmpty()) return false

    val parsedUrl = Uri.parse(url) ?: return false
    val urlHost = "${parsedUrl.scheme}://${parsedUrl.host}${if (parsedUrl.port != -1) ":${parsedUrl.port}" else ""}"

    return allowedUrls.any { pattern ->
        when {
            pattern.contains("*") -> {
                val regex = pattern
                    .replace(".", "\\.")
                    .replace("*", ".*")
                    .toRegex(RegexOption.IGNORE_CASE)
                regex.matches(url) || regex.matches(urlHost)
            }
            else -> {
                val patternUri = Uri.parse(pattern)
                val patternHost = "${patternUri.scheme}://${patternUri.host}${if (patternUri.port != -1) ":${patternUri.port}" else ""}"
                
                // Exact match or pattern without port matches URL with any port
                urlHost.equals(patternHost, ignoreCase = true) || 
                (patternUri.port == -1 && urlHost.startsWith("${patternUri.scheme}://${patternUri.host}", ignoreCase = true))
            }
        }
    }
}

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

fun isExternalDomain(url: String, allowedUrls: List<String>): Boolean {
    if (allowedUrls.isEmpty()) return true

    val parsedUrl = Uri.parse(url)
    val urlHost = parsedUrl.host ?: return true
    val urlScheme = parsedUrl.scheme ?: return true
    val urlPort = parsedUrl.port

    return !allowedUrls.any { pattern ->
        if (pattern.startsWith("*.")) {
            val domain = pattern.substring(2)
            urlHost.equals(domain, ignoreCase = true) || urlHost.endsWith(".$domain", ignoreCase = true)
        } else {
            val patternUri = Uri.parse(pattern)
            val patternHost = patternUri?.host ?: return@any false
            val patternScheme = patternUri?.scheme ?: return@any false
            val patternPort = patternUri?.port ?: -1

            val schemeMatches = urlScheme.equals(patternScheme, ignoreCase = true)
            val hostMatches = if (patternHost.startsWith("*.")) {
                val domain = patternHost.substring(2)
                urlHost.equals(domain, ignoreCase = true) || urlHost.endsWith(".*domain", ignoreCase = true)
            } else {
                urlHost.equals(patternHost, ignoreCase = true)
            }
            val portMatches = patternPort == -1 || urlPort == patternPort ||
                (urlPort == -1 && ((patternPort == 443 && patternScheme.equals("https", ignoreCase = true)) ||
                                  (patternPort == 80 && patternScheme.equals("http", ignoreCase = true))))

            schemeMatches && hostMatches && portMatches
        }
    }
}