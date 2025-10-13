//
//  BridgeMessageValidator.swift
//  iosnativeWebView
//
//  Bridge message validation using JSONSchema library
//  Extracted from NativeBridge.swift for better separation of concerns
//

import Foundation
import WebKit
import JSONSchema
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: CatalystConstants.Logging.Categories.messageValidator)

// MARK: - Validation Result

struct BridgeValidationResult {
    let isValid: Bool
    let command: String?
    let params: Any?
    let body: [String: Any]?
    let error: BridgeValidationError?
}

struct BridgeValidationError {
    let message: String
    let code: String
    let eventName: String
}

// MARK: - Bridge Message Validator

class BridgeMessageValidator {

    // MARK: - Schema Definitions

    private static var schemas: [String: [String: Any]] = [
        "openCamera": [
            "type": "object",
            "properties": [
                "quality": [
                    "type": "string",
                    "enum": ["high", "medium", "low"]
                ],
                "allowsEditing": ["type": "boolean"],
                "preferredCameraType": [
                    "type": "string",
                    "enum": ["front", "back"]
                ],
                "flashMode": [
                    "type": "string",
                    "enum": ["auto", "on", "off"]
                ],
                "videoMaximumDuration": [
                    "type": "number",
                    "minimum": 0,
                    "maximum": 3600
                ]
            ],
            "additionalProperties": false
        ],
        "requestCameraPermission": [
            "type": "object",
            "properties": [
                "showRationale": ["type": "boolean"],
                "fallbackToSettings": ["type": "boolean"],
                "includeDetails": ["type": "boolean"]
            ],
            "additionalProperties": false
        ],
        "pickFile": [
            "type": "object",
            "properties": [
                "mimeType": ["type": "string"],
                "multiple": ["type": "boolean"],
                "maxFileSize": [
                    "type": "number",
                    "minimum": 0
                ]
            ],
            "additionalProperties": false
        ],
        "requestHapticFeedback": [
            "type": "object",
            "properties": [
                "type": [
                    "type": "string",
                    "enum": ["light", "medium", "heavy", "selection", "impact", "notification", "VIRTUAL_KEY", "LONG_PRESS", "DEFAULT"]
                ],
                "intensity": [
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1
                ]
            ],
            "required": ["type"],
            "additionalProperties": false
        ],
        "openFileWithIntent": [
            "type": "object",
            "properties": [
                "url": ["type": "string"],
                "filename": ["type": "string"],
                "mimeType": ["type": "string"],
                "data": ["type": "string"]
            ],
            "additionalProperties": false
        ],
        "getDeviceInfo": [
            "type": "object",
            "properties": [:],
            "additionalProperties": false
        ],
        "logger": [
            "type": "object",
            "properties": [:],
            "additionalProperties": false
        ],
        // Notification commands
        "requestNotificationPermission": [
            "type": "object",
            "properties": [:],
            "additionalProperties": false
        ],
        "scheduleLocalNotification": [
            "type": "object",
            "properties": [
                "title": ["type": "string"],
                "body": ["type": "string"],
                "badge": ["type": "number"],
                "sound": ["type": "string"],
                "data": ["type": "object"],
                "triggerTime": ["type": "number"],
                "notificationId": ["type": "string"]
            ],
            "additionalProperties": false
        ],
        "cancelLocalNotification": [
            "type": "object",
            "properties": [
                "notificationId": ["type": "string"]
            ],
            "required": ["notificationId"],
            "additionalProperties": false
        ],
        "registerForPushNotifications": [
            "type": "object",
            "properties": [:],
            "additionalProperties": false
        ],
        "subscribeToTopic": [
            "type": "object",
            "properties": [
                "topic": ["type": "string"]
            ],
            "required": ["topic"],
            "additionalProperties": false
        ],
        "unsubscribeFromTopic": [
            "type": "object",
            "properties": [
                "topic": ["type": "string"]
            ],
            "required": ["topic"],
            "additionalProperties": false
        ],
        "getSubscribedTopics": [
            "type": "object",
            "properties": [:],
            "additionalProperties": false
        ]
    ]


