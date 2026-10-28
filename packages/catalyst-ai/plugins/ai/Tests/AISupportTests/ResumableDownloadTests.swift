import XCTest
@testable import AISupport

final class ResumeRulesTests: XCTestCase {
    func testPlan_NeedsDataAndAStrongETag() {
        XCTAssertEqual(ResumeRules.plan(partialSize: 100, storedETag: "\"abc\""), .init(offset: 100, etag: "\"abc\""))
        XCTAssertNil(ResumeRules.plan(partialSize: 0, storedETag: "\"abc\""))
        XCTAssertNil(ResumeRules.plan(partialSize: 100, storedETag: nil))
        XCTAssertNil(ResumeRules.plan(partialSize: 100, storedETag: ""))
        XCTAssertNil(ResumeRules.plan(partialSize: 100, storedETag: "W/\"weak\""), "If-Range ignores weak validators")
    }

    func testParseContentRange() {
        let r = ResumeRules.parseContentRange("bytes 100-499/500")
        XCTAssertEqual(r?.start, 100); XCTAssertEqual(r?.end, 499); XCTAssertEqual(r?.total, 500)
        let star = ResumeRules.parseContentRange("bytes */500")
        XCTAssertNil(star?.start); XCTAssertEqual(star?.total, 500)
        XCTAssertNil(ResumeRules.parseContentRange("bytes 5-1/10"))
        XCTAssertNil(ResumeRules.parseContentRange("items 0-1/2"))
        XCTAssertNil(ResumeRules.parseContentRange(nil))
        XCTAssertNil(ResumeRules.parseContentRange("bytes 1-2"))
    }

    func testInterpret() {
        // 206 continuing exactly where we asked
        XCTAssertEqual(ResumeRules.interpret(status: 206, offset: 100, contentRange: "bytes 100-499/500", contentLength: 400), .append(total: 500))
        // 206 from the wrong place, with no range, or when we asked for nothing
        XCTAssertEqual(ResumeRules.interpret(status: 206, offset: 100, contentRange: "bytes 0-499/500", contentLength: 500), .restart)
        XCTAssertEqual(ResumeRules.interpret(status: 206, offset: 100, contentRange: nil, contentLength: 400), .restart)
        XCTAssertEqual(ResumeRules.interpret(status: 206, offset: 0, contentRange: "bytes 0-9/10", contentLength: 10), .restart)
        // 200: the whole file, whether or not we asked for a range
        XCTAssertEqual(ResumeRules.interpret(status: 200, offset: 100, contentRange: nil, contentLength: 500), .truncate(total: 500))
        XCTAssertEqual(ResumeRules.interpret(status: 200, offset: 0, contentRange: nil, contentLength: nil), .truncate(total: -1))
        // 416
        XCTAssertEqual(ResumeRules.interpret(status: 416, offset: 500, contentRange: "bytes */500", contentLength: 0), .complete)
        XCTAssertEqual(ResumeRules.interpret(status: 416, offset: 900, contentRange: "bytes */500", contentLength: 0), .restart)
        XCTAssertEqual(ResumeRules.interpret(status: 416, offset: 500, contentRange: nil, contentLength: 0), .restart)
        // everything else is an error
        XCTAssertEqual(ResumeRules.interpret(status: 401, offset: 0, contentRange: nil, contentLength: nil), .fail(status: 401))
        XCTAssertEqual(ResumeRules.interpret(status: 503, offset: 0, contentRange: nil, contentLength: nil), .fail(status: 503))
    }
}

