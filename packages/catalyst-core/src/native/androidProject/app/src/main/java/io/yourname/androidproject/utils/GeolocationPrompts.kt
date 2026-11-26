package io.yourname.androidproject.utils

/**
 * The decisions behind `navigator.geolocation` prompts in the WebView, kept free of Android types so they can be unit-tested.
 *
 * [C] is what answers a prompt (the WebView's `GeolocationPermissions.Callback`); [answer] delivers one verdict to it.
 *
 * Rules, as the WebView client needs them:
 *  - the app already holds a location permission: the prompt is allowed at once;
 *  - nothing can ask the user (no launcher, no callback or no origin): the prompt is denied at once, so the page never hangs;
 *  - otherwise the prompt waits for the runtime permission result. Only one can wait: a newer prompt denies the one still
 *    waiting, so its page does not hang either.
 */
internal class GeolocationPrompts<C : Any>(private val answer: (callback: C, origin: String?, allow: Boolean) -> Unit) {

    enum class Outcome {
        /** The prompt was answered "allow" straight away. */
        GRANTED,

        /** The prompt was answered "deny" straight away. */
        DENIED,

        /** The prompt is waiting; the caller must now ask for the runtime permission and report back with [onPermissionResult]. */
        WAITING_FOR_PERMISSION,
    }

    private var pendingCallback: C? = null
    private var pendingOrigin: String? = null

    val hasPending: Boolean get() = pendingCallback != null

    fun onPrompt(origin: String?, callback: C?, hasPermission: Boolean, canAsk: Boolean): Outcome {
        if (hasPermission) {
            callback?.let { answer(it, origin, true) }
            return Outcome.GRANTED
        }
        if (!canAsk || callback == null || origin == null) {
            callback?.let { answer(it, origin, false) }
            return Outcome.DENIED
        }
        // Deny any prompt still waiting so its page doesn't hang.
        pendingCallback?.let { answer(it, pendingOrigin, false) }
        pendingCallback = callback
        pendingOrigin = origin
        return Outcome.WAITING_FOR_PERMISSION
    }

    /** The runtime permission dialog finished. Answers the waiting prompt (if any) and forgets it. */
    fun onPermissionResult(granted: Boolean) {
        val callback = pendingCallback
        val origin = pendingOrigin
        pendingCallback = null
        pendingOrigin = null
        if (callback != null && origin != null) answer(callback, origin, granted)
    }
}
