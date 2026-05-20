import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "URLWhitelistManager")

/// Data structure to hold categorized URL patterns for efficient matching
private struct CategorizedPatterns {
    let contains: [String]
    let prefix: [String]
    let suffix: [String]
}

/// Manager for URL whitelisting and access control
/// Provides centralized URL validation with pattern matching support
///
/// Pattern matching rules:
/// - *text* or text (no wildcard) -> checks if URL contains "text"
/// - text* -> checks if URL starts with "text"
/// - *text -> checks if URL ends with "text"
///
/// URL processing:
/// - Query parameters and hash fragments are stripped before matching
/// - Matching is case-insensitive
/// - Ports are kept as-is (user must include port in pattern if URL has explicit port)
class URLWhitelistManager {
    static let shared = URLWhitelistManager()

    private var accessControlEnabled: Bool = false
    private var patterns: CategorizedPatterns?
    private let syncQueue = DispatchQueue(label: "com.app.urlwhitelist", attributes: .concurrent)

    private init() {
        loadConfiguration()
    }

    #if DEBUG
    /// Test-only initialization method to override configuration
    /// This allows unit tests to set custom whitelist configurations
    /// - Parameters:
    ///   - enabled: Whether access control is enabled
    ///   - allowedUrls: Array of URL patterns to allow
    func testInitialize(enabled: Bool, allowedUrls: [String]) {
        syncQueue.sync(flags: .barrier) {
            self.accessControlEnabled = enabled
            self.patterns = categorizePatterns(allowedUrls)
        }
    }
    #endif

    /// Load URL whitelist configuration from ConfigConstants
    private func loadConfiguration() {
        syncQueue.sync(flags: .barrier) {
            self.accessControlEnabled = ConfigConstants.accessControlEnabled
            let allowedUrls = ConfigConstants.allowedUrls
            self.patterns = categorizePatterns(allowedUrls)

            logger.info("URLWhitelistManager initialized")
            logger.info("Access Control Enabled: \(self.accessControlEnabled)")
            logger.info("Allowed URLs: \(allowedUrls)")
            if let patterns = self.patterns {
                logger.info("Categorized - Contains: \(patterns.contains)")
                logger.info("Categorized - Prefix: \(patterns.prefix)")
                logger.info("Categorized - Suffix: \(patterns.suffix)")
            }
        }
    }

    /// Check if URL whitelisting is enabled
    var isAccessControlEnabled: Bool {
        return syncQueue.sync { self.accessControlEnabled }
    }

    /// Check if a URL is allowed according to the whitelist patterns
    /// If access control is disabled, all URLs are allowed
    /// - Parameter url: The URL to check
    /// - Returns: true if URL is allowed, false otherwise
    func isUrlAllowed(_ url: URL) -> Bool {
        return isUrlAllowed(url.absoluteString)
    }

    /// Check if a URL string is allowed according to the whitelist patterns
    /// If access control is disabled, all URLs are allowed
    /// - Parameter urlString: The URL string to check
    /// - Returns: true if URL is allowed, false otherwise
    func isUrlAllowed(_ urlString: String) -> Bool {
        return syncQueue.sync {
            // If access control is disabled, allow everything
            if !self.accessControlEnabled {
                return true
            }

            // Always allow framework server URLs (localhost with /framework- pattern)
            // These are internal infrastructure URLs used for large file handling
            let frameworkPattern = "^https?://(localhost|127\\.0\\.0\\.1)(:\\d+)?/framework-[a-zA-Z0-9_-]+"
            if let regex = try? NSRegularExpression(pattern: frameworkPattern, options: .caseInsensitive) {
                let range = NSRange(location: 0, length: urlString.utf16.count)
                if regex.firstMatch(in: urlString, options: [], range: range) != nil {
                    return true
                }
            }

            guard let patterns = self.patterns else {
                return false
            }

            // If all pattern lists are empty, block everything
            if patterns.contains.isEmpty && patterns.prefix.isEmpty && patterns.suffix.isEmpty {
                return false
            }

            let cleanUrl = cleanUrl(urlString)

            // Check contains patterns
            if patterns.contains.contains(where: { cleanUrl.contains($0) }) {
                logger.info("✅ URL allowed (contains match): \(urlString)")
                return true
            }

            // Check prefix patterns
            if patterns.prefix.contains(where: { cleanUrl.hasPrefix($0) }) {
                logger.info("✅ URL allowed (prefix match): \(urlString)")
                return true
            }

            // Check suffix patterns
            if patterns.suffix.contains(where: { cleanUrl.hasSuffix($0) }) {
                logger.info("✅ URL allowed (suffix match): \(urlString)")
                return true
            }

            logger.warning("🚫 URL blocked by access control: \(urlString)")
            logger.warning("🚫 Clean URL: \(cleanUrl)")

            return false
        }
    }

