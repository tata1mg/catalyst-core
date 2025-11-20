package io.yourname.androidproject.utils

import android.content.Context
import android.util.Log
import android.webkit.WebView
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.*
import java.io.File
import java.io.IOException
import java.net.ServerSocket
import java.security.SecureRandom
import java.util.*
import java.util.concurrent.ConcurrentHashMap

/**
 * FrameworkServerUtils - Ktor-based HTTP server for serving large files in native environment
 * 
 * This utility provides a localhost server for handling files >2MB that cannot be transferred
 * via the native bridge due to size constraints. Uses Ktor server with session-based security.
 * 
 * Key Features:
 * - Automatic port discovery and server startup
 * - Session-based random route generation for security
 * - File serving with proper MIME type detection
 * - Automatic cleanup and lifecycle management
 * - Integration with URL whitelisting system
 */
object FrameworkServerUtils {
    private const val TAG = "FrameworkServer"
    private const val FRAMEWORK_PORT_RANGE_START = 3000
    private const val FRAMEWORK_PORT_RANGE_END = 3099
    private const val SESSION_TIMEOUT_MS = 30 * 60 * 1000L // 30 minutes
    
    // Server state
    private var server: EmbeddedServer<NettyApplicationEngine, NettyApplicationEngine.Configuration>? = null
    private var serverPort: Int = 0
    private var sessionId: String = ""
    private var isServerRunning: Boolean = false

    // CORS configuration - store the base URL from WebView
    private var allowedOrigin: String = "*"

    // File management
    private val servedFiles = ConcurrentHashMap<String, ServedFile>()
    private var cacheDirectory: File? = null
    
    // Coroutine scope for server operations
    private val serverScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    data class ServedFile(
        val file: File,
        val fileName: String,
        val mimeType: String,
        val fileId: String,
        val createdAt: Long = System.currentTimeMillis()
    )
    
    /**
     * Initialize and start the framework server
     * @param context Android context for file operations
     * @param webView WebView instance for notifications
     * @return Boolean indicating success/failure of server startup
     */
    fun startServer(context: Context, webView: WebView): Boolean {
        Log.d(TAG, "Starting framework server...")
        
        if (isServerRunning) {
            Log.d(TAG, "Server already running on port $serverPort")
            return true
        }
        
        return try {
            // Initialize cache directory
            initializeCacheDirectory(context)

            // Extract base URL from WebView for CORS
            extractBaseUrlFromWebView(webView)

            // Generate session ID
            sessionId = generateSessionId()
            Log.d(TAG, "Generated session ID: $sessionId")

            // Find available port
            serverPort = findAvailablePort()
            Log.d(TAG, "Found available port: $serverPort")

            // Start Ktor server
            startKtorServer()
            
            isServerRunning = true
            Log.i(TAG, "Framework server started successfully on port $serverPort with session $sessionId")
            
            // Notify WebView that server is ready
            BridgeUtils.notifyWeb(
                webView, 
                BridgeUtils.WebEvents.ON_FRAMEWORK_SERVER_READY,
                """{"port": $serverPort, "sessionId": "$sessionId"}"""
            )
            
            // Start cleanup task
            startCleanupTask()
            
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start framework server", e)
            BridgeUtils.notifyWebError(
                webView, 
                BridgeUtils.WebEvents.ON_FRAMEWORK_SERVER_ERROR,
                "Failed to start framework server: ${e.message}"
            )
            false
        }
    }
    
    /**
     * Stop the framework server and cleanup resources
     */
    fun stopServer() {
        Log.d(TAG, "Stopping framework server...")
        
        try {
            server?.stop(1000, 2000)
            server = null
            isServerRunning = false
            
            // Cleanup served files
            cleanupAllFiles()
            
            // Cancel coroutine scope
            serverScope.cancel()
            
            Log.i(TAG, "Framework server stopped successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping framework server", e)
        }
    }
    
    /**
     * Add a file to be served by the framework server
     * @param file File to serve
     * @param fileName Display name for the file
     * @param mimeType MIME type of the file
     * @return URL where the file can be accessed
     */
    fun addFileToServe(file: File, fileName: String, mimeType: String): String? {
        if (!isServerRunning) {
            Log.e(TAG, "Cannot add file to serve - server not running")
            return null
        }
        
        val fileId = generateFileId()
        val servedFile = ServedFile(file, fileName, mimeType, fileId)
        
        servedFiles[fileId] = servedFile
        
        val fileUrl = "http://localhost:$serverPort/framework-$sessionId/file-$fileId"
        Log.d(TAG, "Added file to serve: $fileName -> $fileUrl")
        
        return fileUrl
    }
    
