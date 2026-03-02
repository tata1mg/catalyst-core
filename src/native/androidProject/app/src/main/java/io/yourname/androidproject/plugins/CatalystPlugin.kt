package io.yourname.androidproject.plugins

interface CatalystPlugin {
    fun handle(command: String, data: Any?, bridge: PluginBridgeContext)
}
