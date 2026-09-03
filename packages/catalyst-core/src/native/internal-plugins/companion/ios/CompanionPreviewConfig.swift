import Foundation

struct CompanionPreviewConfig {
    let values: [String: Any]

    static func normalizedPreviewURL(_ url: URL) -> URL? {
        guard url.user == nil, url.password == nil,
              let scheme = url.scheme?.lowercased(),
              let host = url.host, !host.isEmpty,
              scheme == "https" || scheme == "http" && isPrivateHost(host) else {
            return nil
        }
        guard url.path.isEmpty else { return url }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = "/"
        return components?.url
    }

    static func origin(for url: URL) -> URL? {
        var components = URLComponents()
        components.scheme = url.scheme
        components.host = url.host
        components.port = url.port
        return components.url
    }

    static func fetch(from origin: URL, completion: @escaping (CompanionPreviewConfig?) -> Void) {
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        components?.path = "/__catalyst/preview-config"
        guard let url = components?.url else {
            completion(nil)
            return
        }
        CompanionConfigRequest(url: url, completion: completion).start()
    }

    fileprivate static func parse(_ data: Data) -> CompanionPreviewConfig? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let schema = root["schema"] as? NSNumber,
              CFGetTypeID(schema) != CFBooleanGetTypeID(),
              schema.doubleValue == 1,
              let config = root["config"] as? [String: Any] else {
            return nil
        }

        return CompanionPreviewConfig(values: config)
    }

    private static func isPrivateHost(_ rawHost: String) -> Bool {
        var host = rawHost.lowercased()
        if host.hasSuffix(".") {
            host.removeLast()
        }
        if host == "localhost" || host.hasSuffix(".local") {
            return true
        }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let octets = parts.compactMap { part -> Int? in
            guard !part.isEmpty, part.count <= 3,
                  part.allSatisfy(\.isNumber),
                  let value = Int(part), value <= 255 else {
                return nil
            }
            return value
        }
        guard octets.count == 4 else { return false }
        return octets[0] == 10 ||
            octets[0] == 127 ||
            octets[0] == 169 && octets[1] == 254 ||
            octets[0] == 172 && (16...31).contains(octets[1]) ||
            octets[0] == 192 && octets[1] == 168
    }
}

private final class CompanionConfigRequest: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private static let maxBytes = 64 * 1024

    private let url: URL
    private var completion: ((CompanionPreviewConfig?) -> Void)?
    private var data = Data()
    private var session: URLSession?

    init(url: URL, completion: @escaping (CompanionPreviewConfig?) -> Void) {
        self.url = url
        self.completion = completion
    }

    func start() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3
        configuration.timeoutIntervalForResource = 3
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        session.dataTask(with: request).resume()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let response = response as? HTTPURLResponse,
              response.statusCode == 200,
              response.expectedContentLength <= Int64(Self.maxBytes) else {
            completionHandler(.cancel)
            finish(nil)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        guard data.count + chunk.count <= Self.maxBytes else {
            dataTask.cancel()
            finish(nil)
            return
        }
        data.append(chunk)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(error == nil ? CompanionPreviewConfig.parse(data) : nil)
    }

    private func finish(_ config: CompanionPreviewConfig?) {
        guard let completion else { return }
        self.completion = nil
        session?.finishTasksAndInvalidate()
        completion(config)
    }
}
