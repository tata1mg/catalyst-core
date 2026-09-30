import Foundation

public enum RuntimeConfig {
    private static let lock = NSLock()
    private static var values: [String: Any]?

    public static func install(_ config: [String: Any]) {
        lock.lock()
        values = config
        lock.unlock()
    }

    public static func clear() {
        lock.lock()
        values = nil
        lock.unlock()
    }

    public static var profilerEnabled: Bool {
        bool("profiler.enabled", default: ConfigConstants.Profiler.enabled)
    }

    public static var notificationsEnabled: Bool {
        bool("notifications.enabled", default: ConfigConstants.Notifications.enabled)
    }

    public static var googleSignInEnabled: Bool {
        bool("googleSignIn.enabled", default: ConfigConstants.GoogleSignIn.enabled)
    }

    public static var googleClientId: String {
        string("googleSignIn.clientId", default: ConfigConstants.GoogleSignIn.clientId)
    }

    public static var googleIosClientId: String {
        string("googleSignIn.iosClientId", default: ConfigConstants.GoogleSignIn.iosClientId)
    }

    public static var appInfo: String {
        string("appInfo", default: ConfigConstants.appInfo)
    }

    public static var cachePattern: [String] {
        strings("cachePattern", default: ConfigConstants.cachePattern)
    }

    public static var splashScreenEnabled: Bool {
        bool("splashScreen.enabled", default: ConfigConstants.splashScreenEnabled)
    }

    public static var edgeToEdgeEnabled: Bool {
        bool("edgeToEdge.enabled", default: ConfigConstants.EdgeToEdge.enabled)
    }

    public static var accessControlEnabled: Bool {
        bool("accessControl.enabled", default: ConfigConstants.accessControlEnabled)
    }

    public static var allowedUrls: [String] {
        strings("accessControl.allowedUrls", default: ConfigConstants.allowedUrls)
    }

    private static func bool(_ path: String, default fallback: Bool) -> Bool {
        value(path) as? Bool ?? fallback
    }

    private static func string(_ path: String, default fallback: String) -> String {
        value(path) as? String ?? fallback
    }

    private static func strings(_ path: String, default fallback: [String]) -> [String] {
        value(path) as? [String] ?? fallback
    }

    private static func value(_ path: String) -> Any? {
        lock.lock()
        defer { lock.unlock() }

        var current: Any? = values
        for component in path.split(separator: ".").map(String.init) {
            current = (current as? [String: Any])?[component]
        }
        return current
    }
}
