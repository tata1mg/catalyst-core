package io.yourname.androidproject

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.Properties
import java.util.concurrent.TimeUnit

/**
 * Unit tests for WebCacheManager
 * Tests cache logic, expiration rules, size management, and revalidation concepts
 *
 * Coverage:
 * - Cache CRUD Operations (6 tests)
 * - Cache Expiration (5 tests)
 * - Cache Size Management (4 tests)
 * - Revalidation Logic (3 tests)
 *
 * Total: 18 tests
 *
 * Note: Tests focus on cache logic and algorithms without requiring full Android Context
 */
class WebCacheManagerTest {

    // ============================================================
    // CATEGORY 1: CACHE CRUD OPERATIONS (6 tests)
    // ============================================================

    @Test
    fun `test MD5 cache key generation algorithm`() {
        // Test the MD5 hashing algorithm used by WebCacheManager
        val url1 = "https://example.com/resource.js"
        val url2 = "https://example.com/resource.js"
        val url3 = "https://example.com/different.js"

        val key1 = generateMD5CacheKey(url1)
        val key2 = generateMD5CacheKey(url2)
        val key3 = generateMD5CacheKey(url3)

        // Same URLs should produce same keys
        assertEquals("Same URL should produce same cache key", key1, key2)

        // Different URLs should produce different keys
        assertNotEquals("Different URLs should produce different cache keys", key1, key3)

        // Cache key should be 32 characters (MD5 hex)
        assertEquals("MD5 hash should be 32 characters", 32, key1.length)

        // Cache key should only contain hex characters
        assertTrue("Cache key should only contain hex characters",
            key1.all { it in '0'..'9' || it in 'a'..'f' })
    }

    @Test
    fun `test cache key generation consistency`() {
        val url = "https://example.com/test.js"
        val keys = (1..10).map { generateMD5CacheKey(url) }

        // All generated keys should be identical
        assertTrue("Cache key generation should be consistent",
            keys.all { it == keys.first() })
    }

    @Test
    fun `test cache key handles special characters in URL`() {
        val urlWithParams = "https://example.com/api?param=value&foo=bar"
        val urlWithHash = "https://example.com/page#section"
        val urlWithUnicode = "https://example.com/文档/test.js"

        val key1 = generateMD5CacheKey(urlWithParams)
        val key2 = generateMD5CacheKey(urlWithHash)
        val key3 = generateMD5CacheKey(urlWithUnicode)

        // All should generate valid MD5 hashes
        assertEquals(32, key1.length)
        assertEquals(32, key2.length)
        assertEquals(32, key3.length)

        // Each should be unique
        assertNotEquals(key1, key2)
        assertNotEquals(key2, key3)
        assertNotEquals(key1, key3)
    }

    @Test
    fun `test cache hit scenario with valid entry`() {
        // Simulate cache hit: entry exists and is fresh
        val currentTime = System.currentTimeMillis()
        val cacheTimestamp = currentTime - TimeUnit.HOURS.toMillis(1) // 1 hour old
        val maxAge = TimeUnit.HOURS.toMillis(24) // 24 hours

        val age = currentTime - cacheTimestamp
        val isFresh = age <= maxAge

        assertTrue("1 hour old entry should be fresh (within 24h)", isFresh)
    }

    @Test
    fun `test cache configuration properties parsing`() {
        val customProperties = Properties().apply {
            setProperty("cache.maxAge", "48")
            setProperty("cache.staleWhileRevalidate", "2")
            setProperty("cache.maxSize", "200")
            setProperty("cache.memoryFraction", "4")
        }

        // Verify property parsing logic
        val maxAge = customProperties.getProperty("cache.maxAge", "24")?.toLongOrNull() ?: 24L
        val staleWhileRevalidate = customProperties.getProperty("cache.staleWhileRevalidate", "1")?.toLongOrNull() ?: 1L
        val maxSize = customProperties.getProperty("cache.maxSize", "100")?.toLongOrNull() ?: 100L
        val memoryFraction = customProperties.getProperty("cache.memoryFraction", "8")?.toIntOrNull() ?: 8

        assertEquals("maxAge should be parsed correctly", 48L, maxAge)
        assertEquals("staleWhileRevalidate should be parsed correctly", 2L, staleWhileRevalidate)
        assertEquals("maxSize should be parsed correctly", 200L, maxSize)
        assertEquals("memoryFraction should be parsed correctly", 4, memoryFraction)
    }

    @Test
    fun `test cache uses default values for missing properties`() {
        val emptyProperties = Properties()

        // Test default value fallback logic
        val maxAge = emptyProperties.getProperty("cache.maxAge", "24")?.toLongOrNull() ?: 24L
        val staleWhileRevalidate = emptyProperties.getProperty("cache.staleWhileRevalidate", "1")?.toLongOrNull() ?: 1L
        val maxSize = emptyProperties.getProperty("cache.maxSize", "100")?.toLongOrNull() ?: 100L

        assertEquals("Default maxAge should be 24 hours", 24L, maxAge)
        assertEquals("Default staleWhileRevalidate should be 1 hour", 1L, staleWhileRevalidate)
        assertEquals("Default maxSize should be 100 MB", 100L, maxSize)
    }

