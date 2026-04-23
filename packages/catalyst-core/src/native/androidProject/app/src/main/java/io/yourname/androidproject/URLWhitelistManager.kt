package io.yourname.androidproject

import android.util.Log

/**
 * Manager for URL whitelisting and access control
 * Provides centralized URL validation with pattern matching support
 *
 * Pattern matching rules:
 * - *text* or text (no wildcard) -> checks if URL contains "text"
 * - text* -> checks if URL starts with "text"
 * - *text -> checks if URL ends with "text"
 *
 * URL processing:
 * - Query parameters and hash fragments are stripped before matching
 * - Matching is case-insensitive
 * - Ports are kept as-is (user must include port in pattern if URL has explicit port)
 */
object URLWhitelistManager {

    private const val TAG = "URLWhitelistManager"

    /**
     * Data class to hold categorized URL patterns for efficient matching
     */
    private data class CategorizedPatterns(
        val contains: List<String>,
        val prefix: List<String>,
        val suffix: List<String>
    )

    @Volatile
    private var accessControlEnabled: Boolean = false

    @Volatile
    private var patterns: CategorizedPatterns? = null

    /**
     * Initialize the whitelist manager with configuration
     * Should be called once during app initialization
     */
    @Synchronized
    fun initialize(enabled: Boolean, allowedUrls: List<String>) {
        this.accessControlEnabled = enabled
        this.patterns = categorizePatterns(allowedUrls)

        try {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "URLWhitelistManager initialized")
                Log.d(TAG, "Access Control Enabled: $enabled")
                Log.d(TAG, "Allowed URLs: $allowedUrls")
                patterns?.let {
                    Log.d(TAG, "Categorized - Contains: ${it.contains}")
                    Log.d(TAG, "Categorized - Prefix: ${it.prefix}")
                    Log.d(TAG, "Categorized - Suffix: ${it.suffix}")
                }
            }
        } catch (e: RuntimeException) {
            // Log not available in unit tests - silently ignore
        }
    }

    /**
     * Check if access control is enabled
     */
    fun isAccessControlEnabled(): Boolean {
        return accessControlEnabled
    }

    /**
     * Check if a URL is allowed according to the whitelist patterns
     * If access control is disabled, all URLs are allowed
     */
    fun isUrlAllowed(url: String): Boolean {
        // If access control is disabled, allow everything
        if (!accessControlEnabled) {
            return true
        }

        // Always allow framework server URLs (localhost with /framework- pattern)
        // These are internal infrastructure URLs used for large file handling
        val frameworkUrlPattern = Regex("^https?://(?:localhost|127\\.0\\.0\\.1)(?::\\d+)?/framework-[a-zA-Z0-9_-]+", RegexOption.IGNORE_CASE)
        if (frameworkUrlPattern.containsMatchIn(url)) {
            return true
        }

        val patterns = this.patterns ?: return false

        // If all pattern lists are empty, block everything
        if (patterns.contains.isEmpty() && patterns.prefix.isEmpty() && patterns.suffix.isEmpty()) {
            return false
        }

        val cleanUrl = cleanUrl(url)

        // Check contains patterns
        if (patterns.contains.any { cleanUrl.contains(it) }) {
            try {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "✅ URL allowed (contains match): $url")
                }
            } catch (e: RuntimeException) { /* Ignore in tests */ }
            return true
        }

        // Check prefix patterns
        if (patterns.prefix.any { cleanUrl.startsWith(it) }) {
            try {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "✅ URL allowed (prefix match): $url")
                }
            } catch (e: RuntimeException) { /* Ignore in tests */ }
            return true
        }

        // Check suffix patterns
        if (patterns.suffix.any { cleanUrl.endsWith(it) }) {
            try {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "✅ URL allowed (suffix match): $url")
                }
            } catch (e: RuntimeException) { /* Ignore in tests */ }
            return true
        }

        try {
            if (BuildConfig.DEBUG) {
                Log.w(TAG, "🚫 URL blocked by access control: $url")
                Log.w(TAG, "🚫 Clean URL: $cleanUrl")
            }
        } catch (e: RuntimeException) { /* Ignore in tests */ }

        return false
    }

    /**
     * Check if a URL is from an external domain (not in whitelist)
     * If access control is disabled, nothing is considered external
     */
    fun isExternalDomain(url: String): Boolean {
        // If access control is disabled, nothing is external
        if (!accessControlEnabled) {
            return false
        }

        // Simply the inverse of isUrlAllowed
        return !isUrlAllowed(url)
    }

    /**
     * Clean URL by removing query parameters and hash, then lowercase for case-insensitive matching
     * Also decodes URL-encoded characters to prevent bypass attempts
     */
    private fun cleanUrl(url: String): String {
        // Decode URL-encoded characters first to prevent bypass (e.g., %3F for ?, %23 for #)
        val decoded = try {
            java.net.URLDecoder.decode(url, "UTF-8")
        } catch (e: Exception) {
            // If decode fails, use original URL
            url
        }

        var cleanUrl = decoded

        // Remove hash fragment (# and everything after)
        val hashIndex = cleanUrl.indexOf('#')
        if (hashIndex != -1) {
            cleanUrl = cleanUrl.substring(0, hashIndex)
        }

        // Remove query parameters (? and everything after)
        val queryIndex = cleanUrl.indexOf('?')
        if (queryIndex != -1) {
            cleanUrl = cleanUrl.substring(0, queryIndex)
        }

        return cleanUrl.lowercase()
    }

    /**
     * Categorize patterns into contains, prefix, and suffix for efficient matching
     */
    private fun categorizePatterns(allowedUrls: List<String>): CategorizedPatterns {
        val contains = mutableListOf<String>()
        val prefix = mutableListOf<String>()
        val suffix = mutableListOf<String>()

        allowedUrls.forEach { pattern ->
            if (pattern.isEmpty()) return@forEach

            val startsWithWildcard = pattern.startsWith('*')
            val endsWithWildcard = pattern.endsWith('*')

            when {
                startsWithWildcard && endsWithWildcard -> {
                    // *text* -> contains check
                    if (pattern.length <= 2) return@forEach // Pattern is just * or ** - ignore
                    val extracted = pattern.substring(1, pattern.length - 1).lowercase()
                    if (extracted.isNotEmpty()) {
                        contains.add(extracted)
                    }
                }
                endsWithWildcard -> {
                    // text* -> prefix check
                    if (pattern.length <= 1) return@forEach // Pattern is just * - ignore
                    val extracted = pattern.substring(0, pattern.length - 1).lowercase()
                    if (extracted.isNotEmpty()) {
                        prefix.add(extracted)
                    }
                }
                startsWithWildcard -> {
                    // *text -> suffix check
                    if (pattern.length <= 1) return@forEach // Pattern is just * - ignore
                    val extracted = pattern.substring(1).lowercase()
                    if (extracted.isNotEmpty()) {
                        suffix.add(extracted)
                    }
                }
                else -> {
                    // No wildcard -> treat as contains check
                    val extracted = pattern.lowercase()
                    if (extracted.isNotEmpty()) {
                        contains.add(extracted)
                    }
                }
            }
        }

        return CategorizedPatterns(contains, prefix, suffix)
    }
}