/// A scripted origin server behind URLProtocol: serves `body` with Range / If-Range semantics, and can drop the
/// connection after `dropAfter` bytes to simulate an interrupted download.
private final class FakeServer: URLProtocol {
    struct Config {
        var body = Data()
        var etag: String? = "\"v1\""
        var supportsRange = true
        var dropAfter: Int?
        var forceStatus: Int?
        var wrongContentRangeStart = false
        /// Content-Length to announce on a 200 when it differs from the bytes actually sent.
        var declaredLength: Int?
    }
    static var config = Config()
    static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let c = FakeServer.config
        FakeServer.requests.append(request)
        let url = request.url!
        func respond(_ status: Int, _ headers: [String: String], _ body: Data) {
            var h = headers
            if let etag = c.etag { h["ETag"] = etag }
            h["Content-Length"] = String(status == 200 ? (c.declaredLength ?? body.count) : body.count)
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: h)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            if let drop = c.dropAfter, drop < body.count {
                client?.urlProtocol(self, didLoad: body.prefix(drop))
                // A real connection drops some time after its last bytes arrive, not in the same instant.
                DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) {
                    self.client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
                }
                return
            }
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        }
        if let forced = c.forceStatus { return respond(forced, [:], Data()) }

        var start = 0
        if c.supportsRange, let range = request.value(forHTTPHeaderField: "Range"),
           range.hasPrefix("bytes="), let n = Int(range.dropFirst(6).dropLast()) {
            let ifRange = request.value(forHTTPHeaderField: "If-Range")
            if ifRange == nil || ifRange == c.etag { start = n }
        }
        if start >= c.body.count && start > 0 {
            return respond(416, ["Content-Range": "bytes */\(c.body.count)"], Data())
        }
        if start > 0 {
            let shown = c.wrongContentRangeStart ? 0 : start
            return respond(206, ["Content-Range": "bytes \(shown)-\(c.body.count - 1)/\(c.body.count)"], c.body.suffix(from: start))
        }
        respond(200, [:], c.body)
    }
}

final class ModelDownloaderTests: XCTestCase {
    private var dir: URL!
    private var partial: URL!
    private let url = URL(string: "https://models.example.com/m.litertlm")!