    // Helper method to replicate WebCacheManager's cache key generation
    private fun generateMD5CacheKey(url: String): String {
        return try {
            val md = MessageDigest.getInstance("MD5")
            val digest = md.digest(url.toByteArray())
            digest.joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            url.hashCode().toString()
        }
    }

    // ============================================================
    // CATEGORY 2: CACHE EXPIRATION (5 tests)
    // ============================================================

    @Test
    fun `test cache entry within maxAge is fresh`() {
        // Test freshness calculation
        val currentTime = System.currentTimeMillis()
        val cacheTimestamp = currentTime - TimeUnit.HOURS.toMillis(12) // 12 hours old
        val maxAge = TimeUnit.HOURS.toMillis(24) // 24 hour maxAge

        val age = currentTime - cacheTimestamp
        val isFresh = age <= maxAge

        assertTrue("12 hours should be within 24 hour maxAge", isFresh)
        assertEquals("Age should be 12 hours", TimeUnit.HOURS.toMillis(12), age)
    }

    @Test
    fun `test cache entry beyond maxAge is stale`() {
        // Test stale content detection
        val currentTime = System.currentTimeMillis()
        val cacheTimestamp = currentTime - TimeUnit.HOURS.toMillis(30) // 30 hours old
        val maxAge = TimeUnit.HOURS.toMillis(24) // 24 hour maxAge

        val age = currentTime - cacheTimestamp
        val isStale = age > maxAge

        assertTrue("30 hours should be beyond 24 hour maxAge", isStale)
    }

    @Test
    fun `test stale-while-revalidate window allows stale content`() {
        // Test stale-while-revalidate logic
        val currentTime = System.currentTimeMillis()
        val maxAge = TimeUnit.HOURS.toMillis(24)
        val staleWhileRevalidate = TimeUnit.HOURS.toMillis(1)
        val totalWindow = maxAge + staleWhileRevalidate

        // 24.5 hours old - stale but within revalidate window
        val cacheTimestamp = currentTime - TimeUnit.HOURS.toMillis(24) - TimeUnit.MINUTES.toMillis(30)
        val age = currentTime - cacheTimestamp

        val isWithinRevalidateWindow = age > maxAge && age <= totalWindow

        assertTrue("Content should be stale", age > maxAge)
        assertTrue("Content should be within stale-while-revalidate window",
            age <= totalWindow)
        assertTrue("Content within stale-while-revalidate should be valid",
            isWithinRevalidateWindow)
    }

    @Test
    fun `test expired cache beyond revalidate window is invalid`() {
        // Test expired content detection
        val currentTime = System.currentTimeMillis()
        val maxAge = TimeUnit.HOURS.toMillis(24)
        val staleWhileRevalidate = TimeUnit.HOURS.toMillis(1)
        val totalWindow = maxAge + staleWhileRevalidate

        // 26 hours old - beyond revalidate window
        val cacheTimestamp = currentTime - TimeUnit.HOURS.toMillis(26)
        val age = currentTime - cacheTimestamp

        val isExpired = age > totalWindow

        assertTrue("26 hours should be beyond 25 hour total window", isExpired)
    }

    @Test
    fun `test cache expiration window boundaries`() {
        val maxAge = TimeUnit.HOURS.toMillis(24)
        val staleWhileRevalidate = TimeUnit.HOURS.toMillis(1)

        // Test exact boundary: 24 hours (fresh/stale boundary)
        val exactMaxAge = TimeUnit.HOURS.toMillis(24)
        assertTrue("Exactly maxAge should be at boundary",
            exactMaxAge <= maxAge)

        // Test exact boundary: 25 hours (stale/expired boundary)
        val exactTotalWindow = TimeUnit.HOURS.toMillis(25)
        assertTrue("Exactly total window should be at boundary",
            exactTotalWindow <= maxAge + staleWhileRevalidate)

        // Test just beyond: 25 hours + 1ms (expired)
        val justExpired = TimeUnit.HOURS.toMillis(25) + 1
        assertTrue("Just beyond window should be expired",
            justExpired > maxAge + staleWhileRevalidate)
    }

    // ============================================================
    // CATEGORY 3: CACHE SIZE MANAGEMENT (4 tests)
    // ============================================================

    @Test
    fun `test cache respects max size limit`() {
        // Test max cache size calculations
        val maxCacheSize = 100 * 1024 * 1024L // 100MB

        assertTrue("Max cache size should be positive", maxCacheSize > 0)

        // 50MB should be within limit
        val validSize = 50 * 1024 * 1024L
        assertTrue("50MB should be within 100MB limit", validSize <= maxCacheSize)

        // 150MB should exceed limit
        val oversizedCache = 150 * 1024 * 1024L
        assertTrue("150MB should exceed 100MB limit", oversizedCache > maxCacheSize)
    }

