import Foundation

final class DeviceInfoPlugin: CatalystPlugin {
    private let commandGetDeviceInfo = "getDeviceInfo"
    private let successCallback = "onSuccess"
    private let errorCallback = "onError"

    func handle(command: String, data: Any?, bridge: PluginBridgeContext) {
        guard command == commandGetDeviceInfo else {
            bridge.callback(eventName: errorCallback, data: [
                "message": "Unsupported command: \(command)",
                "code": "UNSUPPORTED_COMMAND",
            ])
            return
        }

        let deviceInfo = DeviceInfoUtils.getDeviceInfo()
        if let error = deviceInfo["error"] as? String {
            bridge.callback(eventName: errorCallback, data: [
                "message": error,
                "code": "DEVICE_INFO_ERROR",
            ])
            return
        }

        bridge.callback(eventName: successCallback, data: deviceInfo)
    }
}
