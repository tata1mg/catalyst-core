---
title: Folder Structure
slug: folder-structure
id: folder-structure
---

# Folder Structure

This page provides an overview of the project structure of a Catalyst app.

---

## Top-Level Folders

| Folder | Purpose |
|--------|---------|
| `config` | Configuration keys (environment variables for server and client) |
| `src` | Application source code |
| `client` | Client app entry point |
| `server` | Server code (middlewares, controllers, APIs) |
| `public` | Static assets served as-is (favicons, manifests, `offline.html`) |
| `build` | Bundled output (generated after build) |
| `credentials` | Signing files for native releases, in `credentials/android/` and `credentials/ios/`. Created by the first Android release. Kept out of git |
| `build-output` | Native builds: the shareable debug APK in `build-output/android/debug/`, and signed store builds in `build-output/<platform>/<version>-<build>/`. Kept out of git |
| `.catalyst` | Per-machine CLI state in `.catalyst/local.json`, such as where `npm run android` and `npm run ios` run the app and the dev server they started. Kept out of git |

New apps from `create-catalyst-app` list `credentials/`, `build-output/` and `.catalyst/` in `.gitignore`. Back up `credentials/android/` somewhere safe: Google Play only accepts updates signed with the upload key in it.

In Catalyst `0.3.x`, `build/client` contains browser assets and `build/server` contains the Vite SSR
renderer. Legacy `0.2.x` applications use the webpack-era output layout documented in their
deployment configuration.

---

## Configuration Files

| File | Purpose |
|------|---------|
| `config/config.json` | Environment variables for server and client |
| `src/js/routes/index.js` | Route definitions |
| `src/js/store/index.js` | Redux store configuration (optional) |
| `client/index.js` | Client app entry point |
| `server/document.js` | HTML document template |
| `server/index.js` | Server lifecycle hooks |
| `server/server.js` | Express middlewares |

---

## Static Assets

| Directory | Purpose |
|-----------|---------|
| `src/static/css` | Global stylesheets |
| `src/static/fonts` | Font files |
| `public/` | Static files served at root path |
| `public/icon.png` | The app icon for Android and iOS. A square PNG of at least 1024x1024 pixels, with no transparency for an iOS release. Per-density icons in `public/android/appIcons` or `public/ios/appIcons` take its place on that platform |
| `public/splashscreen.html` | The animated HTML splash for universal apps, shown after the native splash image until the first page loads. Delete it for the image-only splash |
| `public/offline.html` | The page a universal app shows when it cannot reach the server |