    // MARK: - Public Validation Interface

    static func validate(message: WKScriptMessage) -> BridgeValidationResult {
        logger.debug("Starting validation for bridge message")

        // Step 1: Validate message handler name
        guard message.name == "NativeBridge" else {
            logger.error("Invalid message handler name: \(message.name)")
            return BridgeValidationResult(
                isValid: false,
                command: nil,
                params: nil,
                body: nil,
                error: BridgeValidationError(
                    message: "Invalid message handler",
                    code: "INVALID_HANDLER",
                    eventName: "BRIDGE_ERROR"
                )
            )
        }

        // Step 2: Validate message size
        if let messageData = try? JSONSerialization.data(withJSONObject: message.body, options: []),
           messageData.count > CatalystConstants.Bridge.maxMessageSize {
            logger.error("Message size exceeds limit: \(messageData.count) > \(CatalystConstants.Bridge.maxMessageSize)")
            return BridgeValidationResult(
                isValid: false,
                command: nil,
                params: nil,
                body: nil,
                error: BridgeValidationError(
                    message: "Message too large",
                    code: "MESSAGE_TOO_LARGE",
                    eventName: "BRIDGE_ERROR"
                )
            )
        }

        // Step 3: Validate message body structure
        guard let body = message.body as? [String: Any] else {
            logger.error("Invalid message format - body is not a dictionary")
            return BridgeValidationResult(
                isValid: false,
                command: nil,
                params: nil,
                body: nil,
                error: BridgeValidationError(
                    message: "Invalid message format",
                    code: "INVALID_FORMAT",
                    eventName: "BRIDGE_ERROR"
                )
            )
        }

        // Step 4: Validate root message structure
        guard let rootValidationResult = validateRootMessageStructure(body) else {
            return BridgeValidationResult(
                isValid: false,
                command: nil,
                params: nil,
                body: body,
                error: BridgeValidationError(
                    message: "Invalid root message structure",
                    code: "INVALID_ROOT_STRUCTURE",
                    eventName: "BRIDGE_ERROR"
                )
            )
        }

        let command = rootValidationResult.command
        let params = rootValidationResult.params

        // Step 5: Validate command is supported
        guard CatalystConstants.Bridge.validCommands.contains(command) else {
            logger.error("Unsupported command: \(command)")
            print("❌ DEBUG [BridgeMessageValidator]: Command '\(command)' is NOT in valid commands")
            print("❌ DEBUG [BridgeMessageValidator]: Available commands: \(CatalystConstants.Bridge.validCommands.sorted().joined(separator: ", "))")
            return BridgeValidationResult(
                isValid: false,
                command: command,
                params: params,
                body: body,
                error: BridgeValidationError(
                    message: "Unsupported command: \(command)",
                    code: "UNSUPPORTED_COMMAND",
                    eventName: "BRIDGE_ERROR"
                )
            )
        }

        // Step 6: Validate command-specific parameters using JSONSchema
        if let params = params {
            if let validationError = validateCommandParameters(command: command, params: params) {
                return BridgeValidationResult(
                    isValid: false,
                    command: command,
                    params: params,
                    body: body,
                    error: validationError
                )
            }
        }

        logger.debug("Message validation successful for command: \(command)")
        return BridgeValidationResult(
            isValid: true,
            command: command,
            params: params,
            body: body,
            error: nil
        )
    }

    // MARK: - Private Validation Helpers

    private static func validateRootMessageStructure(_ body: [String: Any]) -> (command: String, params: Any?)? {
        // Validate required command field
        guard let command = body["command"] as? String, !command.isEmpty else {
            logger.error("Root message missing 'command' field")
            return nil
        }

        // Optional: Validate timestamp if present
        if let timestamp = body["timestamp"] as? String {
            let formatter = ISO8601DateFormatter()
            if formatter.date(from: timestamp) == nil {
                logger.warning("Invalid timestamp format in message: \(timestamp)")
            }
        }

        // Optional: Validate requestId if present (for tracking)
        if let requestId = body["requestId"] as? String, requestId.isEmpty {
            logger.warning("Empty requestId in message")
        }

        let params = body["data"]
        return (command: command, params: params)
    }

