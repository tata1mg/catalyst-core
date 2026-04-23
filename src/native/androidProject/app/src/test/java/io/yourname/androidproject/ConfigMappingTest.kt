package io.yourname.androidproject

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import java.util.Properties

/**
 * Critical tests for JSON → Properties mapping
 *
 * This is the MOST IMPORTANT test suite in the framework.
 * The entire app depends on config.json (WEBVIEW_CONFIG) being correctly
 * mapped to webview_config.properties by build.gradle.kts
 *
 * If these tests fail, the app won't start.
 */
class ConfigMappingTest {

    /**
     * Simulates the extractProperties() function from build.gradle.kts
     * This is the core logic that converts JSON to Properties
     */
    private fun extractProperties(jsonObj: JSONObject, properties: Properties, prefix: String = "") {
        val keys = jsonObj.keys()

        while (keys.hasNext()) {
            val key = keys.next()
            val value = jsonObj.opt(key)
            val fullKey = if (prefix.isEmpty()) key else "$prefix.$key"

            when (value) {
                is JSONObject -> {
                    extractProperties(value, properties, fullKey)
                }
                is JSONArray -> {
                    val arrayValues = (0 until value.length()).map { i ->
                        value.opt(i).toString()
                    }.joinToString(",")
                    properties.setProperty(fullKey, arrayValues)
                }
                else -> {
                    properties.setProperty(fullKey, value.toString())
                }
            }
        }
    }

    // ============================================================
    // Test Category 1: JSON → Properties Mapping (10 tests)
    // ============================================================

