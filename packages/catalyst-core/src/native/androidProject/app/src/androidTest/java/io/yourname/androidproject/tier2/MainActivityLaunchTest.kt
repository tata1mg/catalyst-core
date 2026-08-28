package io.yourname.androidproject.tier2

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import io.yourname.androidproject.MainActivity
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Tier 2 (#416): instrumented coverage for MainActivity.onCreate and its
 * lifecycle. One launch transitively wires up CustomWebView, NativeBridge,
 * PluginBridge, NativeCameraManager, KeyboardUtil, setupSafeAreaHandling,
 * the back-press callback, and the launch-URL + network branch — all
 * framework-bound code excluded from the Tier 1 gate.
 *
 * No dev server in CI: the WebView load fails, onReceivedError fires,
 * showOfflineRouteOrOfflinePage is reached, the missing-asset path is
 * caught. The Activity does not crash. recreate() covers the
 * savedInstanceState != null branch of onCreate.
 */
@RunWith(AndroidJUnit4::class)
@LargeTest
class MainActivityLaunchTest {

    @Test
    fun launchesAndRecreates() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.moveToState(Lifecycle.State.RESUMED)
            // savedInstanceState != null path in onCreate
            scenario.recreate()
            scenario.moveToState(Lifecycle.State.RESUMED)
        }
    }
}
