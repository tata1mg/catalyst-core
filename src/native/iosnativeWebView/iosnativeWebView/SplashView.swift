import SwiftUI

struct SplashView: View {
    @ObservedObject var webViewModel: WebViewModel
    
    var body: some View {
        Color(hex: ConfigConstants.splashScreenBackgroundColor)
            .ignoresSafeArea(.all)
            .overlay(
                VStack(spacing: 20) {
                    // Custom splash image from public folder or app icon fallback
                    if let splashImage = loadSplashImage() {
                        Image(uiImage: splashImage)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: ConfigConstants.splashScreenImageWidth, height: ConfigConstants.splashScreenImageHeight)
                            .cornerRadius(ConfigConstants.splashScreenCornerRadius)
                    } else {
                        // Fallback to system icon
                        Image(systemName: "app.fill")
                            .font(.system(size: 80))
                            .foregroundColor(.primary)
                    }
                    
                  
                }
            )
         
    }
    
    // Load custom splash screen image from Assets.xcassets (copied from public folder during build)
    private func loadSplashImage() -> UIImage? {
        // Try to load the launch screen image from Assets.xcassets
        // The build process copies public/splashscreen.* to Assets.xcassets/launchscreen.imageset/
        if let image = UIImage(named: "launchscreen") {
            print("✅ Loaded launch screen image from Assets.xcassets")
            return image
        }
        
        // Fallback: Try to load using Bundle.main.path (for backward compatibility)
        let imageExtensions = ["png", "jpg", "jpeg"]
        
        for ext in imageExtensions {
            if let path = Bundle.main.path(forResource: "launchscreen", ofType: ext),
               let image = UIImage(contentsOfFile: path) {
                print("✅ Loaded launch screen from bundle path: \(path)")
                return image
            }
        }
        
        print("❌ No launch screen image found")
        return nil
    }
}

// Simple color extension for hex colors
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
