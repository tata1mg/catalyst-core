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
        
        let urlHost = "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")"
        
        let isAllowed = self.allowedUrls.contains { pattern in
            
            if pattern.contains("*") {
                // Wildcard pattern - use same logic as Android
                let regexPattern = pattern
                    .replacingOccurrences(of: ".", with: "\\.")
                    .replacingOccurrences(of: "*", with: ".*")
                
                do {
                    let regex = try NSRegularExpression(pattern: regexPattern, options: .caseInsensitive)
                    let urlRange = NSRange(location: 0, length: urlString.count)
                    let hostRange = NSRange(location: 0, length: urlHost.count)
                    
                    let urlMatches = regex.firstMatch(in: urlString, options: [], range: urlRange) != nil
                    let hostMatches = regex.firstMatch(in: urlHost, options: [], range: hostRange) != nil
                    
                    let matches = urlMatches || hostMatches
                
                    return matches
                } catch {
                    logger.error("❌ Invalid regex pattern: \(regexPattern)")
                    return false
                }
            } else {
                // Exact pattern - use same logic as Android
                guard let patternUrl = URL(string: pattern),
                      let patternScheme = patternUrl.scheme,
                      let patternHost = patternUrl.host else {
                    logger.info("❌ Invalid pattern URL: \(pattern)")
                    return false
                }
                
                let patternHostWithScheme = "\(patternScheme)://\(patternHost)\(patternUrl.port.map { ":\($0)" } ?? "")"
                
                // Exact match
                let exactMatch = urlHost.caseInsensitiveCompare(patternHostWithScheme) == .orderedSame
                
                // Pattern without port matches URL with any port
                let portFlexibleMatch = (patternUrl.port == nil && 
                                       urlHost.lowercased().hasPrefix("\(patternScheme)://\(patternHost)".lowercased()))
                
                let matches = exactMatch || portFlexibleMatch
                return matches
            }
        }
                
        return isAllowed
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
        
        guard let scheme = url.scheme?.lowercased() else {
            return true
        }
        
        let port = url.port
        
        return !self.allowedUrls.contains { pattern in
            if pattern.hasPrefix("*.") {
                let domain = String(pattern.dropFirst(2))
                return host.caseInsensitiveCompare(domain) == .orderedSame ||
                       host.lowercased().hasSuffix(".\(domain.lowercased())")
            } else {
                guard let patternUrl = URL(string: pattern),
                      let patternHost = patternUrl.host,
                      let patternScheme = patternUrl.scheme?.lowercased() else {
                    return false
                }
                
                let patternPort = patternUrl.port
                
                let schemeMatches = scheme == patternScheme
                
                let hostMatches: Bool
                if patternHost.hasPrefix("*.") {
                    let domain = String(patternHost.dropFirst(2))
                    hostMatches = host.caseInsensitiveCompare(domain) == .orderedSame ||
                                 host.lowercased().hasSuffix(".\(domain.lowercased())")
                } else {
                    hostMatches = host.caseInsensitiveCompare(patternHost) == .orderedSame
                }
                
                let portMatches = patternPort == nil || port == patternPort ||
                    (port == nil && ((patternPort == 443 && patternScheme == "https") ||
                                   (patternPort == 80 && patternScheme == "http")))
                
                return schemeMatches && hostMatches && portMatches
            }
        }
    }

}
