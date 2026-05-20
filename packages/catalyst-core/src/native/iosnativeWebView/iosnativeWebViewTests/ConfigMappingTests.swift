import XCTest
@testable import CatalystCore

/**
 * Unit tests for Config Mapping
 *
 * Tests the configuration constants that are injected from config.json → XCConfig → ConfigConstants.swift
 * This validates that all expected configuration fields are accessible and have appropriate types.
 *
 * Categories:
 * 1. Basic Configuration Fields (6 tests)
 * 2. Access Control Configuration (4 tests)
 * 3. Splash Screen Configuration (6 tests)
 * 4. iOS-Specific Configuration (4 tests)
 * 5. Configuration Structure Validation (5 tests)
 *
 * Total: 25 tests
 *
 * Note: Since XCConfig values are injected at build time, these tests validate
 * that the ConfigConstants structure is correctly defined and accessible.
 */
final class ConfigMappingTests: XCTestCase {

    // ========================================
    // CATEGORY 1: Basic Configuration Fields
    // ========================================

    func testConfigConstants_URLField_IsAccessible() {
        // ConfigConstants.url should be accessible
        // Default: "http://localhost:3000"
        // Runtime: injected from config.json

        let url = ConfigConstants.url
        XCTAssertNotNil(url, "URL field should be accessible")
        XCTAssertFalse(url.isEmpty, "URL should not be empty")
    }

    func testConfigConstants_LocalIP_IsAccessible() {
        // ConfigConstants.LOCAL_IP for development server

        let localIP = ConfigConstants.LOCAL_IP
        XCTAssertNotNil(localIP, "LOCAL_IP should be accessible")
    }

    func testConfigConstants_Port_IsAccessible() {
        // ConfigConstants.port for server configuration

        let port = ConfigConstants.port
        XCTAssertNotNil(port, "Port should be accessible")
        // Port can be empty string or valid port number
    }

    func testConfigConstants_AppInfo_IsAccessible() {
        // ConfigConstants.appInfo for application metadata

        let appInfo = ConfigConstants.appInfo
        XCTAssertNotNil(appInfo, "AppInfo should be accessible")
        XCTAssertFalse(appInfo.isEmpty, "AppInfo should not be empty")
    }

    func testConfigConstants_CachePattern_IsAccessible() {
        // ConfigConstants.cachePattern as array of URL patterns

        let cachePattern = ConfigConstants.cachePattern
        XCTAssertNotNil(cachePattern, "CachePattern should be accessible")
        // Array can be empty or contain patterns
    }

    func testConfigConstants_UseHttps_IsAccessible() {
        // ConfigConstants.useHttps boolean flag

        let useHttps = ConfigConstants.useHttps
        // Should be accessible as boolean
        XCTAssertNotNil(useHttps, "UseHttps flag should be accessible")
    }

    // ========================================
    // CATEGORY 2: Access Control Configuration
    // ========================================

    func testConfigConstants_AccessControl_Enabled_IsAccessible() {
        // ConfigConstants.AccessControl.enabled nested property

        let enabled = ConfigConstants.AccessControl.enabled
        XCTAssertNotNil(enabled, "Access control enabled flag should be accessible")
    }

    func testConfigConstants_AccessControl_AllowedUrls_IsAccessible() {
        // ConfigConstants.AccessControl.allowedUrls array

        let allowedUrls = ConfigConstants.AccessControl.allowedUrls
        XCTAssertNotNil(allowedUrls, "Access control allowedUrls should be accessible")
        // Array can be empty or contain URLs
    }

    func testConfigConstants_AccessControlEnabled_TopLevel_IsAccessible() {
        // ConfigConstants.accessControlEnabled at top level

        let accessControlEnabled = ConfigConstants.accessControlEnabled
        XCTAssertNotNil(accessControlEnabled, "Top-level accessControlEnabled should be accessible")
    }

    func testConfigConstants_AllowedUrls_TopLevel_IsAccessible() {
        // ConfigConstants.allowedUrls at top level

        let allowedUrls = ConfigConstants.allowedUrls
        XCTAssertNotNil(allowedUrls, "Top-level allowedUrls should be accessible")
    }

