package io.yourname.androidproject

import android.util.Log
import io.yourname.androidproject.utils.BridgeUtils
import org.json.JSONObject
import org.json.JSONException

/**
 * Bridge message validation using custom schema validation
 * Mirrors iOS BridgeMessageValidator.swift for cross-platform consistency
 * Zero external dependencies for minimal APK impact
 */

// MARK: - Validation Result Data Classes

/**
 * Result of bridge message validation
 */
data class BridgeValidationResult(
    val isValid: Boolean,
    val command: String?,
    val params: Any?,
    val body: JSONObject?,
    val error: BridgeValidationError?
)

/**
 * Validation error details
 */
data class BridgeValidationError(
    val message: String,
    val code: String,
    val eventName: String
)

// MARK: - Schema Definition Classes

/**
 * Property schema definition
 */
data class PropertySchema(
    val type: String,
    val enum: List<String>? = null,
    val minimum: Number? = null,
    val maximum: Number? = null
)

/**
 * Object schema definition
 */
data class SchemaDefinition(
    val type: String = "object",
    val properties: Map<String, PropertySchema>,
    val required: List<String> = emptyList(),
    val additionalProperties: Boolean = true
)

// MARK: - Bridge Message Validator

object BridgeMessageValidator {

    private const val TAG = "BridgeMessageValidator"
    private const val MAX_MESSAGE_SIZE = 10 * 1024 * 1024 // 10MB (match iOS)

    // Valid commands (should match iOS CatalystConstants.Bridge.validCommands)
    private val validCommands = setOf(
        "openCamera",
        "requestCameraPermission",
        "pickFile",
        "requestHapticFeedback",
        "openFileWithIntent",
        "getDeviceInfo",
        "logger"
    )

    // MARK: - Schema Definitions (mirror iOS schemas)

    private val schemas = mapOf(
        "openCamera" to SchemaDefinition(
            properties = mapOf(
                "quality" to PropertySchema(
                    type = "string",
                    enum = listOf("high", "medium", "low")
                ),
                "allowsEditing" to PropertySchema(type = "boolean"),
                "preferredCameraType" to PropertySchema(
                    type = "string",
                    enum = listOf("front", "back")
                ),
                "flashMode" to PropertySchema(
                    type = "string",
                    enum = listOf("auto", "on", "off")
                ),
                "videoMaximumDuration" to PropertySchema(
                    type = "number",
                    minimum = 0,
                    maximum = 3600
                )
            ),
            additionalProperties = false
        ),

        "requestCameraPermission" to SchemaDefinition(
            properties = mapOf(
                "showRationale" to PropertySchema(type = "boolean"),
                "fallbackToSettings" to PropertySchema(type = "boolean"),
                "includeDetails" to PropertySchema(type = "boolean")
            ),
            additionalProperties = false
        ),

        "pickFile" to SchemaDefinition(
            properties = mapOf(
                "mimeType" to PropertySchema(type = "string"),
                "multiple" to PropertySchema(type = "boolean"),
                "minFileSize" to PropertySchema(
                    type = "number",
                    minimum = 0
                ),
                "maxFileSize" to PropertySchema(
                    type = "number",
                    minimum = 0
                ),
                "minFiles" to PropertySchema(
                    type = "number",
                    minimum = 1
                ),
                "maxFiles" to PropertySchema(
                    type = "number",
                    minimum = 1
                )
            ),
            additionalProperties = false
        ),

        "requestHapticFeedback" to SchemaDefinition(
            properties = mapOf(
                "type" to PropertySchema(
                    type = "string",
                    enum = listOf(
                        "light", "medium", "heavy", "selection",
                        "impact", "notification", "VIRTUAL_KEY",
                        "LONG_PRESS", "DEFAULT"
                    )
                ),
                "intensity" to PropertySchema(
                    type = "number",
                    minimum = 0,
                    maximum = 1
                )
            ),
            required = listOf("type"),
            additionalProperties = false
        ),

        "openFileWithIntent" to SchemaDefinition(
            properties = mapOf(
                "url" to PropertySchema(type = "string"),
                "filename" to PropertySchema(type = "string"),
                "mimeType" to PropertySchema(type = "string"),
                "data" to PropertySchema(type = "string")
            ),
            additionalProperties = false
        ),

        "getDeviceInfo" to SchemaDefinition(
            properties = emptyMap(),
            additionalProperties = false
        ),

        "logger" to SchemaDefinition(
            properties = emptyMap(),
            additionalProperties = false
        )
    )

    // Commands that support flexible parameter formats (string or object)
    // Mirror iOS flexible commands for backward compatibility
    private val flexibleCommands = setOf(
        "openCamera",
        "requestCameraPermission",
        "pickFile",
        "requestHapticFeedback",
        "openFileWithIntent"
    )

    // MARK: - Public Validation Interface

