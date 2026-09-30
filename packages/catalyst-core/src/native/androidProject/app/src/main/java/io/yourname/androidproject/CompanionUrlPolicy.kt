package io.yourname.androidproject

import android.net.Uri

internal object CompanionUrlPolicy {
    fun isAllowed(url: Uri): Boolean = isAllowed(url.scheme, url.host)

    internal fun isAllowed(scheme: String?, host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        return when (scheme?.lowercase()) {
            "https" -> true
            "http" -> isPrivateHost(host)
            else -> false
        }
    }

    private fun isPrivateHost(rawHost: String): Boolean {
        val host = rawHost.lowercase().removeSuffix(".")
        if (host == "localhost" || host.endsWith(".local")) return true

        val octets = host.split(".").map { part ->
            if (part.isEmpty() || part.length > 3 || part.any { it !in '0'..'9' }) return false
            part.toIntOrNull()?.takeIf { it <= 255 } ?: return false
        }
        if (octets.size != 4) return false
        return octets[0] == 127 ||
            octets[0] == 10 ||
            octets[0] == 172 && octets[1] in 16..31 ||
            octets[0] == 192 && octets[1] == 168 ||
            octets[0] == 169 && octets[1] == 254
    }
}
