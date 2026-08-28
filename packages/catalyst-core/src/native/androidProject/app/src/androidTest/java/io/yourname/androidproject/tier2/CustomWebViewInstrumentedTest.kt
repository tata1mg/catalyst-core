package io.yourname.androidproject.tier2

import android.os.Bundle
import android.webkit.WebView
import android.widget.ProgressBar
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import io.yourname.androidproject.CustomWebView
import io.yourname.androidproject.MainActivity
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Properties

/**
 * Tier 2 (#416): instrumented coverage for CustomWebView — the largest
 * framework-bound class (~1350 lines), excluded from the Tier 1 Jacoco
 * gate because it wraps a real android.webkit.WebView.
 *
 * These tests construct a real CustomWebView on the main thread with a
 * real Activity Context and drive its public surface. They assert on
 * construction and method invocation, NOT on rendered page content —
 * there is no dev server in CI, and the missing-offline-asset path
 * (assets/offline/offline.html is not checked in) is caught and logged,
 * not a crash. So no IdlingResource, no page-load wait, no flakiness.
 *
 * The init {} block alone exercises setupFromProperties, WebCacheManager,
 * OfflineCacheService, setupWebView and setupServiceWorker.
 */
@RunWith(AndroidJUnit4::class)
@LargeTest
class CustomWebViewInstrumentedTest {

    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun constructsAndDrivesCorePaths() {
        activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        activityRule.scenario.onActivity { activity ->
            val webView = WebView(activity)
            val progressBar = ProgressBar(activity)
            val properties = Properties().apply {
                setProperty("buildType", "debug")
                setProperty("cachePatterns", "*.css,*.js")
            }

            // init {} runs here: setupFromProperties, WebCacheManager,
            // OfflineCacheService, setupWebView, setupServiceWorker.
            val customWebView = CustomWebView(activity, webView, progressBar, properties)
            assertNotNull(customWebView.getWebView())

            customWebView.setDefaultRequestHeaders(mapOf("X-Test" to "1"))
            customWebView.updateLastTargetUrl("http://localhost:3005/")
            customWebView.loadUrl("http://localhost:3005/")

            // Missing-asset catch path — assets/offline/offline.html is
            // not in the repo; showOfflinePage catches and logs.
            customWebView.showOfflinePage()
            customWebView.showOfflineRouteOrOfflinePage("http://localhost:3005/route")

            val bundle = Bundle()
            customWebView.saveState(bundle)
            customWebView.restoreState(bundle)

            customWebView.canGoBack()
            customWebView.onPause()
            customWebView.onResume()
            customWebView.enableHardwareAcceleration()
            customWebView.disableHardwareAcceleration()
            customWebView.clearCache()
            customWebView.clearAllCache()
            customWebView.cleanupCache()
        }
    }
}