    /**
     * Validate a bridge message
     * @param body The message body as JSONObject
     * @return BridgeValidationResult with validation status and error details
     */
    fun validate(body: JSONObject): BridgeValidationResult {
        BridgeUtils.logDebug(TAG, "Starting validation for bridge message")

        // Step 1: Validate message size
        try {
            val messageSize = body.toString().toByteArray(Charsets.UTF_8).size
            if (messageSize > MAX_MESSAGE_SIZE) {
                BridgeUtils.logError(TAG, "Message size exceeds limit: $messageSize > $MAX_MESSAGE_SIZE")
                return BridgeValidationResult(
                    isValid = false,
                    command = null,
                    params = null,
                    body = body,
                    error = BridgeValidationError(
                        message = "Message too large",
                        code = "MESSAGE_TOO_LARGE",
                        eventName = "BRIDGE_ERROR"
                    )
                )
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error checking message size", e)
        }

        // Step 2: Validate root message structure
        val rootValidationResult = validateRootMessageStructure(body)
        if (rootValidationResult == null) {
            return BridgeValidationResult(
                isValid = false,
                command = null,
                params = null,
                body = body,
                error = BridgeValidationError(
                    message = "Invalid root message structure",
                    code = "INVALID_ROOT_STRUCTURE",
                    eventName = "BRIDGE_ERROR"
                )
            )
        }

        val command = rootValidationResult.first
        val params = rootValidationResult.second

        // Step 3: Validate command is supported
        if (!validCommands.contains(command)) {
            BridgeUtils.logError(TAG, "Unsupported command: $command")
            return BridgeValidationResult(
                isValid = false,
                command = command,
                params = params,
                body = body,
                error = BridgeValidationError(
                    message = "Unsupported command: $command",
                    code = "UNSUPPORTED_COMMAND",
                    eventName = "BRIDGE_ERROR"
                )
            )
        }

        // Step 4: Validate command-specific parameters
        if (params != null) {
            val validationError = validateCommandParameters(command, params)
            if (validationError != null) {
                return BridgeValidationResult(
                    isValid = false,
                    command = command,
                    params = params,
                    body = body,
                    error = validationError
                )
            }
        }

        BridgeUtils.logDebug(TAG, "Message validation successful for command: $command")
        return BridgeValidationResult(
            isValid = true,
            command = command,
            params = params,
            body = body,
            error = null
        )
    }

    // MARK: - Private Validation Helpers

    /**
     * Validate root message structure (command + data fields)
     * @return Pair of (command, params) or null if invalid
     */
    private fun validateRootMessageStructure(body: JSONObject): Pair<String, Any?>? {
        // Validate required command field
        val command = body.optString("command", "")
        if (command.isEmpty()) {
            BridgeUtils.logError(TAG, "Root message missing 'command' field")
            return null
        }

        // Optional: Validate timestamp if present
        if (body.has("timestamp")) {
            val timestamp = body.optString("timestamp")
            if (timestamp.isNotEmpty()) {
                // Basic ISO8601 format check (simplified)
                if (!timestamp.matches(Regex("\\d{4}-\\d{2}-\\d{2}T.*"))) {
                    BridgeUtils.logWarning(TAG, "Invalid timestamp format in message: $timestamp")
                }
            }
        }

        // Optional: Validate requestId if present
        if (body.has("requestId")) {
            val requestId = body.optString("requestId")
            if (requestId.isEmpty()) {
                BridgeUtils.logWarning(TAG, "Empty requestId in message")
            }
        }

        // Extract params from 'data' field
        val params = if (body.has("data")) {
            val data = body.get("data")
            when (data) {
                JSONObject.NULL -> null
                is JSONObject -> data
                is String -> data
                else -> data
            }
        } else {
            null
        }

        return Pair(command, params)
    }

    /**
     * Validate command-specific parameters against schema
     */
    private fun validateCommandParameters(command: String, params: Any): BridgeValidationError? {
        // Handle flexible commands (allow string, object, or null for legacy compatibility)
        if (flexibleCommands.contains(command)) {
            // Allow string or null parameters
            if (params is String || params == null) {
                BridgeUtils.logDebug(TAG, "Command '$command' received string/nil parameters - allowing for legacy compatibility")
                return null
            }

            // If it's an object, validate against schema if available
            if (params is JSONObject) {
                val schema = schemas[command]
                if (schema == null) {
                    BridgeUtils.logDebug(TAG, "No schema defined for command: $command, allowing object parameters")
                    return null
                }

                return validateObjectAgainstSchema(params, schema, command)
            }

            BridgeUtils.logWarning(TAG, "Command '$command' received unexpected parameter type: ${params.javaClass.simpleName}")
            return null // Allow for backward compatibility
        }

        // For strict commands, require object parameters and validate against schema
        val schema = schemas[command]
        if (schema == null) {
            BridgeUtils.logDebug(TAG, "No schema defined for command: $command, allowing all parameters")
            return null
        }

        if (params !is JSONObject) {
            BridgeUtils.logError(TAG, "Parameters for command '$command' must be an object")
            return BridgeValidationError(
                message = "Invalid parameters format for $command",
                code = "INVALID_PARAMS",
                eventName = "BRIDGE_ERROR"
            )
        }

        return validateObjectAgainstSchema(params, schema, command)
    }

    /**
     * Validate a JSON object against a schema definition
     */
    private fun validateObjectAgainstSchema(
        obj: JSONObject,
        schema: SchemaDefinition,
        commandName: String
    ): BridgeValidationError? {
        // Validate schema type
        if (schema.type != "object") {
            BridgeUtils.logWarning(TAG, "Schema for $commandName is not of type 'object'")
        }

        // Validate required fields
        for (requiredField in schema.required) {
            if (!obj.has(requiredField) || obj.isNull(requiredField)) {
                BridgeUtils.logError(TAG, "Required field '$requiredField' missing for command $commandName")
                return BridgeValidationError(
                    message = "Missing required field: $requiredField",
                    code = "MISSING_REQUIRED_FIELD",
                    eventName = "BRIDGE_ERROR"
                )
            }
        }

        // Validate each property
        val keys = obj.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val value = obj.get(key)

            if (value == JSONObject.NULL) {
                continue // Skip null values
            }

            val propertySchema = schema.properties[key]
            if (propertySchema != null) {
                val error = validatePropertyAgainstSchema(value, propertySchema, key, commandName)
                if (error != null) {
                    return error
                }
            } else if (!schema.additionalProperties) {
                BridgeUtils.logError(TAG, "Additional property '$key' not allowed for command $commandName")
                return BridgeValidationError(
                    message = "Additional property '$key' not allowed",
                    code = "ADDITIONAL_PROPERTY_NOT_ALLOWED",
                    eventName = "BRIDGE_ERROR"
                )
            }
        }

        return null
    }

