import Foundation
import UserNotifications

struct NotificationConfig: Codable {
    let title: String
    let body: String
    let channel: String
    let badge: Int?
    let largeImage: String?
    let style: String
    let priority: Int
    let vibrate: Bool
    let autoCancel: Bool
    let data: [String: AnyCodable]?
    let actions: [NotificationAction]?

    init(title: String = "Notification",
         body: String = "You have a new message",
         channel: String = "default",
         badge: Int? = nil,
         largeImage: String? = nil,
         style: String = "BASIC",
         priority: Int = 0,
         vibrate: Bool = true,
         autoCancel: Bool = true,
         data: [String: Any]? = nil,
         actions: [NotificationAction]? = nil) {
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
}

struct NotificationAction: Codable {
    let title: String
    let action: String
}

enum NotificationStyle: String, CaseIterable {
    case basic = "BASIC"
    case bigText = "BIG_TEXT"
    case bigImage = "BIG_IMAGE"
    case actionButtons = "ACTION_BUTTONS"
}

enum NotificationChannel: String, CaseIterable {
    case `default` = "default"
    case urgent = "urgent"

    var displayName: String {
        switch self {
        case .default:
            return "Default"
        case .urgent:
            return "Urgent"
        }
    }

    var description: String {
        switch self {
        case .default:
            return "Default notifications"
        case .urgent:
            return "High priority notifications"
        }
    }

    var sound: UNNotificationSound {
        switch self {
        case .default:
            return getCustomSound("notification_sound_default.mp3") ?? .default
        case .urgent:
            return getCustomSound("notification_sound_urgent.mp3") ?? .defaultCritical
        }
    }

    private func getCustomSound(_ fileName: String) -> UNNotificationSound? {
        guard let soundPath = Bundle.main.path(forResource: fileName.replacingOccurrences(of: ".mp3", with: ""), ofType: "mp3") else {
            return nil
        }
        let soundURL = URL(fileURLWithPath: soundPath)
        return UNNotificationSound(named: UNNotificationSoundName(rawValue: soundURL.lastPathComponent))
    }
}

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
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

    func encode(to encoder: Encoder) throws {
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

extension NotificationConfig {
    static func fromJSON(_ jsonString: String) -> NotificationConfig? {
        guard let data = jsonString.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(NotificationConfig.self, from: data)
    }

    func toJSON() -> String? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

