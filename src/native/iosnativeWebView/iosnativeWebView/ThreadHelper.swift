

import Foundation

enum ThreadHelper {
    static func currentThreadInfo() -> String {
        if Thread.isMainThread {
            return "🏠 Main Thread"
        } else {
            return "🧵 Background Thread: \(Thread.current.description)"
        }
    }
}
