# Offline Support

## What it does
- Shows a friendly offline page when the device has no connectivity.
- Lets that page trigger a native retry so users can get back to their last intended page once they reconnect.
- Surfaces connectivity signals to your web code via a React hook, so you can adapt UI (banners, pause live data, etc.) while native handles the fallback view.

## How to set it up
- Add `public/offline.html` to your web app. Keep it self contained (avoid external assets or API calls) and lightweight.
- Add a clear “Retry” control that links to `catalyst://retry`. Both Android and iOS listen for this and will reload the last target URL if the device is online; if still offline they keep the offline page visible.
- Use the page to explain what users should do (“Check connection, then tap Retry”), and keep styling minimal so it loads instantly from the bundle.

## How native uses it (high level)
- Build time: the native build copies `public/offline.html` into each app bundle. If the file is missing, no fallback is bundled.
- Launch path: before the first request (including app open and notification taps), both platforms check connectivity. If offline, they render your bundled offline page instead of hitting the network.
- Retry flow: when your offline page opens `catalyst://retry`, native checks connectivity and reloads the last intended URL if back online.

## Hook for live status: `useNetworkStatus()`
- Purpose: simple React hook that reports connectivity from the native bridge: `{ online: boolean, type: 'wifi'|'cellular'|...|null, error }`.
- Why use it: drive in-app banners, pause/resume live data, or disable actions while offline—while native still owns the full-screen offline fallback.
- Example:
  ```jsx
  import { useNetworkStatus } from "catalyst-core/native"

  export function ConnectivityBanner() {
      const { online, type } = useNetworkStatus()
      if (online) return null
      return <div>Offline{type ? ` (${type})` : ""}. Reconnect and tap Retry.</div>
  }
  ```

## Quick verification
- With `public/offline.html` present, launch the app in airplane mode: you should see your offline page immediately.
- While on the offline page, re-enable network and tap your `catalyst://retry` control: it should reload the last intended URL.
- In your React code, log `useNetworkStatus()` and toggle airplane mode to confirm you receive connectivity updates.
