import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "URLWhitelistManager")

/// Protocol for access control configuration
protocol AccessControlConfigurable {
    static var accessControlEnabled: Bool { get }
    static var allowedUrls: [String] { get }
}

/// Manager for URL whitelisting and access control
class URLWhitelistManager {
    static let shared = URLWhitelistManager()
    
    private var accessControlEnabled: Bool = false
    private var allowedUrls: [String] = []
    
    private init() {
        loadConfiguration()
    }
    
    /// Load URL whitelist configuration
    private func loadConfiguration() {
        // Load from ConfigConstants if available
        self.accessControlEnabled = ConfigConstants.accessControlEnabled
        self.allowedUrls = ConfigConstants.allowedUrls
        
        logger.info("URL Whitelist initialized - Enabled: \(self.accessControlEnabled), URLs: \(self.allowedUrls)")
    }
    
    /// Check if URL whitelisting is enabled
    var isAccessControlEnabled: Bool {
        return self.accessControlEnabled
    }
    
    /// Check if a URL is allowed according to the whitelist
    /// - Parameter url: The URL to check
    /// - Returns: true if URL is allowed, false otherwise
    func isUrlAllowed(_ url: URL) -> Bool {
        return isUrlAllowed(url.absoluteString)
    }
    
    /// Check if a URL string is allowed according to the whitelist
    /// - Parameter urlString: The URL string to check
    /// - Returns: true if URL is allowed, false otherwise
    func isUrlAllowed(_ urlString: String) -> Bool {
        // If access control is disabled, allow all URLs
        if !self.accessControlEnabled {
            return true
        }
        
        // If no allowed URLs configured, block all
        if self.allowedUrls.isEmpty {
            return false
        }
        
        guard let url = URL(string: urlString) else {
            logger.warning("❌ Invalid URL format: \(urlString)")
            return false
        }
        
        // Validate scheme - only allow HTTP and HTTPS
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            return false
        }
        
        // Validate host exists
        guard let host = url.host, !host.isEmpty else {
            return false
        }
        
        // Check against all patterns
        let isAllowed = self.allowedUrls.contains { pattern in
            return matchesWildcardPattern(urlString: urlString, url: url, pattern: pattern)
        }
        
        if isAllowed {
            logger.info("✅ URL allowed: \(urlString)")
        } else {
            logger.warning("❌ URL blocked: \(urlString)")
        }
        
