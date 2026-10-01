package io.yourname.androidproject.utils

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.MockedConstruction
import org.mockito.Mockito.mockConstruction
import org.mockito.kotlin.any
import org.mockito.kotlin.anyOrNull
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.times
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

/**
 * Unit tests for NetworkMonitor (Android coverage batch 3), previously
 * entirely untested (0/25 lines). NetworkUtils (the top-level
 * getCurrentStatus/NetworkStatus in the same file) is exercised
 * indirectly here since NetworkMonitor.start() calls it immediately, and
 * again from each NetworkCallback override.
 *
 * ConnectivityManager/Network/NetworkCapabilities are all interfaces or
 * mockable framework classes reachable via a mocked Context.
 * NetworkRequest.Builder is a real android.jar builder class whose
 * methods are stubbed to return null under the mockable jar
 * (addCapability(...) returns null, so a real `.build()` call inside
 * start() NPEs) -- rather than skip start() coverage entirely (it's the
 * bulk of this class), Mockito.mockConstruction(NetworkRequest.Builder)
 * is used (mirroring MetricsMonitorTest's mockStatic(Choreographer)
 * pattern, applied to a constructor instead of a static). No real
 * NetworkRequest.Builder is ever constructed, so this stays compliant
 * with the project's "don't call .build() on real platform builders"
 * rule -- the builder itself is fully faked. Kept open for every test's
 * lifetime since start() constructs a fresh Builder on each call.
 *
 * Build.VERSION.SDK_INT resolves to 0 under the mockable android.jar
 * (confirmed empirically), so `Build.VERSION.SDK_INT >= Build.VERSION_CODES.N`
 * is always false in these tests -- the registerNetworkCallback(request,
 * callback) branch is the only one structurally reachable here.
 * registerDefaultNetworkCallback is never invoked and is not tested.
 */
class NetworkMonitorTest {

    private lateinit var connectivityManager: ConnectivityManager
    private lateinit var appContext: Context
    private lateinit var context: Context
    private lateinit var requestBuilderMock: MockedConstruction<NetworkRequest.Builder>

    @Before
    fun setUp() {
        connectivityManager = mock()
        appContext = mock {
            on { getSystemService(Context.CONNECTIVITY_SERVICE) } doReturn connectivityManager
        }
        context = mock {
            on { getApplicationContext() } doReturn appContext
        }

        // Default: no active network -- getCurrentStatus resolves to offline
        // unless a test overrides these.
        whenever(connectivityManager.activeNetwork).thenReturn(null)
        whenever(connectivityManager.getNetworkCapabilities(anyOrNull())).thenReturn(null)
        whenever(connectivityManager.activeNetworkInfo).thenReturn(null)

        requestBuilderMock = mockConstruction(NetworkRequest.Builder::class.java) { builderMock, _ ->
            whenever(builderMock.addCapability(any())).thenReturn(builderMock)
            whenever(builderMock.build()).thenReturn(mock<NetworkRequest>())
        }
    }

    @After
    fun tearDown() {
        requestBuilderMock.close()
    }

    // ============================================================
    // start()
    // ============================================================

    @Test
    fun `start emits the current status immediately`() {
        val statuses = mutableListOf<NetworkStatus>()
        val monitor = NetworkMonitor(context) { statuses.add(it) }

        monitor.start()

        assertEquals(1, statuses.size)
        assertEquals(false, statuses[0].isOnline)
    }

