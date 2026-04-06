package io.yourname.androidproject.plugins

import org.json.JSONObject

interface CatalystPlugin {
    fun handle(command: String, data: JSONObject?, bridge: PluginBridgeContext)
}
