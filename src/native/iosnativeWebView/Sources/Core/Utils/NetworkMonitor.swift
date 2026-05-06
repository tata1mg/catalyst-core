import Foundation
import Network
import os

struct NetworkStatus {
    let isOnline: Bool
    let type: String?
}

final class NetworkMonitor {
    static let shared = NetworkMonitor()

    private let monitor: NWPathMonitor
    private let monitorQueue = DispatchQueue(label: "com.catalyst.network.monitor")
    private let stateQueue = DispatchQueue(label: "com.catalyst.network.monitor.state")
    private var listeners: [UUID: (NetworkStatus) -> Void] = [:]
    private var isMonitoring = false
    // Start optimistic (online) until NWPathMonitor delivers a real path; prevents false offline at launch
    private var latestStatus: NetworkStatus = NetworkStatus(isOnline: true, type: nil)
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NetworkMonitor")

    private init() {
        monitor = NWPathMonitor()

        monitor.pathUpdateHandler = { [weak self] path in
            let status = NetworkMonitor.mapPathToStatus(path)
            self?.handleStatusChange(status)
        }

        stateQueue.async { [weak self] in
            self?.startMonitoringLocked()
        }
    }

    var currentStatus: NetworkStatus {
        stateQueue.sync { latestStatus }
    }

    @discardableResult
    func addListener(_ listener: @escaping (NetworkStatus) -> Void) -> UUID {
        let id = UUID()

        stateQueue.async { [weak self] in
            guard let self else { return }
            listeners[id] = listener

            // Emit the latest known status immediately (seeded optimistically until monitor reports)
            startMonitoringLocked()
            let status = latestStatus
            DispatchQueue.main.async {
                listener(status)
            }
        }

        return id
    }

    func removeListener(_ id: UUID) {
        stateQueue.async { [weak self] in
            self?.listeners.removeValue(forKey: id)
        }
    }

    private func startMonitoringLocked() {
        guard !isMonitoring else { return }
        isMonitoring = true
        logger.debug("Starting network monitor")
        monitor.start(queue: monitorQueue)

        // Seed status with the monitor's initial path once started to avoid reporting stale/unsatisfied state
        monitorQueue.async { [weak self] in
            guard let self else { return }
            let status = NetworkMonitor.mapPathToStatus(self.monitor.currentPath)
            self.handleStatusChange(status)
        }
    }

    private func handleStatusChange(_ status: NetworkStatus) {
        stateQueue.async { [weak self] in
            guard let self else { return }
            latestStatus = status
            let callbacks = listeners.values

            DispatchQueue.main.async {
                callbacks.forEach { $0(status) }
            }
        }
    }

    private static func mapPathToStatus(_ path: NWPath) -> NetworkStatus {
        let isOnline = path.status == .satisfied

        let type: String?
        if path.usesInterfaceType(.wifi) {
            type = "wifi"
        } else if path.usesInterfaceType(.cellular) {
            type = "cellular"
        } else if path.usesInterfaceType(.wiredEthernet) {
            type = "ethernet"
        } else if path.usesInterfaceType(.other) {
            type = "other"
        } else if path.usesInterfaceType(.loopback) {
            type = "loopback"
        } else {
            type = nil
        }

        return NetworkStatus(isOnline: isOnline, type: type)
    }
}

extension NetworkStatus: Sendable {}
