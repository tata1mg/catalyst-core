import SwiftUI
import os
import WebKit

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "ContentView")

struct ContentView: View {
    @StateObject private var webViewModel = WebViewModel()

    var body: some View {
        ZStack {
            // Normal remote URL - isolated from state changes
            WebViewContainer(urlString: ConfigConstants.url, viewModel: webViewModel)
                .edgesIgnoringSafeArea(.all)

            // Loading overlay - separate from WebView
            if webViewModel.isLoading {
                if ConfigConstants.splashScreenEnabled {
                    // Show splash screen if enabled in configuration
                  SplashView(webViewModel: webViewModel).zIndex(1)
                } else {
                    // Show old progress bar if splash screen is disabled
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

    var body: some View {
        WebView(urlString: urlString, viewModel: viewModel)
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
