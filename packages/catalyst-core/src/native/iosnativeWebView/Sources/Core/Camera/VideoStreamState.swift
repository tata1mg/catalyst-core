import Foundation

// MARK: - VideoStreamState
//
// Valid transitions:
//   IDLE      → STARTING  (start() called)
//   STARTING  → STREAMING (session running)
//   STARTING  → IDLE      (permission denied or bind failure)
//   STREAMING → HOLD      (QR detected)
//   HOLD      → STREAMING (hold expired)
//   STREAMING → FLIPPING  (flip() called)
//   FLIPPING  → STREAMING (rebind complete)
//   STREAMING → STOPPING  (stop() called)
//   FLIPPING  → STOPPING  (stop() called mid-flip)
//   HOLD      → STOPPING  (stop() called during hold)
//   STOPPING  → IDLE      (session torn down)

enum VideoStreamState {
    case idle
    case starting
    case streaming
    case hold
    case flipping
    case stopping

    func canTransitionTo(_ next: VideoStreamState) -> Bool {
        switch self {
        case .idle:      return next == .starting
        case .starting:  return next == .streaming || next == .idle
        case .streaming: return next == .hold || next == .flipping || next == .stopping
        case .hold:      return next == .streaming || next == .stopping
        case .flipping:  return next == .streaming || next == .stopping
        case .stopping:  return next == .idle
        }
    }

    var isActive: Bool {
        return self == .streaming || self == .hold || self == .flipping
    }
}

protocol VideoStreamStateListener: AnyObject {
    func onStateChanged(prev: VideoStreamState, next: VideoStreamState)
}
