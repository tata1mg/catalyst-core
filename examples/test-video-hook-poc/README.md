# test-video-hook-poc

Example app for testing catalyst-core hooks — camera, video stream, file picker, haptics, notifications, device info, and more.

This app lives inside `catalyst-core/examples/` and is **not published to npm**. It exists so you can test changes to catalyst-core locally against a real Catalyst app before releasing.

---

## Prerequisites

### catalyst_mcp

This example uses `catalyst_mcp` to auto-generate your local config files via `prompt.txt`. Set it up once before running the setup steps below.

```bash
npx create-catalyst-app@latest catalyst-mcp
```

This installs and registers the Catalyst MCP server in Claude Code. Once done, Claude Code will have access to `check_config` and other catalyst tools needed by the setup prompt.

---

## First-time setup

### 1. Generate your local config files

Config files (`config/config.json`, `google-services.json`, `GoogleService-Info.plist`) are gitignored because they contain machine-specific values (your local IP, SDK paths, bundle IDs). You need to generate them once.

Open `prompt.txt` in this folder and run it with Claude Code (or any AI assistant with MCP access):

```bash
# From inside this folder, open Claude Code and paste the contents of prompt.txt
# The AI will auto-detect your environment and generate all three config files
```

The prompt uses `catalyst_mcp` to discover your local IP, Android SDK, available simulators, and emulators — so it only asks you for things it can't auto-detect (package name, bundle ID, app name).

### 2. Install dependencies

```bash
npm install
```

### 3. Sync local catalyst-core build

This step builds catalyst-core from source and injects it into this app's `node_modules` — replacing the npm-installed version with your local changes.

```bash
npm run sync-core
```

What it does:
1. Clears `packages/catalyst-core/dist` (removes stale build)
2. Clears `node_modules/catalyst-core` (removes stale installed copy)
3. Builds catalyst-core fresh
4. Copies the full package into `node_modules/catalyst-core`

Run this every time you make changes to catalyst-core.

---

## Running the app

```bash
# Start the web dev server
npm start

# Build the native app (Android)
npm run buildApp:android

# Build the native app (iOS)
npm run buildApp:ios

# Launch emulator/simulator
npm run setupEmulator:android
npm run setupEmulator:ios
```

---

## Workflow for testing catalyst-core changes

```
Edit catalyst-core source
        ↓
npm run sync-core   (from this folder)
        ↓
npm start / buildApp
        ↓
Test in emulator/simulator
```

---

## Testing a specific catalyst-core version

To test against a published npm version instead of local source, change the version in `package.json`:

```json
"catalyst-core": "0.1.0-canary.7"
```

Then run `npm install` (skip `sync-core`).

To switch back to local source, run `npm run sync-core` again — it overwrites whatever is in `node_modules/catalyst-core`.

---

## What's in this app

| Panel | Hook tested |
|---|---|
| Video Stream | `useVideoStream` — start/stop, QR scan, zoom, torch, flip, FPS control |
| Camera | `useCamera` — capture photo, web fallback |
| Camera Permission | `useCameraPermission` |
| File Picker | `useFilePicker` |
| Haptic | `useHaptic` |
| Network | `useNetwork` |
| Notifications | `useNotification` |
| Safe Area | `useSafeArea` |
| Device Info | `useDeviceInfo` |
| Data Protection | `useDataProtection` |
| Intent | `useIntent` |
| Google Sign-In | `useGoogleSignIn` |

---

## Troubleshooting

**`npm run sync-core` fails at build step**
Check that you are running from inside `examples/test-video-hook-poc/`. The script resolves the repo root relative to its own location.

**App shows stale catalyst-core code after sync**
Hard-reload the simulator/emulator. Metro/webpack may have cached the old bundle — restart the dev server (`npm start`).

**`check_config` errors about LOCAL_IP**
Your machine IP may have changed (Wi-Fi reconnect). Re-run the config prompt or manually update `WEBVIEW_CONFIG.LOCAL_IP`, `NODE_SERVER_HOSTNAME`, `WEBPACK_DEV_SERVER_HOSTNAME`, `API_URL`, and `PUBLIC_STATIC_ASSET_URL` in `config/config.json`.

**Android build fails — SDK not found**
Verify `WEBVIEW_CONFIG.android.sdkPath` in `config/config.json` matches your actual SDK location. Common paths: `~/Android/` or `~/Library/Android/sdk/`.
