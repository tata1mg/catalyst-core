import XCTest
@testable import AISupport

final class DownloadPolicyTests: XCTestCase {
    func testDefaults() {
        let p = DownloadPolicy()
        XCTAssertEqual(p.minBytesPerSec, 50_000)
        XCTAssertEqual(p.windowSec, 20)
        XCTAssertEqual(p.resumeDelaySec, 10)
        XCTAssertEqual(p.maxIdleRetries, 8)
    }

    func testReadsConfigAndClampsOutOfRangeValues() {
        let p = DownloadPolicy(object: ["minBytesPerSec": 100_000, "windowSec": 1, "resumeDelaySec": 9999, "maxIdleRetries": 500])
        XCTAssertEqual(p.minBytesPerSec, 100_000)
        XCTAssertEqual(p.windowSec, 5, "too short a window would flag every hiccup")
        XCTAssertEqual(p.resumeDelaySec, 600)
        XCTAssertEqual(p.maxIdleRetries, 50)
        XCTAssertGreaterThanOrEqual(p.maxDelaySec, p.resumeDelaySec)
    }

    func testIgnoresWrongTypes() {
        XCTAssertEqual(DownloadPolicy(object: ["windowSec": "soon", "minBytesPerSec": [1]]), DownloadPolicy())
        XCTAssertEqual(DownloadPolicy(object: nil), DownloadPolicy())
    }

    func testBackoffDoublesAndCaps() {
        var p = DownloadPolicy()
        p.resumeDelaySec = 10
        p.maxDelaySec = 60
        XCTAssertEqual([1, 2, 3, 4, 5, 9].map(p.backoff(attempt:)), [10, 20, 40, 60, 60, 60])
        XCTAssertEqual(p.backoff(attempt: 0), 10)
    }

    func testAIOptionsCarriesThePolicy() {
        let options = AIOptions(optionsRaw: #"{"download":{"minBytesPerSec":75000,"resumeDelaySec":5}}"#)
        XCTAssertEqual(options.downloadPolicy.minBytesPerSec, 75_000)
        XCTAssertEqual(options.downloadPolicy.resumeDelaySec, 5)
        XCTAssertEqual(AIOptions(optionsRaw: nil).downloadPolicy, DownloadPolicy())
    }
}

final class ThroughputWindowTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000)

    func testFirstChunkOnlyStartsTheClock() {
        var w = ThroughputWindow(minBytesPerSec: 50_000, windowSec: 10)
        XCTAssertEqual(w.record(bytes: 10, at: t0), .ok)
    }

    func testFastLinkStaysOkAcrossWindows() {
        var w = ThroughputWindow(minBytesPerSec: 50_000, windowSec: 10)
        _ = w.record(bytes: 1, at: t0)
        XCTAssertEqual(w.record(bytes: 400_000, at: t0.addingTimeInterval(5)), .ok)
        XCTAssertEqual(w.record(bytes: 400_000, at: t0.addingTimeInterval(10)), .ok)
        XCTAssertEqual(w.record(bytes: 600_000, at: t0.addingTimeInterval(20)), .ok, "60 KB/s over the second window")
        XCTAssertEqual(w.record(bytes: 400_000, at: t0.addingTimeInterval(30)), .weak(bytesPerSec: 40_000), "40 KB/s is under the 50 KB/s minimum")
    }

    func testSlowLinkIsWeakOnceTheWindowCloses() {
        var w = ThroughputWindow(minBytesPerSec: 50_000, windowSec: 10)
        _ = w.record(bytes: 1, at: t0)
        XCTAssertEqual(w.record(bytes: 20_000, at: t0.addingTimeInterval(4)), .ok, "the window is not over yet")
        XCTAssertEqual(w.record(bytes: 20_000, at: t0.addingTimeInterval(10)), .weak(bytesPerSec: 4_000))
    }

    func testAShortBurstDoesNotHideASlowWindow() {
        var w = ThroughputWindow(minBytesPerSec: 50_000, windowSec: 10)
        _ = w.record(bytes: 1, at: t0)
        // fast for a second, then nothing but a trickle: the window average still decides
        _ = w.record(bytes: 100_000, at: t0.addingTimeInterval(1))
        XCTAssertEqual(w.record(bytes: 1_000, at: t0.addingTimeInterval(10)), .weak(bytesPerSec: 10_100))
    }

    func testTheWindowResetsAfterEachVerdict() {
        var w = ThroughputWindow(minBytesPerSec: 50_000, windowSec: 10)
        _ = w.record(bytes: 1, at: t0)
        XCTAssertEqual(w.record(bytes: 1_000, at: t0.addingTimeInterval(10)), .weak(bytesPerSec: 100))
        XCTAssertEqual(w.record(bytes: 900_000, at: t0.addingTimeInterval(20)), .ok, "a recovered link is judged on its own window")
    }
}

