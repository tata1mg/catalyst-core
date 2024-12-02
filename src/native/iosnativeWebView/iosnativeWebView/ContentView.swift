import SwiftUI
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "ContentView")

struct ContentView: View {
    @StateObject private var webViewModel = WebViewModel()
    
    var body: some View {
        ZStack {
            WebView(urlString: ConfigConstants.url, viewModel: webViewModel)
                .edgesIgnoringSafeArea(.all)
                .onAppear {
                    logger.info("WebView appeared with URL: \(ConfigConstants.url)")
                }
            
            if webViewModel.isLoading {
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
        .onAppear {
            logger.info("ContentView appeared")
        }
    }
}
