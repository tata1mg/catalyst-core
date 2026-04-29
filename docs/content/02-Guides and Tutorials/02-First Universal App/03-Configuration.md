---
title: Universal App Configuration
slug: universal-app-configuration
id: universal-app-configuration
sidebar_position: 11
---

# Universal App Configuration

Configure your universal app's appearance, behavior, and security settings through `config/config.json`.

---

## App Name

Set the display name that appears in device launchers, app stores, and system settings.

### Configuration

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "android": {
      "appName": "My Awesome App"
    },
    "ios": {
      "appName": "My Awesome App"
    }
  }
}
```

### Platform-Specific Names

```json
{
  "WEBVIEW_CONFIG": {
    "android": {
      "appName": "MyApp for Android"
    },
    "ios": {
      "appName": "MyApp for iOS"
    }
  }
}
```

---

## App Icon

Customize app icons for both Android and iOS platforms.

### Android Icons

Place density-specific icons in `public/android/appIcons/`:

| Density | Filename | Size (px) |
|---------|----------|-----------|
| `mdpi` | `icon-mdpi.png` | 48 x 48 |
| `hdpi` | `icon-hdpi.png` | 72 x 72 |
| `xhdpi` | `icon-xhdpi.png` | 96 x 96 |
| `xxhdpi` | `icon-xxhdpi.png` | 144 x 144 |
| `xxxhdpi` | `icon-xxxhdpi.png` | 192 x 192 |

**Supported formats:** PNG, JPG, JPEG

**Behavior:**
- Automatically applied during build
- Missing densities use nearest available resource
- Falls back to default Catalyst icon if none provided

### iOS Icons

Place icons in `public/ios/appIcons/` following the pattern: `icon-{size}-{scale}.{ext}`

| Filename | Size (px) | Purpose |
|----------|-----------|---------|
| icon-20x20-2x.png | 40×40 | iPhone Notification |
| icon-20x20-3x.png | 60×60 | iPhone Notification |
| icon-29x29-2x.png | 58×58 | iPhone Settings |
| icon-29x29-3x.png | 87×87 | iPhone Settings |
| icon-40x40-2x.png | 80×80 | iPhone Spotlight |
| icon-40x40-3x.png | 120×120 | iPhone Spotlight |
| icon-60x60-2x.png | 120×120 | iPhone App |
| icon-60x60-3x.png | 180×180 | iPhone App |
| icon-1024x1024-1x.png | 1024×1024 | App Store |

**Supported formats:** PNG, JPG, JPEG

### File Structure

```
your-project/
├── public/
│   ├── android/appIcons/
│   │   ├── icon-mdpi.png
│   │   ├── icon-hdpi.png
│   │   ├── icon-xhdpi.png
│   │   ├── icon-xxhdpi.png
│   │   └── icon-xxxhdpi.png
│   └── ios/appIcons/
│       ├── icon-20x20-2x.png
│       ├── icon-20x20-3x.png
│       ├── icon-29x29-2x.png
│       ├── icon-29x29-3x.png
│       ├── icon-40x40-2x.png
│       ├── icon-40x40-3x.png
│       ├── icon-60x60-2x.png
│       ├── icon-60x60-3x.png
│       └── icon-1024x1024-1x.png
```

---

## Splashscreen

Configure a custom splashscreen displayed during app startup.

### Configuration

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "splashScreen": {
      "duration": 2000,
      "backgroundColor": "#ffffff",
      "imageWidth": 120,
      "imageHeight": 120,
      "cornerRadius": 20
    }
  }
}
```

### Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `duration` | number | `1000` | Display time in milliseconds |
| `backgroundColor` | string | `"#ffffff"` | Background color (hex) |
| `imageWidth` | number | `120` | Image width in dp/px |
| `imageHeight` | number | `120` | Image height in dp/px |
| `cornerRadius` | number | `20` | Corner radius (0 for square) |

### Custom Images

**Android:** Place image at `public/android/splashscreen.{png|jpg|webp}`
- Supported: PNG, JPG, WebP
- Fallback: App launcher icon

**iOS:** Place image at `public/ios/splashscreen.{png|jpg|jpeg}`
- Recommended: PNG, 512x512px
- File size: Under 1MB
- Fallback: Progress bar with loader

### Examples

#### Basic Splashscreen

```json
{
  "WEBVIEW_CONFIG": {
    "splashScreen": {
      "duration": 2000,
      "backgroundColor": "#ffffff"
    }
  }
}
```

#### Circular Icon

```json
{
  "WEBVIEW_CONFIG": {
    "splashScreen": {
      "duration": 2000,
      "backgroundColor": "#1a1a1a",
      "imageWidth": 150,
      "imageHeight": 150,
      "cornerRadius": 75
    }
  }
}
```

#### Auto-Dismiss (iOS Only)

```json
{
  "WEBVIEW_CONFIG": {
    "splashScreen": {
      "backgroundColor": "#ffffff"
    }
  }
}
```