final class DownloadGateTests: XCTestCase {
    func testPauseAndResumeToggleTheReason() {
        let gate = DownloadGate()
        XCTAssertNil(gate.pausedReason)
        gate.pause(.offline)
        XCTAssertEqual(gate.pausedReason, .offline)
        gate.resume()
        XCTAssertNil(gate.pausedReason)
    }

    func testPauseInterruptsTheTransferInFlight() {
        let gate = DownloadGate()
        var seen: PauseReason?
        gate.setPauseHandler { seen = $0 }
        gate.pause(.offline)
        XCTAssertEqual(seen, .offline)
        gate.setPauseHandler(nil)
        seen = nil
        gate.pause(.offline)
        XCTAssertNil(seen, "a finished transfer no longer listens")
    }

    func testNapEndsEarlyWhenTheCommandResumes() async {
        let gate = DownloadGate()
        gate.pause(.offline)
        Task { try? await Task.sleep(nanoseconds: 50_000_000); gate.resume() }
        let started = Date()
        let woken = await gate.nap(seconds: 5)
        XCTAssertTrue(woken)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
    }

    func testNapTimesOutWhenNothingResumes() async {
        let gate = DownloadGate()
        let woken = await gate.nap(seconds: 0.05)
        XCTAssertFalse(woken)
    }

    func testNapEndsWhenTheTaskIsCancelled() async {
        let gate = DownloadGate()
        let task = Task { await gate.nap(seconds: 30) }
        try? await Task.sleep(nanoseconds: 50_000_000)
        task.cancel()
        let started = Date()
        _ = await task.value
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
    }
}

final class ResilientDownloadTests: XCTestCase {
    private func fastPolicy() -> DownloadPolicy {
        var p = DownloadPolicy()
        p.resumeDelaySec = 0.01
        p.maxDelaySec = 0.05
        p.heldRetrySec = 0.1
        p.maxIdleRetries = 3
        return p
    }

    private final class Recorder {
        var events: [DownloadStatus] = []
        var size: Int64 = 0
    }

    private func make(_ rec: Recorder, gate: DownloadGate = DownloadGate(), policy: DownloadPolicy? = nil) -> (ResilientDownload, DownloadGate) {
        (ResilientDownload(policy: policy ?? fastPolicy(), gate: gate, partialSize: { rec.size }, emit: { rec.events.append($0) }), gate)
    }

    func testReturnsTheSizeWhenTheFirstAttemptSucceeds() async throws {
        let rec = Recorder()
        let (r, _) = make(rec)
        let size = try await r.run { 123 }
        XCTAssertEqual(size, 123)
        XCTAssertTrue(rec.events.isEmpty)
    }

    func testRetriesAfterATransientErrorAndReportsPausedThenResuming() async throws {
        let rec = Recorder()
        let (r, _) = make(rec)
        var calls = 0
        let size = try await r.run {
            calls += 1
            if calls == 1 { rec.size = 100; throw URLError(.networkConnectionLost) }
            return 500
        }
        XCTAssertEqual(size, 500)
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(rec.events.first, .paused(.error, retryInSec: 1))
        XCTAssertEqual(rec.events.last, .resuming)
    }

    func testAWeakLinkPausesWithTheWeakReason() async throws {
        let rec = Recorder()
        let (r, _) = make(rec)
        var calls = 0
        _ = try await r.run {
            calls += 1
            if calls == 1 { rec.size = 10; throw DownloadInterrupted(kind: .weak(bytesPerSec: 3_000)) }
            return 1
        }
        guard case .paused(let reason, _)? = rec.events.first else { return XCTFail("expected a paused event") }
        XCTAssertEqual(reason, .weak)
    }