    // ========================================
    // CATEGORY 3: Splash Screen Configuration
    // ========================================

    func testConfigConstants_SplashScreen_Enabled_IsAccessible() {
        // ConfigConstants.splashScreenEnabled

        let enabled = ConfigConstants.splashScreenEnabled
        XCTAssertNotNil(enabled, "Splash screen enabled flag should be accessible")
    }

    func testConfigConstants_SplashScreen_Duration_IsAccessible() {
        // ConfigConstants.splashScreenDuration as optional TimeInterval

        let duration = ConfigConstants.splashScreenDuration
        // Can be nil or a valid TimeInterval
        if let duration = duration {
            XCTAssertGreaterThanOrEqual(duration, 0, "Duration should be non-negative if present")
        }
        // Test passes even if nil
        XCTAssert(true, "Splash screen duration should be accessible (can be nil)")
    }

    func testConfigConstants_SplashScreen_BackgroundColor_IsAccessible() {
        // ConfigConstants.splashScreenBackgroundColor as hex string

        let backgroundColor = ConfigConstants.splashScreenBackgroundColor
        XCTAssertNotNil(backgroundColor, "Background color should be accessible")
        XCTAssertFalse(backgroundColor.isEmpty, "Background color should not be empty")
    }

    func testConfigConstants_SplashScreen_ImageWidth_IsAccessible() {
        // ConfigConstants.splashScreenImageWidth

        let imageWidth = ConfigConstants.splashScreenImageWidth
        XCTAssertNotNil(imageWidth, "Image width should be accessible")
        XCTAssertGreaterThan(imageWidth, 0, "Image width should be positive")
    }

    func testConfigConstants_SplashScreen_ImageHeight_IsAccessible() {
        // ConfigConstants.splashScreenImageHeight

        let imageHeight = ConfigConstants.splashScreenImageHeight
        XCTAssertNotNil(imageHeight, "Image height should be accessible")
        XCTAssertGreaterThan(imageHeight, 0, "Image height should be positive")
    }

    func testConfigConstants_SplashScreen_CornerRadius_IsAccessible() {
        // ConfigConstants.splashScreenCornerRadius

        let cornerRadius = ConfigConstants.splashScreenCornerRadius
        XCTAssertNotNil(cornerRadius, "Corner radius should be accessible")
        XCTAssertGreaterThanOrEqual(cornerRadius, 0, "Corner radius should be non-negative")
    }

    // ========================================
    // CATEGORY 4: iOS-Specific Configuration
    // ========================================

    func testConfigConstants_AppBundleId_IsAccessible() {
        // ConfigConstants.appBundleId for iOS bundle identifier

        let bundleId = ConfigConstants.appBundleId
        XCTAssertNotNil(bundleId, "App bundle ID should be accessible")
        XCTAssertFalse(bundleId.isEmpty, "App bundle ID should not be empty")

        // Bundle ID format validation: should contain at least one dot
        XCTAssertTrue(bundleId.contains("."), "Bundle ID should be in reverse domain format (e.g., com.example.app)")
    }

    func testConfigConstants_AppName_IsAccessible() {
        // ConfigConstants.appName for display name

        let appName = ConfigConstants.appName
        XCTAssertNotNil(appName, "App name should be accessible")
        XCTAssertFalse(appName.isEmpty, "App name should not be empty")
    }

    func testConfigConstants_BuildType_IsAccessible() {
        // ConfigConstants.buildType should be "debug" or "release"

        let buildType = ConfigConstants.buildType
        XCTAssertNotNil(buildType, "Build type should be accessible")
        XCTAssertFalse(buildType.isEmpty, "Build type should not be empty")

        // Validate it's one of the expected values
        let validBuildTypes = ["debug", "release"]
        XCTAssertTrue(validBuildTypes.contains(buildType.lowercased()),
                     "Build type should be 'debug' or 'release', got: \(buildType)")
    }

    func testConfigConstants_SimulatorName_IsAccessible() {
        // ConfigConstants.simulatorName for development

        let simulatorName = ConfigConstants.simulatorName
        XCTAssertNotNil(simulatorName, "Simulator name should be accessible")
    }

