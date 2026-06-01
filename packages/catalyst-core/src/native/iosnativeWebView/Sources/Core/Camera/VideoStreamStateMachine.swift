import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "VideoStreamStateMachine")

private final class WeakListenerBox {
    weak var value: VideoStreamStateListener?
    init(_ value: VideoStreamStateListener) { self.value = value }
}

class VideoStreamStateMachine {

    private var _state: VideoStreamState = .idle
    private var listeners: [WeakListenerBox] = []
    private let lock = NSLock()

    var state: VideoStreamState {
        lock.lock()
        defer { lock.unlock() }
        return _state
    }

    var isActive: Bool {
        lock.lock()
        defer { lock.unlock() }
        return _state.isActive
    }

    func addListener(_ listener: VideoStreamStateListener) {
        lock.lock()
        listeners.append(WeakListenerBox(listener))
        lock.unlock()
    }

    func removeListener(_ listener: VideoStreamStateListener) {
        lock.lock()
        listeners.removeAll { $0.value === listener }
        lock.unlock()
    }

    @discardableResult
    func transition(to next: VideoStreamState) -> Bool {
        lock.lock()
        let prev = _state
        guard prev.canTransitionTo(next) else {
            lock.unlock()
            logger.warning("Invalid transition: \(String(describing: prev)) → \(String(describing: next)), ignoring")
            return false
        }
        _state = next
        // Compact nilled-out weak refs and snapshot live listeners under the lock
        listeners.removeAll { $0.value == nil }
        let snapshot = listeners.compactMap { $0.value }
        lock.unlock()

        logger.debug("State: \(String(describing: prev)) → \(String(describing: next))")
        snapshot.forEach { $0.onStateChanged(prev: prev, next: next) }
        return true
    }
}
