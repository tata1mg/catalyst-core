---
title: Migrating a React App to Catalyst
slug: react-app-to-catalyst
id: react-app-to-catalyst
---

# Migrating a React App to Catalyst

This guide is for teams that already have a React app and want to move it onto Catalyst without starting from a fresh template. The first milestone is simple: make the app run as a Catalyst web app, then add Android and iOS packaging once the web flow is stable.

## What Changes When You Move To Catalyst

A standard React app usually has:

- a client-only entry point
- a bundler such as Vite, CRA, or custom webpack
- `npm run dev` / `npm run build` commands owned by that setup

A Catalyst app adds:

- a server-rendered runtime
- Catalyst route and fetcher conventions
- framework-owned web lifecycle commands
- optional native packaging through `WEBVIEW_CONFIG`

That means migration is not only about moving code. You also need to define the commands that the framework expects your team to use.

## Step 1: Install Catalyst In The Existing Project

Add `catalyst-core` to your project dependencies and make sure the project structure includes the Catalyst directories used by the framework:

```text
config/
src/
client/
server/
```

If you are migrating gradually, keep your existing React components and move them into the Catalyst project structure in phases.

## Step 2: Add The Missing Package Scripts

An existing React app usually does not have Catalyst commands in `package.json`. Add them explicitly so the project has a predictable web and native workflow.

```json title="package.json"
{
  "scripts": {
    "start": "catalyst start",
    "build": "catalyst build",
    "serve": "catalyst serve",
    "buildApp:android": "catalyst buildApp:android",
    "buildApp:ios": "catalyst buildApp:ios",
    "setupEmulator:android": "catalyst setupEmulator:android",
    "setupEmulator:ios": "catalyst setupEmulator:ios"
  }
}
```

Use these names as the team default. They match the framework conventions and remove ambiguity during migration.

## Step 3: Understand The Command Mapping

If your old project used commands such as `npm run dev`, `vite`, or `react-scripts start`, those no longer represent the Catalyst lifecycle.

Use this mapping instead:

| Goal | Run through npm | Underlying command |
|------|------------------|--------------------|
| Start local Catalyst development | `npm run start` | `catalyst start` |
| Create a production web build | `npm run build` | `catalyst build` |
| Serve the production web build | `npm run serve` | `catalyst serve` |
| Build and run Android debug app | `npm run buildApp:android` | `catalyst buildApp:android` |
| Build and run iOS app | `npm run buildApp:ios` | `catalyst buildApp:ios` |

If you do not want to add scripts immediately, you can run the underlying commands directly. In practice, adding the scripts early is better because the rest of the team will expect `npm run start`, `npm run build`, and `npm run serve` to exist.

Release behavior is controlled by `WEBVIEW_CONFIG.android.buildType` and `WEBVIEW_CONFIG.ios.buildType`. Do not add separate `:release` commands unless your project actually implements them.

## Step 4: Set Up `config/config.json`

Catalyst reads runtime configuration from `config/config.json`. Your old React app may have relied only on `.env` files or bundler-specific config, so this is usually the first framework-specific file you need to add.

At minimum, define the core web server values:

```json title="config/config.json"
{
  "NODE_SERVER_HOSTNAME": "0.0.0.0",
  "NODE_SERVER_PORT": 3005,
  "WEBPACK_DEV_SERVER_HOSTNAME": "0.0.0.0",
  "WEBPACK_DEV_SERVER_PORT": 3006,
  "BUILD_OUTPUT_PATH": "build",
  "PUBLIC_STATIC_ASSET_PATH": "/static/",
  "PUBLIC_STATIC_ASSET_URL": "/static/",
  "CLIENT_ENV_VARIABLES": ["API_URL"],
  "ANALYZE_BUNDLE": false,
  "API_URL": "https://api.example.com"
}
```

When you are ready for Android and iOS builds, add `WEBVIEW_CONFIG` to the same file.

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "port": "3005",
    "LOCAL_IP": "192.168.0.11",
    "appInfo": "android-24Mar2026-v1.0.0",
    "android": {
      "appName": "My App",
      "packageName": "com.example.myapp",
      "buildType": "debug",
      "sdkPath": "/Users/yourname/Library/Android/sdk",
      "emulatorName": "Pixel_8"
    },
    "ios": {
      "appName": "My App",
      "appBundleId": "com.example.myapp",
      "buildType": "Debug",
      "simulatorName": "iPhone 17 Pro"
    }
  }
}
```

For native builds, always use a reachable LAN IP in `WEBVIEW_CONFIG.LOCAL_IP`, not `localhost`.

## Step 5: Use The Correct Migration Flow

For an existing React app, the safest migration sequence is:

1. Add Catalyst dependencies, directories, and scripts.
2. Make `npm run start` work with the Catalyst server.
3. Move routes and page-level data loading into Catalyst patterns.
4. Validate `npm run build` and `npm run serve` for production web output.
5. Add `WEBVIEW_CONFIG` and native scripts only after the web app is stable.
6. Run `npm run buildApp:android` or `npm run buildApp:ios` once the WebView config is complete.

This keeps the migration incremental. Do not try to solve routing, SSR, and native packaging all at once.

## Common Mistakes During Migration

- Keeping the old React dev command and assuming it is equivalent to `catalyst start`
- Adding only web scripts and forgetting the native scripts entirely
- Using `localhost` inside `WEBVIEW_CONFIG.LOCAL_IP`
- Trying `build:android` or `build:ios` script names instead of `buildApp:android` and `buildApp:ios`
- Treating `catalyst serve` as the dev server; it is for serving the production build

## Recommended Team Workflow

Once the scripts are in place, the day-to-day commands should be:

```bash
# local development
npm run start

# production web build
npm run build

# serve the production build locally
npm run serve

# native builds
npm run buildApp:android
npm run buildApp:ios
```

Keep this workflow consistent across local development, CI, and onboarding docs.

## Related Docs

- [CLI Reference](/content/16-CLI.md)
- [Configuration API](/content/11-API%20Reference/02-Configuration.md)
- [Universal App Setup](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp)
- [Migrating from Next.js to Catalyst](/content/12-Migration/01-NextJS-to-Catalyst.md)