    /**
     * Copy a file to cache directory and prepare it for serving
     * @param originalFile Original file to copy
     * @param fileName Display name
     * @param mimeType MIME type
     * @return URL where the file can be accessed, or null if failed
     */
    fun copyAndServeFile(originalFile: File, fileName: String, mimeType: String): String? {
        if (!isServerRunning || cacheDirectory == null) {
            Log.e(TAG, "Cannot copy and serve file - server not running or cache not initialized")
            return null
        }
        
        return try {
            val cachedFile = File(cacheDirectory, "${System.currentTimeMillis()}_$fileName")
            originalFile.copyTo(cachedFile, overwrite = true)
            
            Log.d(TAG, "Copied file to cache: ${originalFile.absolutePath} -> ${cachedFile.absolutePath}")
            
            addFileToServe(cachedFile, fileName, mimeType)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to copy file to cache", e)
            null
        }
    }
    
    /**
     * Remove a file from serving
     * @param fileId File ID to remove
     */
    fun removeServedFile(fileId: String) {
        servedFiles.remove(fileId)?.let { servedFile ->
            // Delete cached file if it's in our cache directory
            if (servedFile.file.parentFile == cacheDirectory) {
                try {
                    servedFile.file.delete()
                    Log.d(TAG, "Deleted cached file: ${servedFile.file.absolutePath}")
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to delete cached file", e)
                }
            }
        }
    }
    
    /**
     * Check if server is running
     */
    fun isRunning(): Boolean = isServerRunning
    
    /**
     * Get server port
     */
    fun getServerPort(): Int = serverPort
    
    /**
     * Get current session ID
     */
    fun getSessionId(): String = sessionId
    
    // Private implementation methods
    
    private fun initializeCacheDirectory(context: Context) {
        cacheDirectory = File(context.cacheDir, "framework_server_files")
        if (!cacheDirectory!!.exists()) {
            cacheDirectory!!.mkdirs()
            Log.d(TAG, "Created cache directory: ${cacheDirectory!!.absolutePath}")
        }
    }