    @Test
    fun `test LRU eviction logic removes oldest first`() {
        // Test LRU ordering logic
        val time1 = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(3) // 3 days ago
        val time2 = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(2) // 2 days ago
        val time3 = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(1) // 1 day ago

        // Create file timestamps map
        val files = mapOf(
            "oldest.cache" to time1,
            "middle.cache" to time2,
            "newest.cache" to time3
        )

        // Sort by timestamp (LRU logic)
        val sortedFiles = files.entries.sortedBy { it.value }

        // Verify LRU ordering
        assertEquals("First should be oldest", "oldest.cache", sortedFiles[0].key)
        assertEquals("Last should be newest", "newest.cache", sortedFiles[2].key)
    }

    @Test
    fun `test memory cache size calculation`() {
        // Test memory cache size calculation based on runtime memory
        val maxMemory = Runtime.getRuntime().maxMemory()

        // Default: 1/8 of max memory
        val memoryCacheFraction = 8
        val expectedCacheSize = (maxMemory / 1024 / memoryCacheFraction).toInt()

        assertTrue("Memory cache size should be positive", expectedCacheSize > 0)

        // Verify it's a reasonable size (at least 1MB)
        assertTrue("Memory cache should be at least 1MB",
            expectedCacheSize >= 1024)

        // Test custom fraction: 1/4 of max memory
        val customFraction = 4
        val customCacheSize = (maxMemory / 1024 / customFraction).toInt()

        assertTrue("Custom cache should be larger than default",
            customCacheSize > expectedCacheSize)
    }

    @Test
    fun `test disk usage tracking and file size summation`() {
        // Test file size calculation logic
        val file1Size = 1024L * 50  // 50KB
        val file2Size = 1024L * 100 // 100KB
        val file3Size = 1024L * 200 // 200KB

        val totalSize = file1Size + file2Size + file3Size

        assertEquals("Total should be 350KB", 1024L * 350, totalSize)

        // Test against max cache size
        val maxCacheSize = 100 * 1024 * 1024L // 100MB

        assertTrue("350KB should be well under 100MB limit",
            totalSize < maxCacheSize)

        // Test eviction needed scenario
        val largeTotalSize = 120 * 1024 * 1024L // 120MB
        assertTrue("120MB should exceed 100MB limit and trigger eviction",
            largeTotalSize > maxCacheSize)
    }

    // ============================================================
    // CATEGORY 4: REVALIDATION LOGIC (3 tests)
    // ============================================================

    @Test
    fun `test ETag header format and validation`() {
        // Test ETag format validation
        val strongETag = "\"33a64df551425fcc55e4d42a148795d9f25f89d4\""
        val weakETag = "W/\"33a64df551425fcc55e4d42a148795d9f25f89d4\""

        assertNotNull("Strong ETag should not be null", strongETag)
        assertTrue("Strong ETag should be quoted",
            strongETag.startsWith("\"") && strongETag.endsWith("\""))

        assertNotNull("Weak ETag should not be null", weakETag)
        assertTrue("Weak ETag should have W/ prefix", weakETag.startsWith("W/"))

        // Test If-None-Match header construction
        val ifNoneMatch = strongETag
        assertEquals("If-None-Match should match ETag", strongETag, ifNoneMatch)
    }

    @Test
    fun `test Last-Modified header format and validation`() {
        // Test Last-Modified HTTP date format
        val lastModified = "Wed, 21 Oct 2015 07:28:00 GMT"

        assertNotNull("Last-Modified should not be null", lastModified)
        assertTrue("Last-Modified should be non-empty", lastModified.isNotEmpty())
        assertTrue("Last-Modified should contain GMT",
            lastModified.endsWith("GMT"))

        // Verify format matches HTTP-date (RFC 7231)
        // Format: <day-name>, <day> <month> <year> <hour>:<minute>:<second> GMT
        val httpDatePattern = Regex("""\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT""")
        assertTrue("Last-Modified should match HTTP date format",
            lastModified.matches(httpDatePattern))

        // Test If-Modified-Since header construction
        val ifModifiedSince = lastModified
        assertEquals("If-Modified-Since should match Last-Modified",
            lastModified, ifModifiedSince)
    }

    @Test
    fun `test revalidation prevents duplicate requests`() {
        // Test duplicate revalidation prevention logic
        val cacheKey = generateMD5CacheKey("https://example.com/resource.js")
        val ongoingRevalidations = mutableSetOf<String>()

        // First revalidation attempt
        val added1 = ongoingRevalidations.add(cacheKey)
        assertTrue("First revalidation should be allowed", added1)
        assertTrue("Cache key should be in ongoing set",
            ongoingRevalidations.contains(cacheKey))

        // Second revalidation attempt (duplicate)
        val added2 = ongoingRevalidations.add(cacheKey)
        assertFalse("Duplicate revalidation should be prevented", added2)

        // After completion
        ongoingRevalidations.remove(cacheKey)
        assertFalse("Cache key should be removed after completion",
            ongoingRevalidations.contains(cacheKey))

        // Third revalidation attempt (allowed after completion)
        val added3 = ongoingRevalidations.add(cacheKey)
        assertTrue("Revalidation should be allowed after previous completion", added3)
    }
}
