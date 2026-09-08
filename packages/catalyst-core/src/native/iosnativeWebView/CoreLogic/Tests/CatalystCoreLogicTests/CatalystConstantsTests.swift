import XCTest
@testable import CatalystCoreLogic

/**
 * Unit tests for CatalystConstants
 *
 * Most of this file is static constant declarations, exercised here mainly
 * as sanity/regression checks. The two pieces of real logic —
 * `Bridge.isTraceExportEnabled` and `Bridge.validCommands` — get more
 * thorough coverage.
 *
 * Known gap (documented, not silently accepted): `validCommands` also reads
 * module-level `ConfigConstants.Profiler.enabled` /
 * `ConfigConstants.Notifications.enabled`, which are `public static let`
 * compile-time constants from the checked-in stub (both `false`). There is
 * no test seam (unlike URLWhitelistManager's `testInitialize`) to force
 * those to `true`, so the two `if` branches that add
 * "exportCatalystTrace"/notification commands to `validCommands` cannot be
 * exercised from this file alone. `isTraceExportEnabled` itself IS fully
 * covered below since its parameters can be passed explicitly, bypassing
 * the defaults.
 */
final class CatalystConstantsTests: XCTestCase {

    // MARK: - FileTransport

    func testFileTransport_Base64SizeLimit() {
        XCTAssertEqual(CatalystConstants.FileTransport.base64SizeLimit, 2 * 1024 * 1024)
    }

    func testFileTransport_FrameworkServerSizeLimit() {
        XCTAssertEqual(CatalystConstants.FileTransport.frameworkServerSizeLimit, 100 * 1024 * 1024)
    }

    // MARK: - ImageProcessing

    func testImageProcessing_QualityLevels() {
        XCTAssertEqual(CatalystConstants.ImageProcessing.Quality.high, 0.9)
        XCTAssertEqual(CatalystConstants.ImageProcessing.Quality.medium, 0.7)
        XCTAssertEqual(CatalystConstants.ImageProcessing.Quality.low, 0.5)
    }

    func testImageProcessing_DefaultQualityMatchesMedium() {
        XCTAssertEqual(
            CatalystConstants.ImageProcessing.defaultQuality,
            CatalystConstants.ImageProcessing.Quality.medium
        )
    }

    // MARK: - NetworkServer

    func testNetworkServer_PortRangeIsValidAndNonEmpty() {
        let start = CatalystConstants.NetworkServer.portRangeStart
        let end = CatalystConstants.NetworkServer.portRangeEnd
        XCTAssertLessThan(start, end)
    }

    func testNetworkServer_TimeoutsArePositive() {
        XCTAssertGreaterThan(CatalystConstants.NetworkServer.sessionTimeout, 0)
        XCTAssertGreaterThan(CatalystConstants.NetworkServer.cleanupInterval, 0)
        XCTAssertGreaterThan(CatalystConstants.NetworkServer.connectionTimeout, 0)
    }

    func testNetworkServer_MaxConnectionsIsPositive() {
        XCTAssertGreaterThan(CatalystConstants.NetworkServer.maxConnections, 0)
    }

    // MARK: - ErrorCodes

    func testErrorCodes_MatchStandardHTTPStatusCodes() {
        XCTAssertEqual(CatalystConstants.ErrorCodes.badRequest, 400)
        XCTAssertEqual(CatalystConstants.ErrorCodes.fileNotFound, 404)
        XCTAssertEqual(CatalystConstants.ErrorCodes.internalServerError, 500)
    }

    // MARK: - Cache

    func testCache_FreshWindowIsShorterThanStaleWindow() {
        XCTAssertLessThan(
            CatalystConstants.Cache.freshWindow,
            CatalystConstants.Cache.staleWindow
        )
    }

    func testCache_CapacitiesAreDiskLargerThanMemory() {
        XCTAssertLessThan(
            CatalystConstants.Cache.memoryCapacity,
            CatalystConstants.Cache.diskCapacity
        )
    }

    // MARK: - Logging.Categories

