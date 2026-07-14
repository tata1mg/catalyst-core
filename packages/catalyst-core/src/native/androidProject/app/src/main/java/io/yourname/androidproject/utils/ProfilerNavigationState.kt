package io.yourname.androidproject.utils

internal class ProfilerNavigationState {
    private var isInitialNavigation = true

    data class Navigation(val url: String, val shouldReset: Boolean)

    fun begin(url: String): Navigation {
        val shouldReset = !isInitialNavigation
        isInitialNavigation = false
        return Navigation(url, shouldReset)
    }
}
