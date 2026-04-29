package io.yourname.androidproject

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory
import androidx.core.graphics.drawable.toBitmap
import io.yourname.androidproject.databinding.ActivitySplashBinding
import java.util.Properties

class SplashActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySplashBinding
    private lateinit var properties: Properties
    private var isFinishing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        properties = Properties()
        try {
            assets.open("webview_config.properties").use { properties.load(it) }
        } catch (e: Exception) {
            startMainActivity()
            return
        }

        if (!properties.getProperty("splashScreen.enabled", "false").toBoolean()) {
            startMainActivity()
            return
        }

        binding = ActivitySplashBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        configureSplashScreen()
        startSplashTimer()
    }

    private fun configureSplashScreen() {
        val backgroundColor = properties.getProperty("splashScreen.backgroundColor", "#ffffff")
        val imageWidth = properties.getProperty("splashScreen.imageWidth", "120").toIntOrNull() ?: 120
        val imageHeight = properties.getProperty("splashScreen.imageHeight", "120").toIntOrNull() ?: 120
        val cornerRadius = properties.getProperty("splashScreen.cornerRadius", "20").toFloatOrNull() ?: 20f

        try {
            binding.splashContainer.setBackgroundColor(Color.parseColor(backgroundColor))
        } catch (e: Exception) {
            binding.splashContainer.setBackgroundColor(Color.WHITE)
        }

        val widthPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, imageWidth.toFloat(), resources.displayMetrics).toInt()
        val heightPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, imageHeight.toFloat(), resources.displayMetrics).toInt()

        binding.splashImage.layoutParams.apply {
            width = widthPx
            height = heightPx
        }

        val drawable = ContextCompat.getDrawable(this, 
            resources.getIdentifier("splashscreen", "drawable", packageName).takeIf { it != 0 } 
                ?: R.mipmap.ic_launcher
        ) ?: return

        if (cornerRadius > 0) {
            val radiusPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, cornerRadius, resources.displayMetrics)
            val roundedDrawable = RoundedBitmapDrawableFactory.create(resources, drawable.toBitmap(widthPx, heightPx))
            roundedDrawable.cornerRadius = radiusPx
            binding.splashImage.setImageDrawable(roundedDrawable)
        } else {
            binding.splashImage.setImageDrawable(drawable)
        }
    }

    private fun startSplashTimer() {
        val duration = properties.getProperty("splashScreen.duration")?.toLongOrNull() ?: 1000
        Handler(Looper.getMainLooper()).postDelayed({ dismissSplash() }, duration)
    }

    private fun dismissSplash() {
        if (isFinishing) return
        isFinishing = true
        startActivity(Intent(this, MainActivity::class.java))
        finish()

        // Use modern API for Android 14+ (API 34+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            overrideActivityTransition(
                Activity.OVERRIDE_TRANSITION_CLOSE,
                android.R.anim.fade_in,
                android.R.anim.fade_out
            )
        } else {
            // Fallback to deprecated API for Android 13 and below
            @Suppress("DEPRECATION")
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        }
    }

    private fun startMainActivity() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
