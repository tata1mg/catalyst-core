package io.yourname.androidproject.security

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.yourname.androidproject.design.DesignTokens

/**
 * UI builder for security alert bottom sheets.
 * Follows Material Design 3 principles with adaptive theming.
 */
object SecurityAlertUI {

    /**
     * Create a modern security alert view for bottom sheet display.
     *
     * Design features:
     * - Large hero icon at top
     * - Scrollable content area
     * - Persistent footer button
     * - Dark/light mode support
     * - Material Design 3 styling
     *
     * @param context Android context
     * @param threats List of detected security threats
     * @param onExitClick Callback for when exit button is clicked
     * @return View to be displayed in the bottom sheet
     */
    fun createSecurityAlertView(
        context: Context,
        threats: List<String>,
        onExitClick: () -> Unit
    ): View {

        // Root container with rounded corners
        val rootContainer = FrameLayout(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            // Apply rounded corners to the container itself
            val roundedBackground = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadii = floatArrayOf(
                    DesignTokens.dpToPx(context, DesignTokens.Dimensions.CORNER_RADIUS_LG).toFloat(), // top-left
                    DesignTokens.dpToPx(context, DesignTokens.Dimensions.CORNER_RADIUS_LG).toFloat(),
                    DesignTokens.dpToPx(context, DesignTokens.Dimensions.CORNER_RADIUS_LG).toFloat(), // top-right
                    DesignTokens.dpToPx(context, DesignTokens.Dimensions.CORNER_RADIUS_LG).toFloat(),
                    0f, 0f, // bottom-right (no rounding)
                    0f, 0f  // bottom-left (no rounding)
                )
                setColor(DesignTokens.getSurfaceColor(context))
            }
            background = roundedBackground
        }

        // Main content wrapper (vertically stacked)
        val mainWrapper = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        // Top section with icon and header (non-scrollable)
        val headerSection = createHeaderSection(context)
        mainWrapper.addView(headerSection)

        // Scrollable content section
        val scrollView = ScrollView(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        }

        val scrollContent = createScrollableContent(context, threats)
        scrollView.addView(scrollContent)
        mainWrapper.addView(scrollView)

        // Persistent footer with button
        val footer = createFooter(context, onExitClick)
        mainWrapper.addView(footer)