    @Test
    fun `start emits an online status when capabilities report internet validated`() {
        val capabilities = mock<NetworkCapabilities> {
            on { hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) } doReturn true
            on { hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) } doReturn true
            on { hasTransport(any()) } doReturn false
        }
        val network = mock<Network>()
        whenever(connectivityManager.activeNetwork).thenReturn(network)
        whenever(connectivityManager.getNetworkCapabilities(network)).thenReturn(capabilities)

        val statuses = mutableListOf<NetworkStatus>()
        val monitor = NetworkMonitor(context) { statuses.add(it) }

        monitor.start()

        assertEquals(1, statuses.size)
        assertTrue(statuses[0].isOnline)
    }

    @Test
    fun `start registers a network callback via registerNetworkCallback`() {
        val monitor = NetworkMonitor(context) { }

        monitor.start()

        verify(connectivityManager).registerNetworkCallback(
            any<NetworkRequest>(),
            any<ConnectivityManager.NetworkCallback>()
        )
    }

    @Test
    fun `calling start twice does not emit a second immediate status or re-register`() {
        val statuses = mutableListOf<NetworkStatus>()
        val monitor = NetworkMonitor(context) { statuses.add(it) }

        monitor.start()
        monitor.start()

        // Second start() is a no-op guarded by `if (callback != null) return`.
        assertEquals(1, statuses.size)
        verify(connectivityManager, times(1)).registerNetworkCallback(
            any<NetworkRequest>(),
            any<ConnectivityManager.NetworkCallback>()
        )
    }

    @Test
    fun `start swallows a registration exception and resets callback to null`() {
        whenever(
            connectivityManager.registerNetworkCallback(
                any<NetworkRequest>(),
                any<ConnectivityManager.NetworkCallback>()
            )
        ).thenThrow(RuntimeException("boom"))

        val statuses = mutableListOf<NetworkStatus>()
        val monitor = NetworkMonitor(context) { statuses.add(it) }

        // Should not throw -- try/catch swallows the registration failure
        // and resets callback to null.
        monitor.start()

        // The immediate status emission still happened before the
        // exception (it's emitted first, outside the try/catch).
        assertEquals(1, statuses.size)

        // Since callback was reset to null, a second start() is not
        // treated as a no-op -- it emits a second immediate status and
        // retries registration.
        monitor.start()
        assertEquals(2, statuses.size)
        verify(connectivityManager, times(2)).registerNetworkCallback(
            any<NetworkRequest>(),
            any<ConnectivityManager.NetworkCallback>()
        )
    }

    // ============================================================
    // stop()
    // ============================================================

    @Test
    fun `stop before start does not throw and does not unregister`() {
        val monitor = NetworkMonitor(context) { }
        monitor.stop()
        verify(connectivityManager, never()).unregisterNetworkCallback(any<ConnectivityManager.NetworkCallback>())
    }

    @Test
    fun `stop after start unregisters the callback`() {
        val monitor = NetworkMonitor(context) { }
        monitor.start()

        monitor.stop()

        verify(connectivityManager).unregisterNetworkCallback(any<ConnectivityManager.NetworkCallback>())
    }

    @Test
    fun `stop swallows an unregister exception`() {
        whenever(connectivityManager.unregisterNetworkCallback(any<ConnectivityManager.NetworkCallback>()))
            .thenThrow(RuntimeException("boom"))
        val monitor = NetworkMonitor(context) { }
        monitor.start()

        // Should not throw.
        monitor.stop()
    }

    @Test
    fun `calling stop twice only unregisters once`() {
        val monitor = NetworkMonitor(context) { }
        monitor.start()
        monitor.stop()
        monitor.stop()

        // unregisterNetworkCallback should only be invoked once -- the
        // second stop() sees callback == null and no-ops.
        verify(connectivityManager, times(1)).unregisterNetworkCallback(any<ConnectivityManager.NetworkCallback>())
    }

    // ============================================================
    // NetworkCallback overrides (onAvailable/onLost/onUnavailable) --
    // captured via ArgumentCaptor and invoked directly, since there's no
    // real ConnectivityManager driving them in a JVM unit test.
    // ============================================================

    @Test
    fun `onAvailable re-emits the current status`() {
        val statuses = mutableListOf<NetworkStatus>()
        val monitor = NetworkMonitor(context) { statuses.add(it) }
        monitor.start()

        val captor = argumentCaptor<ConnectivityManager.NetworkCallback>()
        verify(connectivityManager).registerNetworkCallback(any<NetworkRequest>(), captor.capture())

        captor.firstValue.onAvailable(mock())

        assertEquals(2, statuses.size)
    }

    @Test
    fun `onLost re-emits the current status`() {
        val statuses = mutableListOf<NetworkStatus>()
        val monitor = NetworkMonitor(context) { statuses.add(it) }
        monitor.start()

        val captor = argumentCaptor<ConnectivityManager.NetworkCallback>()
        verify(connectivityManager).registerNetworkCallback(any<NetworkRequest>(), captor.capture())

        captor.firstValue.onLost(mock())

        assertEquals(2, statuses.size)
    }

    @Test
    fun `onUnavailable re-emits the current status`() {
        val statuses = mutableListOf<NetworkStatus>()
        val monitor = NetworkMonitor(context) { statuses.add(it) }
        monitor.start()

        val captor = argumentCaptor<ConnectivityManager.NetworkCallback>()
        verify(connectivityManager).registerNetworkCallback(any<NetworkRequest>(), captor.capture())

        captor.firstValue.onUnavailable()

        assertEquals(2, statuses.size)
    }
}
