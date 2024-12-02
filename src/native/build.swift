import Foundation

// Main execution
guard CommandLine.arguments.count >= 3 else {
    print("Usage: swift generateConfig.swift [url] [output_path]")
    exit(1)
}

let url = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]

// Generate ConfigConstants.swift
let configContent = """
// This file is auto-generated. Do not edit.
import Foundation

enum ConfigConstants {
    static let url = "\(url)"
    static let useWKWebView = true
}
"""

do {
    try configContent.write(toFile: outputPath, atomically: true, encoding: .utf8)
    print("Generated ConfigConstants.swift at \(outputPath)")
} catch {
    print("Failed to write ConfigConstants.swift: \(error)")
    exit(1)
}