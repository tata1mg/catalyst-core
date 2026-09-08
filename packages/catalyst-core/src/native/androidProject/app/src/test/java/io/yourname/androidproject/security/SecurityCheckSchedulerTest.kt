package io.yourname.androidproject.security

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.doAnswer
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Unit tests for SecurityCheckScheduler (Android coverage batch 4),
 * previously entirely untested (0/19 lines).
 *
 * Scope: this is a thin Context + CoroutineScope wrapper that delegates to
 * SecurityCheckManager.performSecurityChecks(context) (already covered in
 * depth by SecurityCheckManagerTest -- its ALLOW/BLOCK branches, JSON
 * shape, and persistence are NOT re-verified here). This suite only
 * verifies that SecurityCheckScheduler.initialize():
 *  - launches the check in the given scope and the callback receives the
 *    results SecurityCheckManager produced,
 *  - works with no callback at all (callback is nullable, `callback?.let`),
 *  - does not throw when SecurityCheckManager's own call throws (the
 *    launched coroutine's inner try/catch swallows it).
 *
 * Empirically-required setup: initialize() delivers the callback via
 * `withContext(Dispatchers.Main)`. A JVM unit test has no real Android
 * main-thread Looper, so Dispatchers.Main is uninitialized by default and
 * would throw ("Module with the Main dispatcher is missing"). Per
 * kotlinx-coroutines-test (already a project dependency -- see
 * SecurityCheckManagerTest's runTest usage), Dispatchers.setMain(...) with
 * a StandardTestDispatcher is installed in setUp()/torn down with
 * Dispatchers.resetMain() in tearDown(), so the Main hop has somewhere
 * real to resolve on instead of throwing.
 *
 * Note this test does NOT rely on runTest's virtual-time
 * advanceUntilIdle() to observe completion: SecurityCheckManager.
 * performSecurityChecks() internally does `withContext(Dispatchers.Default)`
 * -- the REAL Default dispatcher, backed by real background threads, which
 * runTest's virtual scheduler has no visibility into or control over (only
 * the StandardTestDispatcher installed as Main is virtual-time-controlled
 * here). So instead of advancing virtual time, these tests block the test
 * thread on a CountDownLatch that the callback (or a manual completion
 * signal) counts down, with a real wall-clock timeout -- the same
 * "observe real async completion from a JVM unit test" shape as
 * FridaDetectorTest's socket-based tests elsewhere in this suite.
 *
 * Context/SharedPreferences mocking mirrors SecurityCheckManagerTest's
 * setUp() exactly, since initialize() -> performSecurityChecks() ->
 * saveLatestResults() needs a working getSharedPreferences()/edit() chain
 * to complete without throwing.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SecurityCheckSchedulerTest {

    private lateinit var prefsStorage: MutableMap<String, String?>
    private lateinit var sharedPreferences: SharedPreferences
    private lateinit var editor: SharedPreferences.Editor
    private lateinit var context: Context

    @Before
    fun setUp() {
        Dispatchers.setMain(StandardTestDispatcher())

        prefsStorage = mutableMapOf()

        editor = mock {
            on { putString(any(), any()) } doAnswer { invocation ->
                val key = invocation.getArgument<String>(0)
                val value = invocation.getArgument<String?>(1)
                prefsStorage[key] = value
                editor
            }
        }
        org.mockito.kotlin.doNothing().`when`(editor).apply()

        sharedPreferences = mock {
            on { getString(any(), org.mockito.kotlin.anyOrNull()) } doAnswer { invocation ->
                val key = invocation.getArgument<String>(0)
                val default = invocation.getArgument<String?>(1)
                prefsStorage[key] ?: default
            }
            on { edit() } doReturn editor
        }

        context = mock {
            on { getSharedPreferences(any(), any()) } doReturn sharedPreferences
        }
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        prefsStorage.clear()
    }

    @Test
    fun `initialize invokes the callback with the security check results on the main dispatcher`() {
        val latch = CountDownLatch(1)
        var received: org.json.JSONObject? = null
        val callback = object : SecurityCheckScheduler.SecurityCheckCallback {
            override fun onSecurityCheckComplete(results: org.json.JSONObject) {
                received = results
                latch.countDown()
            }
        }

        runTest {
            SecurityCheckScheduler.initialize(context, this, callback)
        }

        assertTrue("callback should have been invoked within 5s", latch.await(5, TimeUnit.SECONDS))
        assertEquals("ALLOW", received!!.getString("recommendation"))
    }

    @Test
    fun `initialize with no callback completes without throwing`() = runTest {
        SecurityCheckScheduler.initialize(context, this, callback = null)
        // Reaching here without an exception is the assertion -- initialize()
        // must not require a callback to be supplied. There is no callback
        // signal to await, so this only proves the synchronous launch path
        // (the try/catch around scope.launch{}) doesn't throw.
    }

    @Test
    fun `initialize does not propagate an exception when the underlying check throws`() {
        val throwingContext: Context = mock {
            on { getSharedPreferences(any(), any()) } doAnswer { throw RuntimeException("boom") }
        }
        val latch = CountDownLatch(1)
        val callback = object : SecurityCheckScheduler.SecurityCheckCallback {
            override fun onSecurityCheckComplete(results: org.json.JSONObject) {
                latch.countDown()
            }
        }

        // SecurityCheckManager.performSecurityChecks itself catches broadly and
        // returns an error JSONObject rather than throwing (see its own
        // createErrorResponse fallback) -- but even if it didn't, initialize()'s
        // own outer try/catch around scope.launch{} plus the inner try/catch
        // around performSecurityChecks() must keep this call from propagating.
        runTest {
            SecurityCheckScheduler.initialize(throwingContext, this, callback)
        }

        // The call above completing without throwing is the primary
        // assertion. Whether the callback fires at all depends entirely on
        // SecurityCheckManager's already-covered internals (it does still
        // reach ALLOW here since checkRooted/checkEmulator/checkFridaDetected
        // don't touch getSharedPreferences), so this just confirms
        // initialize() itself stays exception-safe with a throwing Context.
        assertTrue(latch.await(5, TimeUnit.SECONDS))
    }
}
