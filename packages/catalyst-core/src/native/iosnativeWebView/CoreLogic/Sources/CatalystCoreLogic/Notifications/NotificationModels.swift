import Foundation
import UserNotifications

public struct NotificationConfig: Codable {
    public let title: String
    public let body: String
    public let channel: String
    public let badge: Int?
    public let largeImage: String?
    public let style: String
    public let priority: Int
    public let vibrate: Bool
    public let autoCancel: Bool
    public let data: [String: AnyCodable]?
    public let actions: [NotificationAction]?

    public init(
        title: String = "Notification",
        body: String = "You have a new message",
        channel: String = "default",
        badge: Int? = nil,
        largeImage: String? = nil,
        style: String = "BASIC",
        priority: Int = 0,
        vibrate: Bool = true,
        autoCancel: Bool = true,
        data: [String: Any]? = nil,
        actions: [NotificationAction]? = nil
    ) {
        self.title = title
        self.body = body
        self.channel = channel
        self.badge = badge
        self.largeImage = largeImage
        self.style = style
        self.priority = priority
        self.vibrate = vibrate
        self.autoCancel = autoCancel
        self.data = data?.mapValues { AnyCodable($0) }
        self.actions = actions
    }

    public static func fromJSON(_ jsonString: String) -> NotificationConfig? {
        guard let data = jsonString.data(using: .utf8) else { return nil }
        do {
            return try JSONDecoder().decode(NotificationConfig.self, from: data)
        } catch {
            return nil
        }
    }

    public func toJSON() -> String? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

public struct NotificationAction: Codable {
    public let title: String
    public let action: String

    public init(title: String, action: String) {
        self.title = title
        self.action = action
    }
}

public enum NotificationStyle: String, CaseIterable {
    case basic = "BASIC"
    case bigText = "BIG_TEXT"
    case bigImage = "BIG_IMAGE"
    case actionButtons = "ACTION_BUTTONS"
}

public enum NotificationChannel: String, CaseIterable {
    case `default` = "default"
    case urgent = "urgent"

    public var sound: UNNotificationSound {
        switch self {
        case .default:
            return getCustomSound("notification_sound_default.mp3") ?? .default
        case .urgent:
            return getCustomSound("notification_sound_urgent.mp3") ?? .defaultCritical
        }
    }

    private func getCustomSound(_ fileName: String) -> UNNotificationSound? {
        // Support all formats that build script processes: caf, mp3, m4a, wav
        let supportedFormats = ["caf", "mp3", "m4a", "wav"]

        // Extract base filename without extension
        var baseName = fileName
        for format in supportedFormats {
            baseName = baseName.replacingOccurrences(of: ".\(format)", with: "")
        }

        // Try each format until we find one
        for format in supportedFormats {
            if let soundPath = Bundle.main.path(forResource: baseName, ofType: format) {
                let soundURL = URL(fileURLWithPath: soundPath)
                return UNNotificationSound(named: UNNotificationSoundName(rawValue: soundURL.lastPathComponent))
            }
        }

        return nil
    }
}

public struct AnyCodable: Codable {
    public let value: Any

    public init(_ value: Any) { self.value = value }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dictionary = try? container.decode([String: AnyCodable].self) {
            value = dictionary.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported type")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        if let bool = value as? Bool {
            try container.encode(bool)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let string = value as? String {
            try container.encode(string)
        } else if let array = value as? [Any] {
            let codableArray = array.map { AnyCodable($0) }
            try container.encode(codableArray)
        } else if let dictionary = value as? [String: Any] {
            let codableDictionary = dictionary.mapValues { AnyCodable($0) }
            try container.encode(codableDictionary)
        } else {
            throw EncodingError.invalidValue(value, EncodingError.Context(codingPath: encoder.codingPath, debugDescription: "Unsupported type"))
        }
    }
}