    private static func validateCommandParameters(command: String, params: Any) -> BridgeValidationError? {
        // Commands that support flexible parameter formats (string or object)
        let flexibleCommands = [
            "openCamera",
            "requestCameraPermission",
            "pickFile",
            "requestHapticFeedback",
            "openFileWithIntent",
            "requestNotificationPermission",
            "registerForPushNotifications",
            "getSubscribedTopics",
            "getDeviceInfo",
            "logger",
            // Notification commands accept JSON strings for parity with Android bridge
            "scheduleLocalNotification",
            "cancelLocalNotification",
            "subscribeToTopic",
            "unsubscribeFromTopic"
        ]

        if flexibleCommands.contains(command) {
            // For these commands, allow string, object, or nil parameters
            if params is String || params == nil {
                logger.debug("Command '\(command)' received string/nil parameters - allowing for legacy compatibility")
                return nil
            }

            // If it's an object, validate against schema if available
            if let paramsDict = params as? [String: Any] {
                guard schemas[command] != nil else {
                    logger.debug("No schema defined for command: \(command), allowing object parameters")
                    return nil
                }

                return validateObjectAgainstJSONSchema(paramsDict, schema: nil, commandName: command)
            }

            logger.warning("Command '\(command)' received unexpected parameter type: \(type(of: params))")
            return nil // Allow for backward compatibility
        }

        // For strict commands, require object parameters and validate against schema
        guard schemas[command] != nil else {
            logger.debug("No schema defined for command: \(command), allowing all parameters")
            return nil
        }

        guard let paramsDict = params as? [String: Any] else {
            logger.error("Parameters for command '\(command)' must be an object")
            return BridgeValidationError(
                message: "Invalid parameters format for \(command)",
                code: "INVALID_PARAMS",
                eventName: "BRIDGE_ERROR"
            )
        }

        return validateObjectAgainstJSONSchema(paramsDict, schema: nil, commandName: command)
    }

    private static func validateObjectAgainstJSONSchema(_ object: [String: Any], schema: Any?, commandName: String) -> BridgeValidationError? {
        // Get the schema dictionary for the command
        guard let schemaDict = schemas[commandName] else {
            logger.warning("No schema dictionary found for command: \(commandName)")
            return nil
        }

        do {
            // Use JSONSchema.validate with the schema dictionary and object
            let result = try JSONSchema.validate(object, schema: schemaDict)

            if result.valid {
                logger.debug("Parameter validation successful for command: \(commandName)")
                return nil
            } else {
                let errorMessages = result.errors?.map { $0.description }.joined(separator: "; ") ?? "Unknown validation error"
                logger.error("Parameter validation failed for command '\(commandName)': \(errorMessages)")
                return BridgeValidationError(
                    message: "Invalid parameters for \(commandName): \(errorMessages)",
                    code: "INVALID_PARAMS",
                    eventName: "BRIDGE_ERROR"
                )
            }
        } catch {
            logger.error("Failed to validate parameters: \(error.localizedDescription)")
            return BridgeValidationError(
                message: "Parameter validation failed for \(commandName)",
                code: "PARAM_VALIDATION_ERROR",
                eventName: "BRIDGE_ERROR"
            )
        }
    }