    override func setUp() {
        super.setUp()
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dl-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        partial = dir.appendingPathComponent("m.litertlm.tmp")
        FakeServer.config = .init(body: Data((0..<5000).map { UInt8($0 % 251) }))
        FakeServer.requests = []
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dir)
        super.tearDown()
    }

    private func makeDownloader(progress: @escaping (Int64, Int64) -> Void = { _, _ in }) -> ModelDownloader {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeServer.self]
        return ModelDownloader(partial: partial, configuration: configuration, onBytes: progress)
    }

    private var etagFile: URL { partial.appendingPathExtension("etag") }
    private func onDisk() -> Data { (try? Data(contentsOf: partial)) ?? Data() }
    private func header(_ i: Int, _ name: String) -> String? { FakeServer.requests[i].value(forHTTPHeaderField: name) }

    func testFreshDownload_WritesFileAndKeepsETag() async throws {
        let size = try await makeDownloader().download(from: url)
        XCTAssertEqual(size, 5000)
        XCTAssertEqual(onDisk(), FakeServer.config.body)
        XCTAssertEqual(try String(contentsOf: etagFile, encoding: .utf8), "\"v1\"")
        XCTAssertNil(header(0, "Range"))
    }

    func testInterruptedThenResumed_RequestsTheRestAndCompletes() async throws {
        FakeServer.config.dropAfter = 1800
        do { _ = try await makeDownloader().download(from: url); XCTFail("should have been interrupted") } catch {}
        XCTAssertEqual(onDisk().count, 1800, "the partial survives the failure")
        XCTAssertTrue(FileManager.default.fileExists(atPath: etagFile.path))

        FakeServer.config.dropAfter = nil
        FakeServer.requests = []
        var first: Int64?
        let size = try await makeDownloader { loaded, _ in if first == nil { first = loaded } }.download(from: url)
        XCTAssertEqual(size, 5000)
        XCTAssertEqual(onDisk(), FakeServer.config.body, "resumed bytes line up with the original")
        XCTAssertEqual(header(0, "Range"), "bytes=1800-")
        XCTAssertEqual(header(0, "If-Range"), "\"v1\"")
        XCTAssertGreaterThan(first ?? 0, 1800, "progress counts the bytes already on disk")
    }

    func testFileChangedUpstream_ReplacesThePartialInsteadOfSplicing() async throws {
        FakeServer.config.dropAfter = 1800
        _ = try? await makeDownloader().download(from: url)
        FakeServer.config.body = Data((0..<4000).map { UInt8(($0 &* 7) % 253) })
        FakeServer.config.etag = "\"v2\""
        FakeServer.config.dropAfter = nil
        let size = try await makeDownloader().download(from: url)
        XCTAssertEqual(size, 4000)
        XCTAssertEqual(onDisk(), FakeServer.config.body)
        XCTAssertEqual(try String(contentsOf: etagFile, encoding: .utf8), "\"v2\"")
    }

    func testServerIgnoresRange_RestartsInPlace() async throws {
        FakeServer.config.dropAfter = 1800
        _ = try? await makeDownloader().download(from: url)
        FakeServer.config.supportsRange = false
        FakeServer.config.dropAfter = nil
        let size = try await makeDownloader().download(from: url)
        XCTAssertEqual(size, 5000)
        XCTAssertEqual(onDisk(), FakeServer.config.body)
    }

    func testPartialAlreadyWholeFile_416IsTreatedAsDone() async throws {
        try FakeServer.config.body.write(to: partial)
        try "\"v1\"".write(to: etagFile, atomically: true, encoding: .utf8)
        let size = try await makeDownloader().download(from: url)
        XCTAssertEqual(size, 5000)
        XCTAssertEqual(FakeServer.requests.count, 1)
        XCTAssertEqual(onDisk(), FakeServer.config.body)
    }

    func testPartialLargerThanFile_416RestartsFromScratch() async throws {
        try Data(repeating: 9, count: 7000).write(to: partial)
        try "\"v1\"".write(to: etagFile, atomically: true, encoding: .utf8)
        let size = try await makeDownloader().download(from: url)
        XCTAssertEqual(size, 5000)
        XCTAssertEqual(onDisk(), FakeServer.config.body)
        XCTAssertEqual(FakeServer.requests.count, 2)
        XCTAssertNil(header(1, "Range"), "the retry asks for the whole file")
    }

    func testWrongContentRange_RestartsFromScratch() async throws {
        FakeServer.config.dropAfter = 1800
        _ = try? await makeDownloader().download(from: url)
        FakeServer.config.dropAfter = nil
        FakeServer.config.wrongContentRangeStart = true
        FakeServer.requests = []
        let size = try await makeDownloader().download(from: url)
        XCTAssertEqual(size, 5000)
        XCTAssertEqual(onDisk(), FakeServer.config.body)
        XCTAssertNil(header(1, "Range"))
    }

    func testNoStrongETag_NeverResumes() async throws {
        FakeServer.config.etag = nil
        FakeServer.config.dropAfter = 1800
        _ = try? await makeDownloader().download(from: url)
        XCTAssertFalse(FileManager.default.fileExists(atPath: etagFile.path))
        FakeServer.config.dropAfter = nil
        FakeServer.requests = []
        let size = try await makeDownloader().download(from: url)
        XCTAssertEqual(size, 5000)
        XCTAssertNil(header(0, "Range"), "without a validator the partial cannot be trusted")
    }

    func testClientErrorDiscardsPartial_ServerErrorKeepsIt() async throws {
        try Data(repeating: 1, count: 100).write(to: partial)
        try "\"v1\"".write(to: etagFile, atomically: true, encoding: .utf8)
        FakeServer.config.forceStatus = 503
        let down = makeDownloader()
        do { _ = try await down.download(from: url); XCTFail() } catch let error as ModelDownloadError {
            XCTAssertFalse(error.discardPartial)
        }
        XCTAssertEqual(onDisk().count, 100, "a 5xx is transient; keep the partial")

        FakeServer.config.forceStatus = 401
        do { _ = try await down.download(from: url); XCTFail() } catch let error as ModelDownloadError {
            XCTAssertTrue(error.discardPartial)
            XCTAssertTrue(error.localizedDescription.contains("401"))
        }
    }

    func testBodyShorterThanAnnounced_IsRejectedAndTheBytesKept() async throws {
        FakeServer.config.declaredLength = 5000
        FakeServer.config.body = FakeServer.config.body.prefix(3000)
        do {
            _ = try await makeDownloader().download(from: url)
            XCTFail("a short file must never be accepted as the model")
        } catch {
            if let error = error as? ModelDownloadError { XCTAssertFalse(error.discardPartial) }
        }
        XCTAssertEqual(onDisk().count, 3000, "what arrived is kept so the next attempt can continue")
    }
}
