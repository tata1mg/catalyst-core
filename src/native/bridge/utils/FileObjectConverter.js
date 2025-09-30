/**
 * FileObjectConverter
 * Converts base64 and URL file data to JavaScript File objects
 * for direct use in FormData and POST API calls
 */

/**
 * Convert base64 data URI to File object (synchronous)
 * @param {string} base64String - Base64 data URI (e.g., "data:image/jpeg;base64,...")
 * @param {string} filename - Desired filename for the File object
 * @param {string} mimeType - MIME type (e.g., "image/jpeg")
 * @returns {File} JavaScript File object
 * @throws {Error} If base64 string is invalid or conversion fails
 */
export function base64ToFile(base64String, filename, mimeType) {
    try {
        // Validate inputs
        if (!base64String || typeof base64String !== "string") {
            throw new Error("Invalid base64 string provided")
        }
        if (!filename || typeof filename !== "string") {
            throw new Error("Invalid filename provided")
        }
        if (!mimeType || typeof mimeType !== "string") {
            throw new Error("Invalid MIME type provided")
        }

        // Extract base64 data from data URI
        // Format: "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
        const base64Data = base64String.includes(",") ? base64String.split(",")[1] : base64String

        // Decode base64 to binary string
        const binaryString = atob(base64Data)

        // Convert binary string to byte array
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }

        // Create Blob from byte array
        const blob = new Blob([bytes], { type: mimeType })

        // Create and return File object
        return new File([blob], filename, { type: mimeType })
    } catch (error) {
        console.error("❌ FileObjectConverter: base64ToFile failed", {
            filename,
            mimeType,
            error: error.message,
        })
        throw new Error(`Failed to convert base64 to File: ${error.message}`)
    }
}

/**
 * Fetch file from URL and convert to File object (asynchronous)
 * Used for Framework Server routes (localhost:8080)
 * @param {string} url - File URL (e.g., "http://localhost:8080/file/xyz")
 * @param {string} filename - Desired filename for the File object
 * @param {string} mimeType - MIME type (e.g., "image/jpeg")
 * @returns {Promise<File>} JavaScript File object
 * @throws {Error} If fetch fails or conversion fails
 */
export async function urlToFile(url, filename, mimeType) {
    try {
        // Validate inputs
        if (!url || typeof url !== "string") {
            throw new Error("Invalid URL provided")
        }
        if (!filename || typeof filename !== "string") {
            throw new Error("Invalid filename provided")
        }
        if (!mimeType || typeof mimeType !== "string") {
            throw new Error("Invalid MIME type provided")
        }

        // Validate localhost URL for security
        if (!url.includes("localhost") && !url.includes("127.0.0.1")) {
            throw new Error("Only localhost URLs are supported for security reasons")
        }

        console.log("🔄 FileObjectConverter: Fetching file from Framework Server", {
            url,
            filename,
            mimeType,
        })

        // Fetch file from Framework Server
        const response = await fetch(url)

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        // Convert response to Blob
        const blob = await response.blob()

        // Create and return File object
        const file = new File([blob], filename, { type: mimeType })

        console.log("✅ FileObjectConverter: File object created successfully", {
            filename,
            size: file.size,
            type: file.type,
        })

        return file
    } catch (error) {
        console.error("❌ FileObjectConverter: urlToFile failed", {
            url,
            filename,
            mimeType,
            error: error.message,
        })
        throw new Error(`Failed to fetch and convert URL to File: ${error.message}`)
    }
}

/**
 * Check if a File object can be created from the given transport type
 * @param {string} transport - Transport type (BRIDGE_BASE64, FRAMEWORK_SERVER, CONTENT_PROVIDER)
 * @returns {boolean} True if File object can be created
 */
export function canCreateFileObject(transport) {
    const supportedTransports = ["BRIDGE_BASE64", "FRAMEWORK_SERVER"]
    return supportedTransports.includes(transport)
}

/**
 * Get user-friendly error message for unsupported transport
 * @param {string} transport - Transport type
 * @returns {string} Error message
 */
export function getUnsupportedTransportMessage(transport) {
    if (transport === "CONTENT_PROVIDER") {
        return "File object creation is not supported for CONTENT_PROVIDER transport. Use base64 data instead."
    }
    return `File object creation is not supported for transport type: ${transport}`
}