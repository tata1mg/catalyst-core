import Foundation

protocol CatalystPlugin {
    func handle(command: String, data: Any?, bridge: PluginBridgeContext)
}