        rootContainer.addView(mainWrapper)
        return rootContainer
    }

    /**
     * Create the header section with hero icon and title.
     */
    private fun createHeaderSection(context: Context): View {
        val header = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            val paddingHorizontal = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_LG)
            val paddingTop = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_XL)
            val paddingBottom = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_MD)
            setPadding(paddingHorizontal, paddingTop, paddingHorizontal, paddingBottom)
        }

        // Hero icon (shield with warning)
        val iconContainer = FrameLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                DesignTokens.dpToPx(context, DesignTokens.Dimensions.ICON_SIZE_LG),
                DesignTokens.dpToPx(context, DesignTokens.Dimensions.ICON_SIZE_LG)
            ).apply {
                bottomMargin = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_MD)
            }
        }

        // Icon background with error color
        val iconBackground = View(context).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            val drawable = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(DesignTokens.getErrorContainerColor(context))
            }
            background = drawable
            alpha = 0.2f
        }
        iconContainer.addView(iconBackground)

        // Icon (using Unicode shield character)
        val icon = TextView(context).apply {
            text = "🛡️"
            textSize = 32f
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        iconContainer.addView(icon)
        header.addView(iconContainer)

        // Title
        val title = TextView(context).apply {
            text = "Security Alert"
            textSize = DesignTokens.Typography.TEXT_SIZE_HEADLINE
            setTextColor(DesignTokens.getErrorColor(context))
            setTypeface(null, DesignTokens.Typography.FONT_WEIGHT_BOLD)
            gravity = Gravity.CENTER_HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_XS)
            }
        }
        header.addView(title)

        return header
    }

    /**
     * Create the scrollable content section with message and threats.
     */
    private fun createScrollableContent(
        context: Context,
        threats: List<String>
    ): View {
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            val paddingHorizontal = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_LG)
            setPadding(paddingHorizontal, 0, paddingHorizontal, 0)
        }

        // Main message
        val message = TextView(context).apply {
            text = "This device has failed security checks and cannot run this app."
            textSize = DesignTokens.Typography.TEXT_SIZE_BODY_LG
            setTextColor(DesignTokens.getOnSurfaceColor(context))
            setLineSpacing(0f, DesignTokens.Typography.LINE_HEIGHT_NORMAL)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_LG)
            }
        }
        content.addView(message)

        // Threats section header
        val threatsHeader = TextView(context).apply {
            text = "Detected Issues:"
            textSize = DesignTokens.Typography.TEXT_SIZE_BODY
            setTextColor(DesignTokens.getOnSurfaceVariantColor(context))
            setTypeface(null, DesignTokens.Typography.FONT_WEIGHT_MEDIUM)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_SM)
            }
        }
        content.addView(threatsHeader)

        // Threats list with cards
        threats.forEach { threat ->
            val threatCard = createThreatCard(context, threat)
            content.addView(threatCard)
        }

        // Footer warning message
        val warningText = TextView(context).apply {
            text = "For your security, this app cannot continue. These checks protect your data and ensure a safe experience."
            textSize = DesignTokens.Typography.TEXT_SIZE_BODY
            setTextColor(DesignTokens.getOnSurfaceVariantColor(context))
            setLineSpacing(0f, DesignTokens.Typography.LINE_HEIGHT_NORMAL)
            alpha = DesignTokens.Opacity.MEDIUM
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_LG)
            }
        }
        content.addView(warningText)

        return content
    }

    /**
     * Create a threat card with icon and text.
     */
    private fun createThreatCard(
        context: Context,
        threat: String
    ): View {
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_SM)
            }
            val padding = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_MD)
            setPadding(padding, padding, padding, padding)

            // Card background with proper opacity applied to color, not view
            val errorContainerColor = DesignTokens.getErrorContainerColor(context)
            val drawable = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = DesignTokens.dpToPx(context, DesignTokens.Dimensions.CORNER_RADIUS_SM).toFloat()
                // Apply alpha to color directly for better readability
                val alpha = (0.15 * 255).toInt() // 15% opacity for subtle background
                val alphaColor = (alpha shl 24) or (errorContainerColor and 0x00FFFFFF)
                setColor(alphaColor)
            }
            background = drawable
        }

        // Warning icon
        val icon = TextView(context).apply {
            text = "⚠️"
            textSize = DesignTokens.Typography.TEXT_SIZE_BODY_LG
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                rightMargin = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_SM)
            }
        }
        card.addView(icon)

        // Threat text
        val text = TextView(context).apply {
            text = threat
            textSize = DesignTokens.Typography.TEXT_SIZE_BODY
            setTextColor(DesignTokens.getOnErrorContainerColor(context))
            setLineSpacing(0f, DesignTokens.Typography.LINE_HEIGHT_NORMAL)
            layoutParams = LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f // Weight for flexible width
            )
        }
        card.addView(text)

        return card
    }

    /**
     * Create the persistent footer with exit button.
     */
    private fun createFooter(
        context: Context,
        onExitClick: () -> Unit
    ): View {
        val footer = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            val padding = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_LG)
            setPadding(padding, padding, padding, padding)

            // Top divider
            val divider = View(context).apply {
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    DesignTokens.dpToPx(context, 1)
                ).apply {
                    bottomMargin = DesignTokens.dpToPx(context, DesignTokens.Spacing.SPACE_MD)
                }
                setBackgroundColor(DesignTokens.getOutlineColor(context))
                alpha = 0.12f
            }
            addView(divider)
        }

        // Exit button (Material Design filled button)
        val exitButton = Button(context).apply {
            text = "Exit App"
            textSize = DesignTokens.Typography.TEXT_SIZE_BODY_LG
            setTextColor(DesignTokens.getOnErrorColor(context))
            setTypeface(null, DesignTokens.Typography.FONT_WEIGHT_MEDIUM)
            isAllCaps = false // Material Design 3 uses sentence case
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                DesignTokens.dpToPx(context, DesignTokens.Dimensions.MIN_TOUCH_TARGET)
            )

            // Button background with rounded corners
            val drawable = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = DesignTokens.dpToPx(context, DesignTokens.Dimensions.CORNER_RADIUS_MD).toFloat()
                setColor(DesignTokens.getErrorColor(context))
            }
            background = drawable

            elevation = DesignTokens.Dimensions.ELEVATION_SM
            stateListAnimator = null // Remove default state animator
            setOnClickListener { onExitClick() }
        }
        footer.addView(exitButton)

        return footer
    }
}
