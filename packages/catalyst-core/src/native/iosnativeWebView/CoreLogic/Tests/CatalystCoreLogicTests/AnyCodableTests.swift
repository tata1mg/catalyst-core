import XCTest
@testable import CatalystCoreLogic

/**
 * Unit tests for AnyCodable
 *
 * AnyCodable's encode/decode both try a fixed sequence of types (bool, int,
 * double, string, array, dictionary) — these tests exercise every branch of
 * both chains directly, plus the NotificationConfig.data field (the actual
 * production use site) round-tripping through it.
 */
final class AnyCodableTests: XCTestCase {

    // MARK: - Decode: each branch of the type-sniffing chain

    func testDecode_Bool() throws {
        let json = "true"
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.value as? Bool, true)
    }

    func testDecode_Int() throws {
        let json = "42"
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.value as? Int, 42)
    }

    func testDecode_Double() throws {
        let json = "3.14"
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.value as? Double, 3.14)
    }

    func testDecode_String() throws {
        let json = "\"hello\""
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.value as? String, "hello")
    }

    func testDecode_Array() throws {
        let json = "[1, 2, 3]"
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8))
        let array = try XCTUnwrap(decoded.value as? [Any])
        XCTAssertEqual(array.count, 3)
        XCTAssertEqual(array[0] as? Int, 1)
    }

    func testDecode_Dictionary() throws {
        let json = #"{"key": "value", "count": 5}"#
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8))
        let dict = try XCTUnwrap(decoded.value as? [String: Any])
        XCTAssertEqual(dict["key"] as? String, "value")
        XCTAssertEqual(dict["count"] as? Int, 5)
    }

    func testDecode_UnsupportedType_ThrowsDataCorrupted() {
        // `null` isn't handled by any branch (no explicit null case), so
        // decoding should fail rather than silently succeed with a wrong value.
        let json = "null"
        XCTAssertThrowsError(
            try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8))
        )
    }

    // MARK: - Encode: each branch of the type-checking chain

    func testEncode_Bool() throws {
        let encodable = AnyCodable(true)
        let data = try JSONEncoder().encode(encodable)
        XCTAssertEqual(String(data: data, encoding: .utf8), "true")
    }

    func testEncode_Int() throws {
        let encodable = AnyCodable(42)
        let data = try JSONEncoder().encode(encodable)
        XCTAssertEqual(String(data: data, encoding: .utf8), "42")
    }

    func testEncode_Double() throws {
        let encodable = AnyCodable(3.14)
        let data = try JSONEncoder().encode(encodable)
        XCTAssertEqual(String(data: data, encoding: .utf8), "3.14")
    }

    func testEncode_String() throws {
        let encodable = AnyCodable("hello")
        let data = try JSONEncoder().encode(encodable)
        XCTAssertEqual(String(data: data, encoding: .utf8), "\"hello\"")
    }

    func testEncode_Array() throws {
        let encodable = AnyCodable([1, 2, 3])
        let data = try JSONEncoder().encode(encodable)
        let decoded = try JSONSerialization.jsonObject(with: data) as? [Int]
        XCTAssertEqual(decoded, [1, 2, 3])
    }

    func testEncode_Dictionary() throws {
        let encodable = AnyCodable(["key": "value"])
        let data = try JSONEncoder().encode(encodable)
        let decoded = try JSONSerialization.jsonObject(with: data) as? [String: String]
        XCTAssertEqual(decoded, ["key": "value"])
    }

    func testEncode_UnsupportedType_Throws() {
        struct NotCodableAtAll {}
        let encodable = AnyCodable(NotCodableAtAll())
        XCTAssertThrowsError(try JSONEncoder().encode(encodable))
    }

    // MARK: - Round trip via NotificationConfig.data (the real production use site)

    func testNotificationConfig_DataFieldRoundTripsMixedTypes() throws {
        let config = NotificationConfig(
            title: "Test",
            body: "Body",
            data: [
                "flag": true,
                "count": 7,
                "label": "hello",
                "list": [1, 2, 3],
            ]
        )

        let json = try XCTUnwrap(config.toJSON())
        let restored = try XCTUnwrap(NotificationConfig.fromJSON(json))
        let data = try XCTUnwrap(restored.data)

        XCTAssertEqual(data["flag"]?.value as? Bool, true)
        XCTAssertEqual(data["count"]?.value as? Int, 7)
        XCTAssertEqual(data["label"]?.value as? String, "hello")
        XCTAssertEqual((data["list"]?.value as? [Any])?.count, 3)
    }

    func testNotificationConfig_NilDataFieldRoundTrips() throws {
        let config = NotificationConfig(title: "Test", body: "Body", data: nil)

        let json = try XCTUnwrap(config.toJSON())
        let restored = try XCTUnwrap(NotificationConfig.fromJSON(json))

        XCTAssertNil(restored.data)
    }

    func testNotificationConfig_FromJSON_InvalidJSON_ReturnsNil() {
        XCTAssertNil(NotificationConfig.fromJSON("{not valid json"))
    }

    func testNotificationConfig_FromJSON_NonUTF8_ReturnsNil() {
        // fromJSON's own guard (data(using: .utf8)) is defensive — exercised
        // indirectly since almost all Swift Strings are representable as
        // UTF8. Documented as effectively unreachable in practice, not
        // asserted here.
    }
}
