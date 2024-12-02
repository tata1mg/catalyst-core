//
//  WebViewModel.swift
//  iosnativeWebView
//
//  Created by Mayank.Mahavar on 29/10/24.
//


import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebViewModel")

@MainActor
class WebViewModel: ObservableObject {
    @Published var isLoading: Bool = false
    @Published var canGoBack: Bool = false
    @Published var loadingProgress: Double = 0.0
    @Published var lastLoadedURL: URL?
    @Published var isLoadingFromCache: Bool = false
    
    // Track navigation history
    var navigationHistory: [String] = []
    
    func setLoading(_ loading: Bool, fromCache: Bool = false) {
        isLoading = loading
        isLoadingFromCache = fromCache
        if !loading {
            loadingProgress = 1.0
        }
        
        if loading {
            logger.info("Started loading\(fromCache ? " from cache" : "")")
        } else {
            logger.info("Finished loading")
        }
    }
    
    func setProgress(_ progress: Double) {
        loadingProgress = progress
    }
    
    func addToHistory(_ urlString: String) {
        navigationHistory.append(urlString)
        logger.info("Added to navigation history: \(urlString)")
    }
    
    func reset() {
        isLoading = false
        loadingProgress = 0
        isLoadingFromCache = false
    }
}
