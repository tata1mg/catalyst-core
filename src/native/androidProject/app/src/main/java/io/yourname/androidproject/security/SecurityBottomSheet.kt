package io.yourname.androidproject.security

import android.app.Activity
import android.graphics.drawable.GradientDrawable
import android.util.Log
import android.view.View
import android.view.animation.DecelerateInterpolator
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import io.yourname.androidproject.design.DesignTokens

/**
 * Reusable BottomSheet component for displaying modal content.
 * Features Material Design 3 styling with smooth animations.
 *
 * Design features:
 * - Rounded top corners (24dp)
 * - Smooth slide-up animation with DecelerateInterpolator
 * - Non-dismissible (security critical)
 * - Adaptive theming (dark/light mode)
 */
class SecurityBottomSheet(
    private val activity: Activity,
    private val customView: View,
    private val onDismiss: (() -> Unit)? = null
) {

    private val TAG = "SecurityBottomSheet"
    private val bottomSheetDialog: BottomSheetDialog

    init {
        // Use custom transparent theme to prevent dark background layer
        bottomSheetDialog = BottomSheetDialog(
            activity,
            io.yourname.androidproject.R.style.TransparentBottomSheetDialog
        ).apply {
            setCancelable(false)
            setCanceledOnTouchOutside(false)
            setContentView(customView)

            // Configure bottom sheet behavior
            behavior.apply {
                state = BottomSheetBehavior.STATE_EXPANDED
                isDraggable = false // Prevent dismissal by dragging
                skipCollapsed = true // Skip half-expanded state
                isHideable = false // Prevent hiding
                peekHeight = 0 // No peek height
            }

            // Match window background to app surface color to prevent dark layer during animation
            window?.apply {
                val surfaceColor = DesignTokens.getSurfaceColor(activity)
                setBackgroundDrawableResource(android.R.color.transparent)
                decorView.setBackgroundColor(surfaceColor) // Matches light/dark theme
                setDimAmount(0.4f) // Semi-transparent scrim (40% dark overlay) for visual separation
            }

            // Add dismiss listener if callback provided
            onDismiss?.let { callback ->
                setOnDismissListener { callback() }
            }
        }
    }

    /**
     * Show the bottom sheet with smooth slide-up animation.
     * Uses DecelerateInterpolator for natural deceleration (Material Design).
     *
     * Animation tuning: Adjust ANIMATION_DURATION_MS to control entrance speed
     * - Default: 1200ms (slow, dramatic entrance)
     * - Past options: 300ms (fast), 500ms (smooth)
     *
     * @param animated Whether to animate the bottom sheet appearance
     */
    fun show(animated: Boolean = true) {
        if (activity.isFinishing || activity.isDestroyed) {
            Log.w(TAG, "Cannot show bottom sheet - activity is finishing or destroyed")
            return
        }

        // Show dialog first so layout pass runs
        bottomSheetDialog.show()

        // Wait for layout to complete, then position off-screen and animate in
        customView.post {
            // Force transparent background on all container layers AFTER layout
            bottomSheetDialog.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)?.apply {
                setBackgroundResource(android.R.color.transparent)
            }
            bottomSheetDialog.findViewById<View>(com.google.android.material.R.id.coordinator)?.apply {
                setBackgroundResource(android.R.color.transparent)
            }

            if (animated) {
                // Position off-screen using real measured height (available after layout)
                customView.translationY = customView.height.toFloat()
                customView.animate()
                    .translationY(0f)
                    .setDuration(ANIMATION_DURATION_MS)
                    .setInterpolator(DecelerateInterpolator())
                    .start()
            }
        }

        Log.d(TAG, "Bottom sheet shown with animation=$animated")
    }

    companion object {
        /**
         * TUNING VARIABLE: Bottom sheet entrance animation duration in milliseconds.
         *
         * Adjust this value to control how quickly the bottom sheet slides up:
         * - 300ms = Fast, snappy entrance
         * - 500ms = Smooth, balanced entrance
         * - 1200ms = Slow, dramatic entrance (Current Default)
         */
        const val ANIMATION_DURATION_MS = 1200L
    }

    /**
     * Dismiss the bottom sheet.
     */
    fun dismiss() {
        // Ensure dismissal happens on UI thread to prevent crashes
        activity.runOnUiThread {
            if (!activity.isFinishing && !activity.isDestroyed) {
                bottomSheetDialog.dismiss()
            }
        }
    }

    /**
     * Check if the bottom sheet is currently showing.
     *
     * @return true if bottom sheet is showing
     */
    fun isShowing(): Boolean = bottomSheetDialog.isShowing
}
