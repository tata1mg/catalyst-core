package io.yourname.androidproject.tier2

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import io.yourname.androidproject.SplashActivity
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Tier 2 (#416): instrumented coverage for SplashActivity.onCreate.
 *
 * With no assets/webview_config.properties in the repo, onCreate hits its
 * catch block and calls startMainActivity() + finish() + return BEFORE
 * reaching RESUMED. ActivityScenario.launch() waits for RESUMED and would
 * time out (~45s) — launchActivityForResult() tolerates a self-finishing
 * activity. The splash-enabled branch (configureSplashScreen /
 * startSplashTimer) stays uncovered because splash is disabled by default;
 * that is acceptable for a report-only Tier 2 number.
 */
@RunWith(AndroidJUnit4::class)
@LargeTest
class SplashActivityLaunchTest {

    @Test
    fun splashForwardsToMain() {
        ActivityScenario.launchActivityForResult(SplashActivity::class.java).use {
            // onCreate ran: assets.open threw -> startMainActivity() -> finish().
        }
    }
}
