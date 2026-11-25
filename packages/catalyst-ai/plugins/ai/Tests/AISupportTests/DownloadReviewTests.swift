import XCTest
@testable import AISupport

/// Download rules from the review backlog: what a 206 must say, how the pause/resume gate behaves, JSON booleans in the policy,
/// and which old model files may be removed.
final class DownloadReviewTests: XCTestCase {

    // MARK: 206 responses

    private func interpret206(_ range: String?, _ length: Int64?, offset: Int64 = 100) -> ResumeRules.Outcome {
        ResumeRules.interpret(status: 206, offset: offset, contentRange: range, contentLength: length)
    }

    func testA206ThatRunsToTheLastByteWithAMatchingBodyIsAppended() {
        XCTAssertEqual(interpret206("bytes 100-499/500", 400), .append(total: 500))
        XCTAssertEqual(interpret206("bytes 100-499/500", nil), .append(total: 500), "no length announced: the range itself is enough")
    }

    func testA206WhoseEndIsNotTheLastByteIsNotAccepted() {
        XCTAssertEqual(interpret206("bytes 100-299/500", 200), .restart)
    }

    func testA206WhoseBodyLengthDisagreesWithItsRangeIsNotAccepted() {
        XCTAssertEqual(interpret206("bytes 100-499/500", 399), .restart)
        XCTAssertEqual(interpret206("bytes 100-499/500", 401), .restart)
    }

    func testA206AtTheWrongOffsetWithoutATotalOrWithoutARangeRestarts() {
        XCTAssertEqual(interpret206("bytes 50-499/500", 450), .restart)
        XCTAssertEqual(interpret206("bytes 100-499/*", 400), .restart)
        XCTAssertEqual(interpret206(nil, 400), .restart)
    }

    // MARK: the gate

    func testAResumeThatLandsAfterTheCallerLookedButBeforeItNappedEndsTheNapAtOnce() async {
        let gate = DownloadGate()
        let mark = gate.ticket()
        gate.resume() // the page says the network is back, a moment before the backoff nap starts
        let started = Date()
        let woken = await gate.nap(seconds: 30, since: mark)
        XCTAssertTrue(woken)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2, "it must not serve the 30 s")
    }

    func testWaitingWhilePausedReturnsAtOnceWhenThePauseIsAlreadyLifted() async {
        let gate = DownloadGate()
        let started = Date()
        let woken = await gate.nap(seconds: 30, onlyWhilePaused: true)
        XCTAssertTrue(woken)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
    }

    func testWaitingWhilePausedStillWaitsForTheResume() async {
        let gate = DownloadGate()
        gate.pause(.offline)
        Task { try? await Task.sleep(nanoseconds: 150_000_000); gate.resume() }
        let woken = await gate.nap(seconds: 10, onlyWhilePaused: true)
        XCTAssertTrue(woken)
        gate.pause(.offline)
        let timedOut = await gate.nap(seconds: 0.1, onlyWhilePaused: true)
        XCTAssertFalse(timedOut, "paused and nobody resumes: the wait times out")
    }

    // MARK: the policy

    func testAJsonBooleanIsNotANumberForThePolicy() {
        let policy = DownloadPolicy(object: ["windowSec": true, "minBytesPerSec": false, "maxIdleRetries": true, "resumeDelaySec": 15])
        XCTAssertEqual(policy.windowSec, DownloadPolicy.default.windowSec, "true must not become a 5 s window")
        XCTAssertEqual(policy.minBytesPerSec, DownloadPolicy.default.minBytesPerSec)
        XCTAssertEqual(policy.maxIdleRetries, DownloadPolicy.default.maxIdleRetries)
        XCTAssertEqual(policy.resumeDelaySec, 15, "a real number is still read")
    }

    // MARK: files of earlier versions

    func testOldCopiesOfAModelAndTheirTemporaryFilesAreRemovedAndNothingElse() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("models-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        func write(_ name: String) { FileManager.default.createFile(atPath: dir.appendingPathComponent(name).path, contents: Data("x".utf8)) }
        for name in ["Qwen3-0.6B-it-int4.litertlm", "Qwen3-0.6B-it-int4.litertlm.tmp", "Qwen3-0.6B.litertlm", "gemma-4-E2B-it.litertlm"] { write(name) }
        let removed = LegacyModelFiles.remove(in: dir, names: ["Qwen3-0.6B-it-int4.litertlm", "never-existed.litertlm"])
        XCTAssertEqual(removed, ["Qwen3-0.6B-it-int4.litertlm", "Qwen3-0.6B-it-int4.litertlm.tmp"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("Qwen3-0.6B.litertlm").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("gemma-4-E2B-it.litertlm").path))
    }

    func testALegacyNameThatIsAPathIsNeverFollowedOutOfTheDirectory() throws {
        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("parent-\(UUID().uuidString)")
        let dir = parent.appendingPathComponent("ai_models")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: parent) }
        FileManager.default.createFile(atPath: parent.appendingPathComponent("keep.txt").path, contents: Data("keep".utf8))
        XCTAssertTrue(LegacyModelFiles.remove(in: dir, names: ["../keep.txt"]).isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: parent.appendingPathComponent("keep.txt").path))
    }
}