Omitting `duration` on iOS auto-dismisses when WebView loads.

### Platform Differences

**iOS:**
- Auto-dismiss when `duration` is omitted
- Smooth fade-out animation

**Android:**
- Theme support (adapts to light/dark mode)

### Best Practices

| App Load Time | Recommendation |
|---------------|----------------|
| < 1 second | Auto-dismiss (iOS) or 1000ms |
| 1-3 seconds | 2000-3000ms |
| > 3 seconds | Auto-dismiss (iOS) or 3000ms |

---

## Whitelisting

Control network access and navigation through URL whitelisting.

### Configuration

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "accessControl": {
      "enabled": true,
      "allowedUrls": [
        "https://api.example.com/*",
        "*.example.com",
        "https://cdn.example.com/assets/*"
      ]
    }
  }
}
```

### Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable URL whitelisting |
| `allowedUrls` | string[] | `[]` | Permitted URL patterns |

**Behavior:**
- `enabled: true` - Only whitelisted URLs accessible (default deny)
- `enabled: false` - All URLs accessible (no restrictions)

### URL Patterns

#### Exact Match

```json
{
  "allowedUrls": [
    "https://api.example.com/users",
    "https://cdn.example.com/logo.png"
  ]
}
```

#### Wildcard Match

```json
{
  "allowedUrls": [
    "https://api.example.com/*",
    "https://*.example.com/api/*"
  ]
}
```

#### Subdomain Match

```json
{
  "allowedUrls": [
    "*.example.com",
    "*.cdn.example.com"
  ]
}
```

### Examples

#### API Endpoints

```json
{
  "accessControl": {
    "enabled": true,
    "allowedUrls": [
      "https://api.myapp.com/auth/*",
      "https://api.myapp.com/users/*",
      "https://api.myapp.com/data/*"
    ]
  }
}
```

#### CDN Resources

```json
{
  "accessControl": {
    "enabled": true,
    "allowedUrls": [
      "https://cdn.jsdelivr.net/*",
      "*.cloudfront.net"
    ]
  }
}
```

#### Third-Party Services

```json
{
  "accessControl": {
    "enabled": true,
    "allowedUrls": [
      "https://maps.googleapis.com/*",
      "https://api.stripe.com/*",
      "*.analytics.google.com"
    ]
  }
}
```

### How It Works

1. All network requests blocked by default when enabled
2. External links open in system browser
3. URLs matched against patterns in order
4. First matching pattern allows the request
5. No match = request blocked

### Security Benefits

- **Default deny** - Secure baseline blocks all unknown requests
- **Explicit allow** - Only whitelisted URLs accessible
- **Navigation control** - External links handled by system browser

---

## Protocol Configuration

Control whether the webview uses HTTP or HTTPS protocol.

### Configuration

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "useHttps": true
  }
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `useHttps` | boolean | `false` | Use HTTPS protocol |

**Behavior:**
- `true` - Uses HTTPS protocol
- `false` - Uses HTTP protocol

### Example: Development vs Production

```json
{
  "WEBVIEW_CONFIG": {
    "useHttps": false,  // HTTP for local development
    "accessControl": {
      "enabled": false
    }
  }
}
```

```json
{
  "WEBVIEW_CONFIG": {
    "useHttps": true,   // HTTPS for production
    "accessControl": {
      "enabled": true,
      "allowedUrls": ["https://api.myapp.com/*"]
    }
  }
}
```

---

## Complete Configuration Example

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "android": {
      "appName": "My Awesome App"
    },
    "ios": {
      "appName": "My Awesome App"
    },
    "useHttps": true,
    "accessControl": {
      "enabled": true,
      "allowedUrls": [
        "https://api.myapp.com/*",
        "https://cdn.myapp.com/*",
        "*.cloudfront.net"
      ]
    },
    "splashScreen": {
      "duration": 2000,
      "backgroundColor": "#ffffff",
      "imageWidth": 120,
      "imageHeight": 120,
      "cornerRadius": 20
    },
    "notifications": {
      "enabled": true
    }
  }
}
```

---

## Configuration Tips

1. **App Names** - Keep under 30 characters for best display
2. **Icons** - Provide all required sizes for professional appearance
3. **Splashscreen** - Match duration to actual load time
4. **Whitelisting** - Start with minimal URLs, add as needed
5. **Protocol** - Always use HTTPS in production
6. **Testing** - Test configuration on both platforms before release
7. **iOS Build Type** - Use `Debug` or `Release` with exact casing when you add `WEBVIEW_CONFIG.ios.buildType`

---

## See Also

- [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp) - Build and run commands
- [Hooks](/content/API%20Reference/hooks) - Device capabilities
- [Build Optimization](/content/14-Best%20Practices/08-Android-Build-Optimization.md) - Performance tuning
- [Cache Management](/content/Guides%20and%20Tutorials/First%20Universal%20App/Cache-Management) - Cache configuration
