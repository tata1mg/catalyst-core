package io.yourname.androidproject.utils

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build

data class NetworkStatus(
    val isOnline: Boolean,
    val transport: String? = null
)

object NetworkUtils {
    private fun resolveTransport(capabilities: NetworkCapabilities?): String? {
        if (capabilities == null) return null
        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "bluetooth"
            else -> "unknown"
        }
    }

    fun getCurrentStatus(context: Context): NetworkStatus {
        val connectivityManager =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        val activeNetwork = connectivityManager.activeNetwork
        val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork)

        val isValidated = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        val isConnected = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        val transport = resolveTransport(capabilities)

        // Fallback for older APIs or missing capabilities
        val legacyConnected = connectivityManager.activeNetworkInfo?.isConnectedOrConnecting == true

        val online = isValidated || isConnected || legacyConnected
        return NetworkStatus(isOnline = online, transport = transport)
    }
}

class NetworkMonitor(
    context: Context,
    private val onStatusChanged: (NetworkStatus) -> Unit
) {
    private val appContext = context.applicationContext
    private val connectivityManager =
        appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private var callback: ConnectivityManager.NetworkCallback? = null

    fun start() {
        if (callback != null) return

        // Emit current state immediately
        onStatusChanged(NetworkUtils.getCurrentStatus(appContext))

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        val networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                onStatusChanged(NetworkUtils.getCurrentStatus(appContext))
            }

            override fun onLost(network: Network) {
                onStatusChanged(NetworkUtils.getCurrentStatus(appContext))
            }

            override fun onUnavailable() {
                onStatusChanged(NetworkUtils.getCurrentStatus(appContext))
            }
        }

        callback = networkCallback

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                connectivityManager.registerDefaultNetworkCallback(networkCallback)
            } else {
                connectivityManager.registerNetworkCallback(request, networkCallback)
            }
        } catch (_: Exception) {
            // Swallow registration errors to avoid crashes; hook users will fall back to navigator.onLine
            callback = null
        }
    }

    fun stop() {
        callback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
            } catch (_: Exception) {
                // Ignore unregister errors
            }
        }
        callback = null
    }
}
