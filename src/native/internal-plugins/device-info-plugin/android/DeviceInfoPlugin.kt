package io.yourname.androidproject.plugins.internal.deviceinfo

import android.util.Log
import io.yourname.androidproject.plugins.CatalystPlugin
import io.yourname.androidproject.plugins.PluginBridgeContext
import io.yourname.androidproject.utils.DeviceInfoUtils
import org.json.JSONObject

class DeviceInfoPlugin : CatalystPlugin {
    companion object {
        private const val TAG = "DeviceInfoPlugin"
        private const val COMMAND_GET_DEVICE_INFO = "getDeviceInfo"
        private const val CALLBACK_SUCCESS = "onSuccess"
        private const val CALLBACK_ERROR = "onError"
    }

    override fun handle(command: String, data: JSONObject?, bridge: PluginBridgeContext) {
        if (command != COMMAND_GET_DEVICE_INFO) {
            bridge.callback(
                CALLBACK_ERROR,
                JSONObject().apply {
                    put("message", "Unsupported command: $command")
                    put("code", "UNSUPPORTED_COMMAND")
                }
            )
            return
        }

        try {
            val deviceInfo = DeviceInfoUtils.getDeviceInfo(bridge.context, bridge.properties)
            bridge.callback(CALLBACK_SUCCESS, deviceInfo)
        } catch (error: Exception) {
            Log.e(TAG, "Failed to resolve device info", error)
            bridge.callback(
                CALLBACK_ERROR,
                JSONObject().apply {
                    put("message", error.message ?: "Failed to get device info")
                    put("code", "DEVICE_INFO_ERROR")
                }
            )
        }
    }
}
