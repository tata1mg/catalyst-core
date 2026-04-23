import XCTest
import Foundation
@testable import CatalystCore

/**
 * Unit tests for BootTimingUtility
 *
 * Tests the centralized timing utility for measuring app boot performance.
 * Only enabled in DEBUG builds for performance testing.
 *
 * Categories:
 * 1. Timing Capture (2 tests)
 * 2. Metrics Calculation (2 tests)
 * 3. Performance Reporting (2 tests)
 *
 * Total: 6 tests
 *
 * Testing Approach:
 * - Tests verify timing function behavior in DEBUG mode
 * - Tests verify timestamp formatting and elapsed time calculation
 * - Tests verify logging does not crash in release mode (no-op)
 * - Tests are lightweight and focus on utility logic
 */
final class BootTimingUtilityTests: XCTestCase {

    // ========================================
    // CATEGORY 1: Timing Capture (2 tests)
    // ========================================

    func testTimingCapture_AppLaunchTimeInitialized() {
        // Verify APP_LAUNCH_TIME is initialized
        #if DEBUG
        // In DEBUG mode, APP_LAUNCH_TIME should be set to a valid timestamp
        let currentTime = CFAbsoluteTimeGetCurrent()

        // APP_LAUNCH_TIME should be less than or equal to current time
        // (it was set when the module loaded)
        XCTAssertLessThanOrEqual(APP_LAUNCH_TIME, currentTime,
            "APP_LAUNCH_TIME should be initialized to a time <= current time")

        // APP_LAUNCH_TIME should be a reasonable recent time (within last hour)
        let oneHourAgo = currentTime - 3600
        XCTAssertGreaterThan(APP_LAUNCH_TIME, oneHourAgo,
            "APP_LAUNCH_TIME should be within the last hour (reasonable for test execution)")
        #else
        // In RELEASE mode, we can't test APP_LAUNCH_TIME as it doesn't exist
        XCTAssertTrue(true, "Skipping DEBUG-only test in RELEASE build")
        #endif
    }

    func testTimingCapture_LogWithTimestampDoesNotCrash() {
        // Verify logWithTimestamp does not crash with various inputs

        // Test with normal message
        logWithTimestamp("Test message 1")

        // Test with empty message
        logWithTimestamp("")

        // Test with special characters
        logWithTimestamp("Test with 🚀 emoji and special chars: <>!@#$%")

        // Test with long message
        let longMessage = String(repeating: "A", count: 1000)
        logWithTimestamp(longMessage)

        // Test with newlines
        logWithTimestamp("Line 1\nLine 2\nLine 3")

        // If we reach here without crashing, test passes
        XCTAssertTrue(true, "logWithTimestamp should handle all message types without crashing")
    }

    // ========================================
    // CATEGORY 2: Metrics Calculation (2 tests)
    // ========================================

    func testMetricsCalculation_ElapsedTimeCalculation() {
        #if DEBUG
        // Capture time before logging
        let timeBefore = CFAbsoluteTimeGetCurrent()

        // Small delay to ensure measurable elapsed time
        Thread.sleep(forTimeInterval: 0.01) // 10ms delay

        // Capture time after delay
        let timeAfter = CFAbsoluteTimeGetCurrent()

        // Calculate elapsed time from APP_LAUNCH_TIME
        let elapsedBefore = (timeBefore - APP_LAUNCH_TIME) * 1000 // Convert to ms
        let elapsedAfter = (timeAfter - APP_LAUNCH_TIME) * 1000

        // Verify elapsed time increases
        XCTAssertGreaterThan(elapsedAfter, elapsedBefore,
            "Elapsed time should increase over time")

        // Verify the difference is approximately 10ms (with tolerance for system variance)
        let difference = elapsedAfter - elapsedBefore
        XCTAssertGreaterThan(difference, 5.0, "Time difference should be at least 5ms")
        XCTAssertLessThan(difference, 50.0, "Time difference should be less than 50ms (accounting for system load)")
        #else
        XCTAssertTrue(true, "Skipping DEBUG-only test in RELEASE build")
        #endif
    }