    func testWaitsWhilePausedAndContinuesOnResume() async throws {
        let rec = Recorder()
        let gate = DownloadGate()
        var policy = fastPolicy()
        policy.heldRetrySec = 30
        let (r, _) = make(rec, gate: gate, policy: policy)
        gate.pause(.offline)
        var attempts = 0
        Task { try? await Task.sleep(nanoseconds: 100_000_000); gate.resume() }
        let started = Date()
        let size = try await r.run { attempts += 1; return 9 }
        XCTAssertEqual(size, 9)
        XCTAssertEqual(attempts, 1)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5, "resume() must end the wait, not the 30 s safety net")
        XCTAssertEqual(rec.events.first, .paused(.offline, retryInSec: nil))
    }

    func testTheSafetyNetRetriesEvenIfThePageNeverResumes() async throws {
        let rec = Recorder()
        let gate = DownloadGate()
        let (r, _) = make(rec, gate: gate)
        gate.pause(.offline)
        let size = try await r.run { 7 }
        XCTAssertEqual(size, 7)
        XCTAssertNil(gate.pausedReason)
    }

    func testAPauseInTheMiddleOfAnAttemptWaitsAndThenRunsAgain() async throws {
        let rec = Recorder()
        let gate = DownloadGate()
        let (r, _) = make(rec, gate: gate)
        var calls = 0
        let size = try await r.run {
            calls += 1
            if calls == 1 { gate.pause(.offline); throw DownloadInterrupted(kind: .paused(.offline)) }
            return 42
        }
        XCTAssertEqual(size, 42)
        XCTAssertEqual(calls, 2)
    }

    func testGivesUpAfterTooManyAttemptsThatMoveNoBytes() async {
        let rec = Recorder()
        let (r, _) = make(rec)
        var calls = 0
        do {
            _ = try await r.run { calls += 1; throw URLError(.timedOut) }
            XCTFail("should have given up")
        } catch let error as ModelDownloadError {
            XCTAssertFalse(error.discardPartial, "the partial stays for the next launch")
            XCTAssertTrue(error.message.contains("no progress"))
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(calls, 4, "maxIdleRetries + 1")
    }

    func testProgressResetsTheGiveUpCounter() async throws {
        let rec = Recorder()
        let (r, _) = make(rec)
        var calls = 0
        let size = try await r.run {
            calls += 1
            if calls <= 10 { rec.size += 1_000; throw URLError(.networkConnectionLost) }
            return 1
        }
        XCTAssertEqual(size, 1)
        XCTAssertEqual(calls, 11, "ten failed attempts that each moved bytes must not exhaust a limit of three")
    }

    func testNonTransientErrorsPropagateImmediately() async {
        let rec = Recorder()
        let (r, _) = make(rec)
        var calls = 0
        do {
            _ = try await r.run { calls += 1; throw ModelDownloadError(message: "HTTP 401 from model server", discardPartial: true) }
            XCTFail()
        } catch let error as ModelDownloadError {
            XCTAssertTrue(error.discardPartial)
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(calls, 1)
    }

    func testClassifiesErrors() {
        XCTAssertTrue(ResilientDownload.isTransient(URLError(.notConnectedToInternet)))
        XCTAssertTrue(ResilientDownload.isTransient(URLError(.timedOut)))
        XCTAssertFalse(ResilientDownload.isTransient(URLError(.cancelled)))
        XCTAssertFalse(ResilientDownload.isTransient(URLError(.badURL)))
        XCTAssertTrue(ResilientDownload.isTransient(ModelDownloadError(message: "HTTP 503", discardPartial: false, transient: true)))
        XCTAssertFalse(ResilientDownload.isTransient(ModelDownloadError(message: "disk full", discardPartial: false)))
    }

    func testCancellationStopsTheLoop() async {
        let rec = Recorder()
        let (r, _) = make(rec)
        let task = Task { try await r.run { throw URLError(.timedOut) } }
        try? await Task.sleep(nanoseconds: 20_000_000)
        task.cancel()
        do { _ = try await task.value; XCTFail() } catch { XCTAssertTrue(error is CancellationError || (error as? ModelDownloadError) != nil) }
    }
}