    // ========================================
    // CATEGORY 5: Configuration Structure Validation
    // ========================================

    func testConfigConstants_NotificationsEnum_IsAccessible() {
        // ConfigConstants.Notifications nested enum

        let notificationsEnabled = ConfigConstants.Notifications.enabled
        XCTAssertNotNil(notificationsEnabled, "Notifications.enabled should be accessible")
    }

    func testConfigConstants_SplashScreenEnum_IsAccessible() {
        // ConfigConstants.SplashScreen nested enum (legacy)

        let imageHeight = ConfigConstants.SplashScreen.imageHeight
        let imageWidth = ConfigConstants.SplashScreen.imageWidth

        XCTAssertNotNil(imageHeight, "SplashScreen.imageHeight should be accessible")
        XCTAssertNotNil(imageWidth, "SplashScreen.imageWidth should be accessible")
        XCTAssertGreaterThan(imageHeight, 0, "SplashScreen.imageHeight should be positive")
        XCTAssertGreaterThan(imageWidth, 0, "SplashScreen.imageWidth should be positive")
    }

    func testConfigConstants_AllNestedEnums_AreAccessible() {
        // Validates that all nested enum structures are accessible

        // AccessControl enum
        _ = ConfigConstants.AccessControl.enabled
        _ = ConfigConstants.AccessControl.allowedUrls

        // SplashScreen enum
        _ = ConfigConstants.SplashScreen.imageHeight
        _ = ConfigConstants.SplashScreen.imageWidth

        // Notifications enum
        _ = ConfigConstants.Notifications.enabled

        XCTAssert(true, "All nested enums should be accessible")
    }

    func testConfigConstants_AllTopLevelFields_HaveCorrectTypes() {
        // Type validation for all top-level fields
        // This test validates that ConfigConstants structure is correctly defined

        // Verify String fields are accessible and non-nil
        let stringFields = [
            ConfigConstants.url,
            ConfigConstants.LOCAL_IP,
            ConfigConstants.port,
            ConfigConstants.appInfo,
            ConfigConstants.appBundleId,
            ConfigConstants.appName,
            ConfigConstants.buildType,
            ConfigConstants.simulatorName,
            ConfigConstants.splashScreenBackgroundColor
        ]

        for field in stringFields {
            XCTAssertNotNil(field, "String field should not be nil")
        }

        // Verify Array fields are accessible
        XCTAssertNotNil(ConfigConstants.cachePattern, "cachePattern should be accessible")
        XCTAssertNotNil(ConfigConstants.allowedUrls, "allowedUrls should be accessible")

        // Verify Boolean fields are accessible (always true/false, never nil)
        _ = ConfigConstants.useHttps
        _ = ConfigConstants.accessControlEnabled
        _ = ConfigConstants.splashScreenEnabled

        // Verify numeric fields are accessible and positive
        XCTAssertGreaterThan(ConfigConstants.splashScreenImageWidth, 0)
        XCTAssertGreaterThan(ConfigConstants.splashScreenImageHeight, 0)
        XCTAssertGreaterThanOrEqual(ConfigConstants.splashScreenCornerRadius, 0)
    }

    func testConfigConstants_CriticalFields_AreNotEmpty() {
        // Validates that critical fields have non-empty values

        // Critical string fields that should never be empty
        XCTAssertFalse(ConfigConstants.url.isEmpty, "URL should not be empty")
        XCTAssertFalse(ConfigConstants.appInfo.isEmpty, "AppInfo should not be empty")
        XCTAssertFalse(ConfigConstants.appBundleId.isEmpty, "App bundle ID should not be empty")
        XCTAssertFalse(ConfigConstants.appName.isEmpty, "App name should not be empty")
        XCTAssertFalse(ConfigConstants.buildType.isEmpty, "Build type should not be empty")

        // These can be empty but should not be nil
        XCTAssertNotNil(ConfigConstants.LOCAL_IP)
        XCTAssertNotNil(ConfigConstants.port)
        XCTAssertNotNil(ConfigConstants.simulatorName)
    }
}