    /**
     * Validate a single property against its schema
     */
    private fun validatePropertyAgainstSchema(
        value: Any,
        schema: PropertySchema,
        propertyName: String,
        commandName: String
    ): BridgeValidationError? {
        when (schema.type) {
            "string" -> {
                if (value !is String) {
                    BridgeUtils.logError(TAG, "Property '$propertyName' must be a string for command $commandName")
                    return BridgeValidationError(
                        message = "Property '$propertyName' must be a string",
                        code = "INVALID_TYPE",
                        eventName = "BRIDGE_ERROR"
                    )
                }

                // Validate enum values
                if (schema.enum != null && !schema.enum.contains(value)) {
                    BridgeUtils.logError(TAG, "Property '$propertyName' value '$value' not in allowed enum values")
                    return BridgeValidationError(
                        message = "Invalid value for $propertyName: $value",
                        code = "INVALID_ENUM_VALUE",
                        eventName = "BRIDGE_ERROR"
                    )
                }
            }

            "number" -> {
                val numberValue = when (value) {
                    is Number -> value.toDouble()
                    is String -> value.toDoubleOrNull()
                    else -> null
                }

                if (numberValue == null) {
                    BridgeUtils.logError(TAG, "Property '$propertyName' must be a number for command $commandName")
                    return BridgeValidationError(
                        message = "Property '$propertyName' must be a number",
                        code = "INVALID_TYPE",
                        eventName = "BRIDGE_ERROR"
                    )
                }

                // Validate minimum
                if (schema.minimum != null && numberValue < schema.minimum.toDouble()) {
                    BridgeUtils.logError(TAG, "Property '$propertyName' value $numberValue is below minimum ${schema.minimum}")
                    return BridgeValidationError(
                        message = "Value for $propertyName below minimum",
                        code = "VALUE_BELOW_MINIMUM",
                        eventName = "BRIDGE_ERROR"
                    )
                }

                // Validate maximum
                if (schema.maximum != null && numberValue > schema.maximum.toDouble()) {
                    BridgeUtils.logError(TAG, "Property '$propertyName' value $numberValue is above maximum ${schema.maximum}")
                    return BridgeValidationError(
                        message = "Value for $propertyName above maximum",
                        code = "VALUE_ABOVE_MAXIMUM",
                        eventName = "BRIDGE_ERROR"
                    )
                }
            }

            "boolean" -> {
                if (value !is Boolean) {
                    BridgeUtils.logError(TAG, "Property '$propertyName' must be a boolean for command $commandName")
                    return BridgeValidationError(
                        message = "Property '$propertyName' must be a boolean",
                        code = "INVALID_TYPE",
                        eventName = "BRIDGE_ERROR"
                    )
                }
            }

            else -> {
                BridgeUtils.logWarning(TAG, "Unknown schema type '${schema.type}' for property $propertyName")
            }
        }

        return null
    }

    // MARK: - Schema Management

    /**
     * Add a custom schema for a command
     */
    fun addCustomSchema(command: String, schema: SchemaDefinition) {
        // Note: Since schemas is immutable, we'd need to make it mutable if dynamic schemas are needed
        BridgeUtils.logInfo(TAG, "Custom schema support not yet implemented for runtime additions")
    }

    /**
     * Get all available commands that have schemas
     */
    fun getAvailableCommands(): Set<String> {
        return schemas.keys
    }

    /**
     * Check if a command has a schema defined
     */
    fun hasSchema(command: String): Boolean {
        return schemas.containsKey(command)
    }
}