    private static func validateObjectAgainstSchema(_ object: [String: Any], schema: [String: Any], commandName: String) -> BridgeValidationError? {
        // Validate object type
        if let schemaType = schema["type"] as? String, schemaType != "object" {
            logger.warning("Schema for \(commandName) is not of type 'object'")
        }

        let allowAdditionalProperties = schema["additionalProperties"] as? Bool ?? true
        let schemaProperties = schema["properties"] as? [String: [String: Any]] ?? [:]
        let requiredFields = schema["required"] as? [String] ?? []

        // Validate required fields
        for requiredField in requiredFields {
            if object[requiredField] == nil {
                logger.error("Required field '\(requiredField)' missing for command \(commandName)")
                return BridgeValidationError(
                    message: "Missing required field: \(requiredField)",
                    code: "MISSING_REQUIRED_FIELD",
                    eventName: "BRIDGE_ERROR"
                )
            }
        }

        // Validate each property
        for (key, value) in object {
            if let propertySchema = schemaProperties[key] {
                if let error = validatePropertyAgainstSchema(value, schema: propertySchema, propertyName: key, commandName: commandName) {
                    return error
                }
            } else if !allowAdditionalProperties {
                logger.error("Additional property '\(key)' not allowed for command \(commandName)")
                return BridgeValidationError(
                    message: "Additional property '\(key)' not allowed",
                    code: "ADDITIONAL_PROPERTY_NOT_ALLOWED",
                    eventName: "BRIDGE_ERROR"
                )
            }
        }

        return nil
    }

    private static func validatePropertyAgainstSchema(_ value: Any, schema: [String: Any], propertyName: String, commandName: String) -> BridgeValidationError? {
        guard let expectedType = schema["type"] as? String else {
            logger.error("No type specified in schema for property \(propertyName)")
            return nil
        }

        switch expectedType {
        case "string":
            guard value is String else {
                logger.error("Property '\(propertyName)' must be a string for command \(commandName)")
                return BridgeValidationError(
                    message: "Property '\(propertyName)' must be a string",
                    code: "INVALID_TYPE",
                    eventName: "BRIDGE_ERROR"
                )
            }
            if let enumValues = schema["enum"] as? [String], let stringValue = value as? String {
                if !enumValues.contains(stringValue) {
                    logger.error("Property '\(propertyName)' value '\(stringValue)' not in allowed enum values")
                    return BridgeValidationError(
                        message: "Invalid value for \(propertyName): \(stringValue)",
                        code: "INVALID_ENUM_VALUE",
                        eventName: "BRIDGE_ERROR"
                    )
                }
            }

        case "number":
            guard let numberValue = value as? NSNumber else {
                logger.error("Property '\(propertyName)' must be a number for command \(commandName)")
                return BridgeValidationError(
                    message: "Property '\(propertyName)' must be a number",
                    code: "INVALID_TYPE",
                    eventName: "BRIDGE_ERROR"
                )
            }
            if let minimum = schema["minimum"] as? NSNumber, numberValue.doubleValue < minimum.doubleValue {
                logger.error("Property '\(propertyName)' value \(numberValue) is below minimum \(minimum)")
                return BridgeValidationError(
                    message: "Value for \(propertyName) below minimum",
                    code: "VALUE_BELOW_MINIMUM",
                    eventName: "BRIDGE_ERROR"
                )
            }
            if let maximum = schema["maximum"] as? NSNumber, numberValue.doubleValue > maximum.doubleValue {
                logger.error("Property '\(propertyName)' value \(numberValue) is above maximum \(maximum)")
                return BridgeValidationError(
                    message: "Value for \(propertyName) above maximum",
                    code: "VALUE_ABOVE_MAXIMUM",
                    eventName: "BRIDGE_ERROR"
                )
            }

        case "boolean":
            guard value is Bool else {
                logger.error("Property '\(propertyName)' must be a boolean for command \(commandName)")
                return BridgeValidationError(
                    message: "Property '\(propertyName)' must be a boolean",
                    code: "INVALID_TYPE",
                    eventName: "BRIDGE_ERROR"
                )
            }

        default:
            logger.warning("Unknown schema type '\(expectedType)' for property \(propertyName)")
        }

        return nil
    }

    // MARK: - Schema Management

    static func addCustomSchema(for command: String, schema: [String: Any]) {
        // Add schema dictionary directly to schemas
        schemas[command] = schema
        logger.info("Added custom schema for command: \(command)")
    }

    static func getAvailableCommands() -> Set<String> {
        return Set(schemas.keys)
    }

    static func hasSchema(for command: String) -> Bool {
        return schemas[command] != nil
    }
}

