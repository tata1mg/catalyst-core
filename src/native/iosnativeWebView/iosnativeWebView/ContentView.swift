import SwiftUI
import os
import WebKit
import CatalystCore

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "ContentView")

public struct ContentView: View {
    @StateObject private var webViewModel = WebViewModel()
    // @StateObject ensures cameraManager survives SwiftUI view rebuilds.
    @StateObject private var cameraManager = NativeCameraManager(
        onEvent: { _, _ in },   // placeholder; real handler set in NativeBridge
        onError: { _ in }
    )

    public init() {}

    public var body: some View {
        ZStack {
            // Camera preview layer — sits behind the WebView (index 0)
            CameraPreviewView(cameraManager: cameraManager)
                .ignoresSafeArea()
                .allowsHitTesting(false)   // touches pass through to WebView

            // Normal remote URL - isolated from state changes
            // Conditionally apply edge-to-edge based on config (matches Android behavior)
            if ConfigConstants.EdgeToEdge.enabled {
                WebViewContainer(urlString: ConfigConstants.url, viewModel: webViewModel, cameraManager: cameraManager)
                    .ignoresSafeArea()
                    .onAppear {
                        logger.info("WebView appeared with URL: \(ConfigConstants.url) [Edge-to-edge: enabled]")
                    }
            } else {
                WebViewContainer(urlString: ConfigConstants.url, viewModel: webViewModel, cameraManager: cameraManager)
                    .onAppear {
                        logger.info("WebView appeared with URL: \(ConfigConstants.url) [Edge-to-edge: disabled, respecting safe areas]")
                    }
            }
            
            // Show splash screen if enabled in configuration
            if ConfigConstants.splashScreenEnabled {
                SplashView(webViewModel: webViewModel).zIndex(1)
            } else if webViewModel.isLoading {
                // Show old progress bar if splash screen is disabled and still loading
                VStack {
                    ProgressView()
                        .scaleEffect(1.5)
                        .progressViewStyle(CircularProgressViewStyle(tint: .blue))
                    
                    Text("\(Int(webViewModel.loadingProgress * 100))%")
                        .foregroundColor(.blue)
                        .padding(.top, 8)
                    
                    if webViewModel.isLoadingFromCache {
                        Text("Loading from cache...")
                            .foregroundColor(.blue)
                            .padding(.top, 4)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.opacity(0.1))
            }
        }
        .animation(.easeInOut(duration: 0.8), value: webViewModel.isLoading)
        .onAppear {
            logWithTimestamp("📱 ContentView appeared")
        }
    }
}

// Separate container to isolate WebView from parent state changes
struct WebViewContainer: View {
    let urlString: String
    @ObservedObject var viewModel: WebViewModel
    let cameraManager: NativeCameraManager

    var body: some View {
        WebView(urlString: urlString, viewModel: viewModel, cameraManager: cameraManager)
            .onAppear {
                logWithTimestamp("🌐 WebView appeared with URL: \(urlString)")
            }
    }
}

// Separate loading overlay component
struct LoadingOverlay: View {
    let progress: Double
    let isFromCache: Bool

    var body: some View {
        VStack {
            ProgressView()
                .scaleEffect(1.5)
                .progressViewStyle(CircularProgressViewStyle(tint: .blue))

            Text("\(Int(progress * 100))%")
                .foregroundColor(.blue)
                .padding(.top, 8)

            if isFromCache {
                Text("Loading from cache...")
                    .foregroundColor(.blue)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.1))
    }
}

// UIViewControllerRepresentable for hosting native view controllers
struct HostingController: UIViewControllerRepresentable {
    var viewController: UIViewController
    
    func makeUIViewController(context: Context) -> UIViewController {
        return viewController
    }
    
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        // No update needed
    }
}