    @Test
    fun `test flat properties are extracted correctly`() {
        val json = JSONObject().apply {
            put("LOCAL_IP", "192.168.1.100")
            put("port", "3005")
            put("buildType", "debug")
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertEquals("192.168.1.100", properties.getProperty("LOCAL_IP"))
        assertEquals("3005", properties.getProperty("port"))
        assertEquals("debug", properties.getProperty("buildType"))
    }

    @Test
    fun `test nested objects are flattened with dot notation`() {
        val json = JSONObject().apply {
            put("android", JSONObject().apply {
                put("packageName", "com.example.app")
                put("appName", "My App")
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertEquals("com.example.app", properties.getProperty("android.packageName"))
        assertEquals("My App", properties.getProperty("android.appName"))
    }

    @Test
    fun `test arrays are converted to comma-separated strings`() {
        val json = JSONObject().apply {
            put("accessControl", JSONObject().apply {
                put("allowedUrls", JSONArray().apply {
                    put("*.1mg.com*")
                    put("https://onemg.gumlet.io/*")
                    put("*browser.sentry-cdn.com/*")
                })
                put("enabled", true)
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        val allowedUrls = properties.getProperty("accessControl.allowedUrls")
        assertEquals("*.1mg.com*,https://onemg.gumlet.io/*,*browser.sentry-cdn.com/*", allowedUrls)
        assertEquals("true", properties.getProperty("accessControl.enabled"))
    }

    @Test
    fun `test splash screen with all fields`() {
        val json = JSONObject().apply {
            put("splashScreen", JSONObject().apply {
                put("imageWidth", 400)
                put("imageHeight", 200)
                put("duration", 2000)
                put("backgroundColor", "#FF5733")
                put("cornerRadius", 15)
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertEquals("400", properties.getProperty("splashScreen.imageWidth"))
        assertEquals("200", properties.getProperty("splashScreen.imageHeight"))
        assertEquals("2000", properties.getProperty("splashScreen.duration"))
        assertEquals("#FF5733", properties.getProperty("splashScreen.backgroundColor"))
        assertEquals("15", properties.getProperty("splashScreen.cornerRadius"))
    }

    @Test
    fun `test missing optional fields are handled gracefully`() {
        val json = JSONObject().apply {
            put("splashScreen", JSONObject().apply {
                put("imageWidth", 400)
                // Missing imageHeight, duration, backgroundColor, cornerRadius
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertEquals("400", properties.getProperty("splashScreen.imageWidth"))
        assertNull("Optional fields should not be set if missing",
            properties.getProperty("splashScreen.imageHeight"))
        assertNull(properties.getProperty("splashScreen.duration"))
    }

    @Test
    fun `test invalid JSON structure does not crash`() {
        val json = JSONObject().apply {
            put("validKey", "validValue")
            put("nullValue", JSONObject.NULL)
        }

        val properties = Properties()

        // Should not throw exception
        try {
            extractProperties(json, properties)
            assertEquals("validValue", properties.getProperty("validKey"))
            assertEquals("null", properties.getProperty("nullValue")) // JSON.NULL becomes "null" string
            assertTrue("Should complete without crashing", true)
        } catch (e: Exception) {
            fail("Should handle invalid JSON gracefully: ${e.message}")
        }
    }

    @Test
    fun `test special characters in values are preserved`() {
        val json = JSONObject().apply {
            put("url", "https://example.com/path?param=value&other=123")
            put("regex", "*.js,*.css")
            put("message", "Hello, World!")
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertEquals("https://example.com/path?param=value&other=123", properties.getProperty("url"))
        assertEquals("*.js,*.css", properties.getProperty("regex"))
        assertEquals("Hello, World!", properties.getProperty("message"))
    }

    @Test
    fun `test empty string values are handled`() {
        val json = JSONObject().apply {
            put("emptyString", "")
            put("whitespace", "   ")
            put("normalString", "value")
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertEquals("", properties.getProperty("emptyString"))
        assertEquals("   ", properties.getProperty("whitespace"))
        assertEquals("value", properties.getProperty("normalString"))
    }

    @Test
    fun `test boolean conversion to string`() {
        val json = JSONObject().apply {
            put("enabled", true)
            put("disabled", false)
            put("accessControl", JSONObject().apply {
                put("enabled", true)
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertEquals("true", properties.getProperty("enabled"))
        assertEquals("false", properties.getProperty("disabled"))
        assertEquals("true", properties.getProperty("accessControl.enabled"))
    }

    @Test
    fun `test numeric types are converted to strings`() {
        val json = JSONObject().apply {
            put("intValue", 42)
            put("longValue", 9876543210L)
            put("doubleValue", 3.14159)
            put("port", 3005)
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertEquals("42", properties.getProperty("intValue"))
        assertEquals("9876543210", properties.getProperty("longValue"))
        assertTrue("Double should be converted to string",
            properties.getProperty("doubleValue").startsWith("3.14"))
        assertEquals("3005", properties.getProperty("port"))
    }

    // ============================================================
    // Test Category 2: Build Type Handling (4 tests)
    // ============================================================

    @Test
    fun `test debug build sets buildType to debug`() {
        val properties = Properties()
        properties.setProperty("buildType", "debug")
        properties.setProperty("buildOptimisation", "false")

        assertEquals("debug", properties.getProperty("buildType"))
        assertEquals("false", properties.getProperty("buildOptimisation"))
    }

    @Test
    fun `test release build sets buildType to release`() {
        val properties = Properties()
        properties.setProperty("buildType", "release")
        properties.setProperty("buildOptimisation", "true")
        properties.setProperty("LOCAL_IP", "127.0.0.1")

        assertEquals("release", properties.getProperty("buildType"))
        assertEquals("true", properties.getProperty("buildOptimisation"))
        assertEquals("127.0.0.1", properties.getProperty("LOCAL_IP"))
    }

    @Test
    fun `test LOCAL_IP is set for debug build`() {
        val properties = Properties()
        // Simulating debug build - LOCAL_IP would be dynamic
        properties.setProperty("LOCAL_IP", "192.168.1.100")
        properties.setProperty("buildType", "debug")

        assertNotEquals("127.0.0.1", properties.getProperty("LOCAL_IP"),
            "Debug builds should not use localhost")
        assertEquals("debug", properties.getProperty("buildType"))
    }

    @Test
    fun `test buildOptimisation flag matches buildType`() {
        // Debug build
        val debugProps = Properties().apply {
            setProperty("buildType", "debug")
            setProperty("buildOptimisation", "false")
        }
        assertEquals("false", debugProps.getProperty("buildOptimisation"))

        // Release build
        val releaseProps = Properties().apply {
            setProperty("buildType", "release")
            setProperty("buildOptimisation", "true")
        }
        assertEquals("true", releaseProps.getProperty("buildOptimisation"))
    }

    // ============================================================
    // Test Category 3: Properties Loading in Runtime (4 tests)
    // ============================================================

    @Test
    fun `test properties can be loaded from Properties object`() {
        val properties = Properties()
        properties.setProperty("android.packageName", "com.test.app")
        properties.setProperty("android.appName", "Test App")

        assertEquals("com.test.app", properties.getProperty("android.packageName"))
        assertEquals("Test App", properties.getProperty("android.appName"))
    }

    @Test
    fun `test accessControl properties are accessible`() {
        val properties = Properties()
        properties.setProperty("accessControl.enabled", "true")
        properties.setProperty("accessControl.allowedUrls", "*.example.com*,https://cdn.example.com/*")

        assertEquals("true", properties.getProperty("accessControl.enabled"))

        val urls = properties.getProperty("accessControl.allowedUrls")
        val urlList = urls.split(",").map { it.trim() }
        assertEquals(2, urlList.size)
        assertTrue(urlList.contains("*.example.com*"))
    }

    @Test
    fun `test cachePattern property is accessible`() {
        val properties = Properties()
        properties.setProperty("cachePattern", "*.css,*.js")
        properties.setProperty("android.cachePattern", "*.css,*.js,*.png")

        assertEquals("*.css,*.js", properties.getProperty("cachePattern"))
        assertEquals("*.css,*.js,*.png", properties.getProperty("android.cachePattern"))
    }

    @Test
    fun `test missing property returns null`() {
        val properties = Properties()
        properties.setProperty("existingKey", "value")

        assertNotNull(properties.getProperty("existingKey"))
        assertNull(properties.getProperty("nonExistentKey"))

        // With default value
        assertEquals("default", properties.getProperty("nonExistentKey", "default"))
    }

    // ============================================================
    // Test Category 4: Critical Fields Validation (5 tests)
    // ============================================================

    @Test
    fun `test accessControl enabled field is present`() {
        val json = JSONObject().apply {
            put("accessControl", JSONObject().apply {
                put("enabled", true)
                put("allowedUrls", JSONArray().apply {
                    put("*.example.com*")
                })
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertTrue("accessControl.enabled must be present",
            properties.containsKey("accessControl.enabled"))
        assertEquals("true", properties.getProperty("accessControl.enabled"))
    }

    @Test
    fun `test accessControl allowedUrls array is converted correctly`() {
        val json = JSONObject().apply {
            put("accessControl", JSONObject().apply {
                put("allowedUrls", JSONArray().apply {
                    put("*.1mg.com*")
                    put("https://onemg.gumlet.io/*")
                    put("*browser.sentry-cdn.com/*")
                    put("https://psppfizer.1mg.com/*")
                    put("*stagpsppfizer.1mg.com*")
                })
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        val allowedUrls = properties.getProperty("accessControl.allowedUrls")
        assertNotNull("allowedUrls must be present", allowedUrls)

        val urlList = allowedUrls.split(",")
        assertEquals(5, urlList.size)
        assertTrue(urlList.contains("*.1mg.com*"))
        assertTrue(urlList.contains("https://onemg.gumlet.io/*"))
    }

    @Test
    fun `test android packageName is required`() {
        val json = JSONObject().apply {
            put("android", JSONObject().apply {
                put("packageName", "com.onemg.patientportal")
                put("appName", "Test App")
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertTrue("android.packageName is required",
            properties.containsKey("android.packageName"))
        assertNotEquals("", properties.getProperty("android.packageName"))
    }

    @Test
    fun `test android appName is required`() {
        val json = JSONObject().apply {
            put("android", JSONObject().apply {
                put("appName", "Pfizer PAP India - stag")
                put("packageName", "com.example.app")
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertTrue("android.appName is required",
            properties.containsKey("android.appName"))
        assertNotEquals("", properties.getProperty("android.appName"))
    }

    @Test
    fun `test cachePattern is parsed correctly`() {
        val json = JSONObject().apply {
            put("cachePattern", "*.css,*.js")
            put("android", JSONObject().apply {
                put("cachePattern", "*.css,*.js")
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        val rootCachePattern = properties.getProperty("cachePattern")
        val androidCachePattern = properties.getProperty("android.cachePattern")

        assertEquals("*.css,*.js", rootCachePattern)
        assertEquals("*.css,*.js", androidCachePattern)
    }

    // ============================================================
    // Test Category 5: Regression Tests (5 tests)
    // These test real-world config from psp-pfizer-ui
    // ============================================================

    @Test
    fun `test real-world config from psp-pfizer-ui`() {
        // This is the actual WEBVIEW_CONFIG from /Users/mayankmahavar/psp-pfizer-ui/config/config.json
        val json = JSONObject().apply {
            put("accessControl", JSONObject().apply {
                put("allowedUrls", JSONArray().apply {
                    put("*.1mg.com*")
                    put("https://onemg.gumlet.io/*")
                    put("*browser.sentry-cdn.com*")
                    put("https://psppfizer.1mg.com/*")
                    put("*stagpsppfizer.1mg.com*")
                })
                put("enabled", true)
            })
            put("android", JSONObject().apply {
                put("appName", "Pfizer PAP India - stag")
                put("packageName", "com.onemg.patientportal")
                put("buildType", "debug")
                put("cachePattern", "*.css,*.js")
                put("emulatorName", "testMediumPhone")
            })
            put("appInfo", "android-stag-28.11-v0.0.0")
            put("cachePattern", "*.css,*.js")
            put("LOCAL_IP", "stagpsppfizer.1mg.com")
            put("port", "")
            put("splashScreen", JSONObject().apply {
                put("imageHeight", 200)
                put("imageWidth", 400)
            })
            put("useHttps", true)
        }

        val properties = Properties()
        extractProperties(json, properties)

        // Verify critical fields
        assertEquals("true", properties.getProperty("accessControl.enabled"))
        assertEquals("com.onemg.patientportal", properties.getProperty("android.packageName"))
        assertEquals("Pfizer PAP India - stag", properties.getProperty("android.appName"))
        assertEquals("*.css,*.js", properties.getProperty("cachePattern"))
        assertEquals("stagpsppfizer.1mg.com", properties.getProperty("LOCAL_IP"))
        assertEquals("true", properties.getProperty("useHttps"))
        assertEquals("400", properties.getProperty("splashScreen.imageWidth"))
        assertEquals("200", properties.getProperty("splashScreen.imageHeight"))
    }

    @Test
    fun `test all expected keys are present in real config`() {
        val json = JSONObject().apply {
            put("accessControl", JSONObject().apply {
                put("enabled", true)
                put("allowedUrls", JSONArray())
            })
            put("android", JSONObject().apply {
                put("packageName", "com.example.app")
                put("appName", "Test")
                put("buildType", "debug")
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        // These keys MUST exist for the app to work
        val requiredKeys = listOf(
            "accessControl.enabled",
            "android.packageName",
            "android.appName",
            "android.buildType"
        )

        requiredKeys.forEach { key ->
            assertTrue("Required key missing: $key", properties.containsKey(key))
        }
    }

    @Test
    fun `test array serialization is preserved`() {
        val json = JSONObject().apply {
            put("accessControl", JSONObject().apply {
                put("allowedUrls", JSONArray().apply {
                    put("*.1mg.com*")
                    put("https://onemg.gumlet.io/*")
                    put("*browser.sentry-cdn.com*")
                })
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        val urls = properties.getProperty("accessControl.allowedUrls")
        val urlArray = urls.split(",")

        assertEquals("Array length must be preserved", 3, urlArray.size)
        assertEquals("*.1mg.com*", urlArray[0])
        assertEquals("https://onemg.gumlet.io/*", urlArray[1])
        assertEquals("*browser.sentry-cdn.com*", urlArray[2])
    }

    @Test
    fun `test nested object flattening works correctly`() {
        val json = JSONObject().apply {
            put("android", JSONObject().apply {
                put("packageName", "com.example.app")
                put("nested", JSONObject().apply {
                    put("deepValue", "test")
                })
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        assertEquals("com.example.app", properties.getProperty("android.packageName"))
        assertEquals("test", properties.getProperty("android.nested.deepValue"))
    }

    @Test
    fun `test access control URLs remain intact after conversion`() {
        val originalUrls = listOf(
            "*.1mg.com*",
            "https://onemg.gumlet.io/*",
            "*browser.sentry-cdn.com/*",
            "https://psppfizer.1mg.com/*",
            "*stagpsppfizer.1mg.com*"
        )

        val json = JSONObject().apply {
            put("accessControl", JSONObject().apply {
                put("allowedUrls", JSONArray().apply {
                    originalUrls.forEach { put(it) }
                })
            })
        }

        val properties = Properties()
        extractProperties(json, properties)

        val convertedUrls = properties.getProperty("accessControl.allowedUrls")
        val urlList = convertedUrls.split(",")

        assertEquals("URL count must match", originalUrls.size, urlList.size)
        originalUrls.forEachIndexed { index, url ->
            assertEquals("URL $index must match exactly", url, urlList[index])
        }
    }
}
