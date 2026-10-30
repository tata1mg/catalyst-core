---
title: Getting Started
slug: getting-started
id: getting-started
---

# Getting Started

Use this path to go from installation to a production-ready Catalyst setup. The sequence below mirrors the framework itself: start with the web app, then add universal app delivery once the core application model is in place.

## 1. Build The Web App Foundation

1. [Installation](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/installation)
2. [Quick Start](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/quick-start)
3. [Project Structure](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/folder-structure)
4. [Configuration](/content/Guides%20and%20Tutorials/First%20Catalyst%20App/configuration)

This gives you the SSR server, route structure, fetcher model, and runtime configuration that every Catalyst app depends on.

## 2. Add Universal App Delivery

1. [First Universal App](/content/Guides%20and%20Tutorials/First%20Universal%20App/first-universal-app)
2. [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp)
3. [Universal Cache Management](/content/Guides%20and%20Tutorials/First%20Universal%20App/Cache-Management)

Use this stage when you are ready to package the same app for Android and iOS, configure `WEBVIEW_CONFIG`, and validate native runtime behavior.

The whole native path runs from the Catalyst CLI. Android Studio is not needed, and Xcode only has to be installed:

1. `npx create-catalyst-app@latest`. Every new app gets `appId` and `appName` in `config/config.json`, a placeholder `public/icon.png`, and the `android`, `ios`, `android:release` and `ios:release` scripts.
2. `npm run android` or `npm run ios` installs the missing toolchain pieces after asking, starts the dev server if needed, and runs the app on an emulator, simulator or connected phone.
3. Replace the `com.example.` app id with your own, set `WEBVIEW_CONFIG.url` to your production address, then `npm run android:release` builds the signed AAB and `npm run ios:release` the signed IPA.
4. Back up the signing files with `npx catalyst credentials:export android` and `npx catalyst credentials:export ios`; the same values are the CI secrets.

See [Releasing a Full App](/content/Deployment/releasing-a-full-app) for the first store release and [Universal App Deployment](/content/Deployment/universal-app-deployment) for the details.

## 3. Use The Core Reference

Once the first app is running, these pages become the main reference points:

- [Why Catalyst](/content/Introduction/why-catalyst)
- [Features Overview](/content/Introduction/features-overview)
- [Universal App](/content/Introduction/universal-app)
- [Configuration API](/content/11-API%20Reference/02-Configuration.mdx)
- [FAQs](/content/faqs)