    func testLogging_CategoriesAreAllNonEmptyAndDistinct() {
        let categories = [
            CatalystConstants.Logging.Categories.nativeBridge,
            CatalystConstants.Logging.Categories.javascriptInterface,
            CatalystConstants.Logging.Categories.messageValidator,
            CatalystConstants.Logging.Categories.commandHandler,
            CatalystConstants.Logging.Categories.fileHandler,
            CatalystConstants.Logging.Categories.delegateHandler,
        ]
        XCTAssertTrue(categories.allSatisfy { !$0.isEmpty })
        XCTAssertEqual(Set(categories).count, categories.count, "Logging categories should be distinct")
    }

    // MARK: - Bridge.isDebugBuild

    func testBridge_IsDebugBuildMatchesBuildConfiguration() {
        #if DEBUG
        XCTAssertTrue(CatalystConstants.Bridge.isDebugBuild)
        #else
        XCTAssertFalse(CatalystConstants.Bridge.isDebugBuild)
        #endif
    }

    // MARK: - Bridge.isTraceExportEnabled — all 4 explicit combinations

    func testIsTraceExportEnabled_DebugTrueProfilerTrue_ReturnsTrue() {
        XCTAssertTrue(
            CatalystConstants.Bridge.isTraceExportEnabled(debugBuild: true, profilerEnabled: true)
        )
    }

    func testIsTraceExportEnabled_DebugTrueProfilerFalse_ReturnsFalse() {
        XCTAssertFalse(
            CatalystConstants.Bridge.isTraceExportEnabled(debugBuild: true, profilerEnabled: false)
        )
    }

    func testIsTraceExportEnabled_DebugFalseProfilerTrue_ReturnsFalse() {
        XCTAssertFalse(
            CatalystConstants.Bridge.isTraceExportEnabled(debugBuild: false, profilerEnabled: true)
        )
    }

    func testIsTraceExportEnabled_DebugFalseProfilerFalse_ReturnsFalse() {
        XCTAssertFalse(
            CatalystConstants.Bridge.isTraceExportEnabled(debugBuild: false, profilerEnabled: false)
        )
    }

    // MARK: - Bridge.validCommands

    func testValidCommands_ContainsAlwaysPresentBaseCommands() {
        let commands = CatalystConstants.Bridge.validCommands

        let expectedBaseCommands = [
            "openCamera", "requestCameraPermission", "getDeviceInfo", "getNetworkStatus",
            "logger", "pickFile", "openFileWithIntent", "requestHapticFeedback",
            "googleSignIn", "getSafeArea", "setScreenSecure", "getScreenSecure",
            "clearWebData", "startVideoStream", "stopVideoStream", "flipVideoStream",
            "sendVideoStreamCommand", "setVideoStreamZoom", "setVideoStreamTorch",
            "setVideoStreamFps", "startTransition", "commitTransition", "cancelTransition",
        ]

        for command in expectedBaseCommands {
            XCTAssertTrue(commands.contains(command), "Expected base command missing: \(command)")
        }
    }

    /// Known gap: with the checked-in ConfigConstants stub (Profiler.enabled
    /// and Notifications.enabled both false), validCommands cannot be forced
    /// down its `true`-branches from this test file — there's no equivalent
    /// of URLWhitelistManager's testInitialize() seam for ConfigConstants.
    /// This test documents and asserts the actual (disabled-config) behavior
    /// rather than silently skipping the file.
    func testValidCommands_ExportTraceAndNotificationCommandsAbsentUnderDisabledConfig() {
        let commands = CatalystConstants.Bridge.validCommands

        if !CatalystConstants.Bridge.isTraceExportEnabled() {
            XCTAssertFalse(commands.contains("exportCatalystTrace"))
        }

        if !ConfigConstants.Notifications.enabled {
            let notificationCommands = [
                "requestNotificationPermission", "scheduleLocalNotification",
                "cancelLocalNotification", "registerForPushNotifications",
                "subscribeToTopic", "unsubscribeFromTopic", "getSubscribedTopics",
            ]
            for command in notificationCommands {
                XCTAssertFalse(commands.contains(command), "Unexpected notification command present: \(command)")
            }
        }
    }

    func testValidCommands_IsStableAcrossRepeatedCalls() {
        let first = CatalystConstants.Bridge.validCommands
        let second = CatalystConstants.Bridge.validCommands
        XCTAssertEqual(first, second)
    }
}