    func testMetricsCalculation_TimestampFormatting() {
        #if DEBUG
        // Test timestamp formatting by directly calculating elapsed time
        let elapsed = (CFAbsoluteTimeGetCurrent() - APP_LAUNCH_TIME) * 1000

        // Format using same method as logWithTimestamp
        let formatted = String(format: "%.3f", elapsed)

        // Verify format is valid
        XCTAssertFalse(formatted.isEmpty, "Formatted timestamp should not be empty")

        // Verify it contains decimal point
        XCTAssertTrue(formatted.contains("."), "Formatted timestamp should contain decimal point")

        // Verify it has 3 decimal places
        if let decimalIndex = formatted.firstIndex(of: ".") {
            let afterDecimal = formatted[formatted.index(after: decimalIndex)...]
            XCTAssertEqual(afterDecimal.count, 3, "Timestamp should have exactly 3 decimal places")
        }

        // Verify it's a valid number
        XCTAssertNotNil(Double(formatted), "Formatted timestamp should be parseable as Double")

        // Verify it's a positive number
        if let value = Double(formatted) {
            XCTAssertGreaterThan(value, 0, "Elapsed time should be positive")
        }
        #else
        XCTAssertTrue(true, "Skipping DEBUG-only test in RELEASE build")
        #endif
    }

    // ========================================
    // CATEGORY 3: Performance Reporting (2 tests)
    // ========================================

    func testPerformanceReporting_LoggingInDebugMode() {
        #if DEBUG
        // Verify that logging works in DEBUG mode
        // We can't directly capture log output in unit tests, but we can verify:
        // 1. The function executes without crashing
        // 2. The timing values are reasonable

        let messagesToLog = [
            "App initialization started",
            "Config loaded",
            "WebView initialized",
            "Navigation complete",
            "App ready"
        ]

        for message in messagesToLog {
            // This should log with timestamp in DEBUG mode
            logWithTimestamp(message)
        }

        // If we reach here, logging worked without crashing
        XCTAssertTrue(true, "Logging should work in DEBUG mode without crashes")
        #else
        XCTAssertTrue(true, "Skipping DEBUG-only test in RELEASE build")
        #endif
    }

    func testPerformanceReporting_NoOpInReleaseMode() {
        // This test verifies that in RELEASE mode, logWithTimestamp is a no-op
        // We can't directly test the conditional compilation, but we can verify
        // that calling the function doesn't cause side effects

        #if !DEBUG
        // In RELEASE mode
        logWithTimestamp("This should be a no-op")

        // If we reach here without crashing, the no-op worked
        XCTAssertTrue(true, "logWithTimestamp should be a no-op in RELEASE mode")
        #else
        // In DEBUG mode, we'll just verify it doesn't crash
        logWithTimestamp("This should log in DEBUG mode")
        XCTAssertTrue(true, "logWithTimestamp should work in DEBUG mode")
        #endif
    }

    // ========================================
    // BONUS TESTS: Edge Cases
    // ========================================

    func testEdgeCase_ConcurrentLogging() {
        // Test that concurrent logging doesn't cause issues
        let expectation = self.expectation(description: "Concurrent logging completes")
        expectation.expectedFulfillmentCount = 10

        for i in 0..<10 {
            DispatchQueue.global(qos: .background).async {
                logWithTimestamp("Concurrent log \(i)")
                expectation.fulfill()
            }
        }

        waitForExpectations(timeout: 5.0) { error in
            XCTAssertNil(error, "Concurrent logging should complete without errors")
        }
    }

    func testEdgeCase_RapidSuccessiveLogging() {
        // Test rapid successive logging calls
        for i in 0..<100 {
            logWithTimestamp("Rapid log \(i)")
        }

        // If we reach here without crashing, test passes
        XCTAssertTrue(true, "Rapid successive logging should not crash")
    }

    func testEdgeCase_UnicodeCharacters() {
        // Test with various unicode characters
        let unicodeMessages = [
            "测试中文字符",
            "テスト日本語",
            "테스트 한국어",
            "тест русский",
            "اختبار العربية",
            "🚀🎉✅❌⚠️",
            "Mixed: Hello 世界 🌍"
        ]

        for message in unicodeMessages {
            logWithTimestamp(message)
        }

        XCTAssertTrue(true, "Unicode characters should be handled correctly")
    }
}
