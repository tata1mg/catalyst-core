//
//  AIInputParts.swift
//  catalyst-ai (iOS)
//
//  Pure parsing of genConfig["inputParts"] (media produced by catalyst-ai's buildNativeBody):
//  [{ "type": "image" | "audio", "mimeType": "image/png", "base64": "..." }]
//  Kept free of LiteRT so `swift test` can cover it. Kotlin equivalent: NativeBridgeAI.buildContents.
//

import Foundation

struct AIInputPart: Equatable {
    enum Kind: String { case image, audio }

    let kind: Kind
    let fileExtension: String
    let data: Data
}

enum AIInputPartsError: Error, Equatable, LocalizedError {
    case unsupportedType(String)
    case invalidBase64(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedType(let type): return "Unsupported input part type: \(type)"
        case .invalidBase64(let type): return "The \(type) input is not valid base64"
        }
    }
}

enum AIInputParts {
    /// Media parts in request order. Absent or empty `inputParts` -> [] (a plain text turn).
    static func parse(_ genConfig: [String: Any]) throws -> [AIInputPart] {
        guard let raw = genConfig["inputParts"] as? [[String: Any]] else { return [] }
        return try raw.map { part in
            let type = part["type"] as? String ?? ""
            guard let kind = AIInputPart.Kind(rawValue: type) else { throw AIInputPartsError.unsupportedType(type) }
            guard let base64 = part["base64"] as? String, let data = Data(base64Encoded: base64) else {
                throw AIInputPartsError.invalidBase64(type)
            }
            let mime = part["mimeType"] as? String ?? ""
            let subtype = mime.split(separator: "/").dropFirst().first.map(String.init) ?? "bin"
            let ext = subtype.split(separator: "+").first.map(String.init) ?? "bin"
            return AIInputPart(kind: kind, fileExtension: ext.isEmpty ? "bin" : ext, data: data)
        }
    }
}
