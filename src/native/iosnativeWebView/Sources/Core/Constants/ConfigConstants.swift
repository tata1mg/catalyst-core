// ConfigConstants.swift
// Auto-generated stub - DO NOT EDIT MANUALLY
// This file will be overwritten during build with actual configuration values
import Foundation

public enum ConfigConstants {
    // Default URL - will be replaced during build
    public static let url = "http://localhost:3000"

    // Notifications configuration
    // This stub defaults to disabled - will be replaced during build
    public enum Notifications {
        public static let enabled = false
    }
    
    // Google Sign-In configuration (defaults to disabled, populated during build)
    public enum GoogleSignIn {
        public static let enabled = false
        public static let clientId = ""
    }

    // Access control configuration
    public static let accessControlEnabled = false
    public static let allowedUrls: [String] = []

    // Splash screen configuration
    public static let splashScreenEnabled = false
}