    private fun extractBaseUrlFromWebView(webView: WebView) {
        try {
            val url = webView.url
            if (url != null && url.isNotEmpty()) {
                // Extract protocol, host and port from current WebView URL
                // e.g., "http://192.168.0.104:3005/path" -> "http://192.168.0.104:3005"
                val urlParts = url.split("/")
                if (urlParts.size >= 3) {
                    allowedOrigin = "${urlParts[0]}//${urlParts[2]}"
                    Log.d(TAG, "Extracted CORS origin from WebView: $allowedOrigin")
                } else {
                    Log.w(TAG, "Could not parse WebView URL for CORS, using wildcard")
                    allowedOrigin = "*"
                }
            } else {
                Log.w(TAG, "WebView URL is empty, using wildcard CORS")
                allowedOrigin = "*"
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error extracting base URL from WebView, using wildcard CORS", e)
            allowedOrigin = "*"
        }
    }
    
    private fun generateSessionId(): String {
        val random = SecureRandom()
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
    
    private fun generateFileId(): String {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12)
    }
    
    private fun findAvailablePort(): Int {
        for (port in FRAMEWORK_PORT_RANGE_START..FRAMEWORK_PORT_RANGE_END) {
            if (isPortAvailable(port)) {
                return port
            }
        }
        throw IOException("No available ports in range $FRAMEWORK_PORT_RANGE_START-$FRAMEWORK_PORT_RANGE_END")
    }
    
    private fun isPortAvailable(port: Int): Boolean {
        return try {
            ServerSocket(port).use { true }
        } catch (e: IOException) {
            false
        }
    }
    
    private fun startKtorServer() {
        server = embeddedServer(Netty, port = serverPort) {
            routing {
                get("/framework-$sessionId/file-{fileId}") {
                    val fileId = call.parameters["fileId"]
                    
                    if (fileId == null) {
                        Log.w(TAG, "Request missing fileId parameter")
                        call.respond(HttpStatusCode.BadRequest, "Missing fileId parameter")
                        return@get
                    }
                    
                    val servedFile = servedFiles[fileId]
                    if (servedFile == null) {
                        Log.w(TAG, "File not found for fileId: $fileId")
                        call.respond(HttpStatusCode.NotFound, "File not found")
                        return@get
                    }
                    
                    if (!servedFile.file.exists()) {
                        Log.w(TAG, "Physical file not found: ${servedFile.file.absolutePath}")
                        servedFiles.remove(fileId)
                        call.respond(HttpStatusCode.NotFound, "Physical file not found")
                        return@get
                    }
                    
                    Log.d(TAG, "Serving file: ${servedFile.fileName} (${servedFile.file.length()} bytes)")

                    // Set CORS headers
                    call.response.header(HttpHeaders.AccessControlAllowOrigin, allowedOrigin)
                    call.response.header(HttpHeaders.AccessControlAllowMethods, "GET, OPTIONS")
                    call.response.header(HttpHeaders.AccessControlAllowHeaders, "*")

                    // Set appropriate headers
                    call.response.header(HttpHeaders.ContentType, servedFile.mimeType)
                    call.response.header(HttpHeaders.ContentLength, servedFile.file.length().toString())
                    call.response.header(HttpHeaders.ContentDisposition, "inline; filename=\"${servedFile.fileName}\"")
                    call.response.header(HttpHeaders.CacheControl, "no-cache, no-store, must-revalidate")

                    // Serve the file
                    call.respondFile(servedFile.file)
                }
                
                get("/framework-$sessionId/status") {
                    // Set CORS headers
                    call.response.header(HttpHeaders.AccessControlAllowOrigin, allowedOrigin)
                    call.response.header(HttpHeaders.AccessControlAllowMethods, "GET, OPTIONS")
                    call.response.header(HttpHeaders.AccessControlAllowHeaders, "*")

                    call.respond(HttpStatusCode.OK, mapOf(
                        "status" to "running",
                        "sessionId" to sessionId,
                        "port" to serverPort,
                        "servedFiles" to servedFiles.size
                    ))
                }

                // Handle OPTIONS preflight requests for CORS
                options("/framework-$sessionId/{...}") {
                    call.response.header(HttpHeaders.AccessControlAllowOrigin, allowedOrigin)
                    call.response.header(HttpHeaders.AccessControlAllowMethods, "GET, OPTIONS")
                    call.response.header(HttpHeaders.AccessControlAllowHeaders, "*")
                    call.response.header(HttpHeaders.AccessControlMaxAge, "86400") // 24 hours
                    call.respond(HttpStatusCode.OK)
                }

                // Catch-all for invalid routes
                get("/framework-$sessionId/{...}") {
                    Log.w(TAG, "Invalid route requested: ${call.request.local.uri}")
                    call.respond(HttpStatusCode.NotFound, "Invalid route")
                }
            }
        }
        
        server?.start(wait = false)
        Log.d(TAG, "Ktor server started on port $serverPort")
    }
    
    private fun startCleanupTask() {
        serverScope.launch {
            while (isActive && isServerRunning) {
                try {
                    delay(5 * 60 * 1000L) // Run every 5 minutes
                    cleanupExpiredFiles()
                } catch (e: Exception) {
                    Log.e(TAG, "Error in cleanup task", e)
                }
            }
        }
    }
    
    private fun cleanupExpiredFiles() {
        val currentTime = System.currentTimeMillis()
        val expiredFiles = servedFiles.filter { (_, servedFile) ->
            currentTime - servedFile.createdAt > SESSION_TIMEOUT_MS
        }
        
        if (expiredFiles.isNotEmpty()) {
            Log.d(TAG, "Cleaning up ${expiredFiles.size} expired files")
            
            expiredFiles.forEach { (fileId, _) ->
                removeServedFile(fileId)
            }
        }
    }
    
    private fun cleanupAllFiles() {
        Log.d(TAG, "Cleaning up all served files (${servedFiles.size} files)")
        
        servedFiles.keys.toList().forEach { fileId ->
            removeServedFile(fileId)
        }
        
        // Clean cache directory
        cacheDirectory?.listFiles()?.forEach { file ->
            try {
                file.delete()
                Log.d(TAG, "Deleted cache file: ${file.name}")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to delete cache file: ${file.name}", e)
            }
        }
    }
}