        return isAllowed
    }
    
    /// Helper method to match URL against wildcard patterns
    /// - Parameters:
    ///   - urlString: The full URL string to check
    ///   - url: The parsed URL object
    ///   - pattern: The pattern to match against (supports wildcards)
    /// - Returns: true if the URL matches the pattern
    private func matchesWildcardPattern(urlString: String, url: URL, pattern: String) -> Bool {
        guard let host = url.host, !host.isEmpty else {
            return false
        }
        
        guard let scheme = url.scheme?.lowercased() else {
            return false
        }
        
        // Handle wildcard patterns like "*192.168.0.102*", "*1mg.com*", etc.
        if pattern.contains("*") {
            return matchesWildcardPatternSecure(urlString: urlString, url: url, pattern: pattern)
        } else {
            // Handle exact patterns (no wildcards)
            guard let patternUrl = URL(string: pattern),
                  let patternScheme = patternUrl.scheme?.lowercased(),
                  let patternHost = patternUrl.host else {
                // If pattern is not a valid URL, try direct string comparison
                return urlString.lowercased().contains(pattern.lowercased()) ||
                       host.lowercased().contains(pattern.lowercased())
            }
            
            let patternPort = patternUrl.port
            let urlPort = url.port
            
            // Check scheme match
            let schemeMatches = scheme == patternScheme
            
            // Check host match
            let hostMatches = host.caseInsensitiveCompare(patternHost) == .orderedSame
            
            // Check port match (flexible - if pattern has no port, accept any port)
            let portMatches = patternPort == nil || urlPort == patternPort ||
                (urlPort == nil && ((patternPort == 443 && patternScheme == "https") ||
                                   (patternPort == 80 && patternScheme == "http")))
            
            return schemeMatches && hostMatches && portMatches
        }
    }
    
    /// Check if a URL is from an external domain (not in whitelist)
    /// - Parameter url: The URL to check
    /// - Returns: true if URL is external, false if it's whitelisted
    func isExternalDomain(_ url: URL) -> Bool {
        return isExternalDomain(url.absoluteString)
    }
    
    /// Check if a URL string is from an external domain (not in whitelist)
    /// - Parameter urlString: The URL string to check
    /// - Returns: true if URL is external, false if it's whitelisted
    func isExternalDomain(_ urlString: String) -> Bool {
        // If access control is disabled, consider nothing external
        if !self.accessControlEnabled {
            return false
        }
        
        // If no allowed URLs configured, everything is external
        if self.allowedUrls.isEmpty {
            return true
        }
        
        guard let url = URL(string: urlString) else {
            return true
        }
        
        guard let host = url.host, !host.isEmpty else {
            return true
        }
        
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            return true
        }
        
        // Use the same wildcard matching logic as isUrlAllowed
        let isWhitelisted = self.allowedUrls.contains { pattern in
            return matchesWildcardPattern(urlString: urlString, url: url, pattern: pattern)
        }
        
        return !isWhitelisted
    }
    
    /// Secure wildcard pattern matching with proper anchoring and domain boundaries
    private func matchesWildcardPatternSecure(urlString: String, url: URL, pattern: String) -> Bool {
        guard let host = url.host, !host.isEmpty,
              let scheme = url.scheme?.lowercased() else {
            return false
        }
        
        // Handle subdomain wildcards like "*.example.com" or "*.example.com/*"
        if pattern.hasPrefix("*.") {
            let remainder = String(pattern.dropFirst(2))
            
            // Handle "*.domain.com/*" pattern
            if remainder.hasSuffix("/*") {
                let domain = String(remainder.dropLast(2))
                guard !domain.contains("*") else { return false }
                return host.caseInsensitiveCompare(domain) == .orderedSame ||
                       host.lowercased().hasSuffix(".\(domain.lowercased())")
            }
            
            // Handle "*.domain.com" pattern  
            guard !remainder.contains("*") else { return false }
            return host.caseInsensitiveCompare(remainder) == .orderedSame ||
                   host.lowercased().hasSuffix(".\(remainder.lowercased())")
        }
        
        // Handle IP wildcards like "192.168.1.*"
        if pattern.contains(".") && pattern.contains("*") {
            let patternParts = pattern.components(separatedBy: ".")
            let hostParts = host.components(separatedBy: ".")
            
            if patternParts.count == hostParts.count &&
               patternParts.allSatisfy({ $0 == "*" || Int($0) != nil }) {
                return zip(patternParts, hostParts).allSatisfy { pattern, host in
                    pattern == "*" || pattern.caseInsensitiveCompare(host) == .orderedSame
                }
            }
        }
        
        // Handle universal wildcard
        if pattern == "*" {
            return true
        }
        
        // Handle general wildcards with anchoring
        var regexPattern = NSRegularExpression.escapedPattern(for: pattern)
        regexPattern = regexPattern.replacingOccurrences(of: "\\*", with: ".*")
        regexPattern = "^" + regexPattern + "$"
        
        do {
            let regex = try NSRegularExpression(pattern: regexPattern, options: .caseInsensitive)
            let testStrings = [host, "\(scheme)://\(host)", urlString]
            
            return testStrings.contains { testString in
                let range = NSRange(location: 0, length: testString.count)
                return regex.firstMatch(in: testString, options: [], range: range) != nil
            }
        } catch {
            logger.error("❌ Invalid regex pattern: \(regexPattern)")
            return false
        }
    }

}
