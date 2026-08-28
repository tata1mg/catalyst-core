package io.yourname.androidproject.tier2

import android.view.ContextThemeWrapper
import android.view.ViewGroup
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.MediumTest
import io.yourname.androidproject.R
import io.yourname.androidproject.security.SecurityAlertUI
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Tier 2 (#416): instrumented coverage for SecurityAlertUI — a ~360-line
 * `object` that programmatically builds an alert View tree (FrameLayout /
 * LinearLayout / ScrollView / TextView / Button, GradientDrawable,
 * DesignTokens).
 *
 * It needs a real Context to inflate views, but NOT an Activity or a
 * WebView — DesignTokens only reads resources.configuration and
 * displayMetrics. A themed application context keeps this test cheap and
 * flake-free (no MainActivity launch, no WebView init). Runs on the
 * instrumentation thread so view construction is on the right looper.
 */
@RunWith(AndroidJUnit4::class)
@MediumTest
class SecurityAlertUITest {

    private fun themedContext() = ContextThemeWrapper(
        ApplicationProvider.getApplicationContext(),
        R.style.Theme_AndroidProject,
    )

    @Test
    fun buildsAlertViewWithThreats() {
        var exitClicked = false
        val view = SecurityAlertUI.createSecurityAlertView(
            themedContext(),
            listOf("ROOT_DETECTED", "DEBUGGER_ATTACHED", "EMULATOR_DETECTED"),
        ) { exitClicked = true }

        assertNotNull(view)
        assertTrue(view is ViewGroup)
        assertTrue((view as ViewGroup).childCount > 0)
        assertTrue("callback should not fire on build", !exitClicked)
    }

    @Test
    fun buildsAlertViewWithEmptyThreatList() {
        val view = SecurityAlertUI.createSecurityAlertView(themedContext(), emptyList()) {}
        assertNotNull(view)
    }
}