    /// Check if a URL is from an external domain (not in whitelist)
    /// If access control is disabled, nothing is considered external
    /// - Parameter url: The URL to check
    /// - Returns: true if URL is external, false if it's whitelisted
    func isExternalDomain(_ url: URL) -> Bool {
        return isExternalDomain(url.absoluteString)
    }

    /// Check if a URL string is from an external domain (not in whitelist)
    /// If access control is disabled, nothing is considered external
    /// - Parameter urlString: The URL string to check
    /// - Returns: true if URL is external, false if it's whitelisted
    func isExternalDomain(_ urlString: String) -> Bool {
        // If access control is disabled, nothing is external
        if !self.accessControlEnabled {
            return false
        }

        // Simply the inverse of isUrlAllowed
        return !isUrlAllowed(urlString)
    }

    /// Clean URL by removing query parameters and hash, then lowercase for case-insensitive matching
    /// Also decodes URL-encoded characters to prevent bypass attempts
    /// - Parameter url: The URL string to clean
    /// - Returns: Cleaned and lowercased URL string
    private func cleanUrl(_ url: String) -> String {
        // Decode URL-encoded characters first to prevent bypass (e.g., %3F for ?, %23 for #)
        let decoded = url.removingPercentEncoding ?? url

        var cleanUrl = decoded

        // Remove hash fragment (# and everything after)
        if let hashIndex = cleanUrl.firstIndex(of: "#") {
            cleanUrl = String(cleanUrl[..<hashIndex])
        }

        // Remove query parameters (? and everything after)
        if let queryIndex = cleanUrl.firstIndex(of: "?") {
            cleanUrl = String(cleanUrl[..<queryIndex])
        }

        return cleanUrl.lowercased()
    }

    /// Categorize patterns into contains, prefix, and suffix for efficient matching
    /// - Parameter allowedUrls: Array of URL pattern strings
    /// - Returns: Categorized patterns structure
    private func categorizePatterns(_ allowedUrls: [String]) -> CategorizedPatterns {
        var contains: [String] = []
        var prefix: [String] = []
        var suffix: [String] = []

        for pattern in allowedUrls {
            let startsWithWildcard = pattern.hasPrefix("*")
            let endsWithWildcard = pattern.hasSuffix("*")

            if startsWithWildcard && endsWithWildcard {
                // *text* -> contains check
                let extracted = String(pattern.dropFirst().dropLast()).lowercased()
                if !extracted.isEmpty {
                    contains.append(extracted)
                }
            } else if endsWithWildcard {
                // text* -> prefix check
                let extracted = String(pattern.dropLast()).lowercased()
                if !extracted.isEmpty {
                    prefix.append(extracted)
                }
            } else if startsWithWildcard {
                // *text -> suffix check
                let extracted = String(pattern.dropFirst()).lowercased()
                if !extracted.isEmpty {
                    suffix.append(extracted)
                }
            } else {
                // No wildcard -> treat as contains check
                let extracted = pattern.lowercased()
                if !extracted.isEmpty {
                    contains.append(extracted)
                }
            }
        }

        return CategorizedPatterns(contains: contains, prefix: prefix, suffix: suffix)
    }
}
