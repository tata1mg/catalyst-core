---
title: Catalyst Version Upgrades
slug: 0.0.1-beta.4
id: 0.0.1-beta.4
---

# Catalyst Version Upgrades

## Upgrading From 1.1.x To 1.2.0

`1.2.0` builds, runs and releases the Android and iOS apps from the CLI, without opening Android Studio or Xcode. The web runtime has no breaking changes. Set `catalyst-core` to `1.2.0`, reinstall, then run `npm audit fix` so your lockfile picks up the patched `body-parser`, whose minimum is now `^1.20.9`:

```bash
npm install catalyst-core@1.2.0
npm audit fix
```

Universal apps need the follow-ups below. A web-only app can stop here.

### New Scripts

Apps created from 1.2.0 run and release the native app with one script each. Add the same lines to an older app's `package.json`:

```json title="package.json"
{
  "scripts": {
    "android": "catalyst buildApp:android",
    "ios": "catalyst buildApp:ios",
    "android:release": "catalyst buildApp:android --release",
    "ios:release": "catalyst buildApp:ios --release"
  }
}
```

- `npm run android` and `npm run ios` check the toolchain and install what is missing after asking, start the dev server when nothing answers on `NODE_SERVER_PORT`, then build, install and open the app. On Android each run also saves the app as an APK in `build-output/android/debug/`; see [Share a test build](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp#share-a-test-build).
- `npm run android:release` writes a signed App Bundle, a signed APK and `upload_certificate.pem` to `build-output/android/<version>-<build>/`.
- `npm run ios:release` writes a signed IPA and a zip of its dSYMs to `build-output/ios/<version>-<build>/`.

The old scripts keep working. `buildApp:android` and `buildApp:ios` run the same commands as `android` and `ios`, so an app without the new scripts builds a release with `npm run buildApp:android -- --release` or `npm run buildApp:ios -- --release`. `setupEmulator:android` and `setupEmulator:ios` still work but are optional, because each build installs what it needs. They only install the toolchain and an emulator or simulator, and change nothing in the app.

### App Id, Name And Website

A native app needs three keys at the top of `WEBVIEW_CONFIG`:

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "appId": "com.acme.shop",
    "appName": "Acme Shop",
    "url": "https://shop.acme.com"
  }
}
```

`appId` is the Android application id and the iOS bundle id. `android.packageName` and `ios.bundleIdentifier` (then `ios.appBundleId`) win over it, so an app already in a store can keep the ids it shipped with. `appName` is the name under the icon and wins over `android.appName` and `ios.appName`. `url` is the deployed site a release build opens. Debug builds ignore it and load the dev server. An app without `url` keeps working: a release then uses `LOCAL_IP`, `port` and `useHttps` as before.

A release run in a terminal asks once for an app id or website that is missing or still a placeholder, and saves the answer to `config/config.json`. See [Universal App Deployment](/content/Deployment/universal-app-deployment#configure-the-app).

### Config Rewrite

Before 1.2.0, the emulator setup wrote this machine's LAN address into `config/config.json`. The first debug build on 1.2.0 puts `localhost` back where that address was saved and prints each change. It changes:

- any value equal to one of this machine's current IP addresses, such as `LOCAL_IP`, `NODE_SERVER_HOSTNAME` or `PUBLIC_STATIC_ASSET_URL`, and any `http://` URL on one of those addresses;
- a private `LOCAL_IP` that `NODE_SERVER_HOSTNAME` also holds. That is usually the address this machine had on another network, so every value on it goes back to `localhost` too.

Other addresses, such as a staging server on your network, are left as they are, and so is `url`. The rewrite runs once per checkout and records that in `.catalyst/local.json`. It never runs for a release build or when `CI` is set, and it leaves the file alone when `allowPrivateHost` is `true`. Review the change and commit it.

To fix a stale address by hand, set `LOCAL_IP` and `NODE_SERVER_HOSTNAME` to `localhost`. Debug builds work out how the emulator, simulator or phone reaches the dev server. If you start the dev server yourself for a phone on the same Wi-Fi, use this machine's current IP instead. See [How the app reaches the dev server](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp#how-the-app-reaches-the-dev-server).

### Breaking Changes

An iOS bundle id with an underscore fails. Android allows `_` in an application id and iOS does not, so an `appId` such as `com.acme.my_shop` stops every iOS build with [NATIVE-010](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-010.md). Set `ios.bundleIdentifier` to an id without the underscore, such as `com.acme.myshop`. It wins over `appId` on iOS.

A release build checks the app id and the website. A placeholder app id, meaning any `com.example.` id or one of the template ids `io.yourname.androidproject` and `com.catalyst.framework.app`, fails with [NATIVE-003](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-003.md). A website on `localhost`, a private or link-local address, a `.local` name or this machine's own address fails with [NATIVE-001](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-001.md), because users' devices cannot reach it. An internal app on a private network can set `allowPrivateHost` to `true`. Run in a terminal, the build asks for the value instead of failing. In CI or from an agent it fails.

Debug builds no longer install on a connected phone by themselves. With a phone connected, a run in a terminal asks where to run the app and remembers the answer for this machine in `.catalyst/local.json`. Without a terminal the app always runs on the emulator or simulator. Pass `--device` to go straight to the phone:

```bash
npm run android -- --device
npm run ios -- --device
```

`config/config.json` is rewritten once, as described under Config Rewrite.

### Signing Files

Signing files live in `credentials/android/` and `credentials/ios/`, never in `config/config.json`. Add `credentials/` to your `.gitignore`; the first Android release adds it when it is missing.

The first Android release run in a terminal creates the upload key in `credentials/android/` after asking. Google Play only accepts updates signed with that key, so back it up right away:

```bash
npx catalyst credentials:export android
```

The command prints the folder as one value. Keep it in a password manager; the same value is the `CATALYST_ANDROID_CREDENTIALS` secret for CI. Passwords in `android.keystoreConfig` or `android.keystore` are no longer used. Catalyst 1.1.0 and earlier shipped a shared keystore in the Android template and generated a new key on every release build, so if you uploaded a build signed with either, request an upload key reset in Play Console and put the new key in `credentials/android/`. The app now targets Android API 36, and its native libraries are aligned for 16 KB memory pages.

On a Mac signed in to Xcode with your team's Apple account, `npm run ios:release` needs no signing files. CI uses an App Store Connect API key or a `.p12` and provisioning profile in `credentials/ios/`, exported as `CATALYST_IOS_CREDENTIALS`. [Set up signing](/content/Deployment/ios-production-release#2-set-up-signing) lists the order the build tries them in.

The version comes from `version` in `package.json`. The build number is `CATALYST_BUILD_NUMBER` when set, and otherwise the number of minutes since 2024-01-01 00:00 UTC. An app that set `WEBVIEW_CONFIG.ios.version` keeps that version with a deprecation warning. See [Version and Build Number](/content/Deployment/universal-app-deployment#version-and-build-number).

### Other Changes

New apps get a new starter page, an animated HTML splash screen that is on by default (`splashScreen.minDuration` is `7000`), and a restyled offline page. Their `server/index.js` exports an empty stub for `preServerInit` and each per-request hook, in the order Catalyst calls them. Existing apps keep their own files.

Catalyst reads each hook in `server/index.js` by its named export. A hook placed inside `export default { ... }` is never called, and startup now prints a warning naming it. Export each hook by name instead.

`MetaTag` now waits for a `split()` route's chunk to load before it replaces the head tags, so the server's tags are no longer removed before the route's `setMetaData` is available. `npm run start` prints a hint when `NODE_SERVER_HOSTNAME` is not an address of this machine.

## Upgrading From 1.0.x To 1.0.2

`1.0.2` has no breaking API changes. Set `catalyst-core` to `1.0.2` in `package.json` and reinstall. Two changes can need a follow-up:

- `react-helmet-async` is no longer a dependency of `catalyst-core`. `MetaTag` now renders route metadata through React 19's own `<head>` support, so `setMetaData` works as before. If your app imports `react-helmet-async` directly, add it to your own `dependencies`.
- `catalyst serve` refuses to serve a build made with different `PUBLIC_STATIC_ASSET_URL`, `PUBLIC_STATIC_ASSET_PATH` or `CLIENT_ENV_VARIABLES` values than the current `config/config.json`. If a deploy changes those values after the build, rebuild before serving. See [CLI Reference](../16-CLI.md).

New apps from `create-catalyst-app` declare `"type": "module"`, and the Tailwind template names its config `postcss.config.cjs`. Existing apps need no change, because `catalyst-core` loads either `postcss.config.cjs` or `postcss.config.js`. If you add `"type": "module"` to an existing app yourself, rename a CommonJS `postcss.config.js` to `postcss.config.cjs`.

The root entry gains one export, `useRouterState`, so it now exports nine names. See [Hooks](../11-API%20Reference/01-Hooks.md). Existing imports are unaffected.

The release also adds two opt-in features: an animated [HTML splash screen](../02-Guides%20and%20Tutorials/02-First%20Universal%20App/03-Configuration.mdx) for universal apps, and experimental [WebMCP](../20-WebMCP.md) support for exposing app actions to in-browser agents.

## Upgrading From 0.3.x To 1.0.0

Catalyst `1.0.0` freezes the public API. `0.3.0-beta.5` upgrades directly. `0.3.0-beta.1` to
`0.3.0-beta.4` used React Router 6 through `react-router-dom`, so those releases also move to React
Router 7, as described under Runtime Dependencies. On `0.2.x`, work through the sections below
first. Removed names fail at build time rather than resolving to `undefined`. Three changes are
not caught by a build: the React Router check runs at server startup, `RouterProvider` must come
from `react-router/dom` (see Client Entry), and the hook error fields under Hook Errors are
renamed.

Work through it in this order:

1. Switch to Node `22.12` or later.
2. Update `package.json` as shown under Runtime Dependencies, then reinstall.
3. Move router imports and replace removed names, as described under Imports From The Root Entry,
   Client Entry and Removed Export Paths.
4. Update code that reads hook errors, as described under Hook Errors.
5. Run `npm run build`, then `npm run start`, and fix anything either reports.

To have an agent run the upgrade through the [Catalyst MCP server](../15-MCP.md), ask it to call
`sync_knowledge_base` first. The knowledge base installed with `0.3.0-beta.5` predates `1.0.0`;
after the sync, `query_knowledge` returns these steps.

### Runtime Dependencies

```json title="package.json"
{
  "dependencies": {
    "catalyst-core": "1.0.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-router": "^7.18.2"
  }
}
```

React Router is now a peer dependency of `catalyst-core`; the application declares it directly,
as shown above. The server verifies the resolved version at startup and fails with an error
naming the required range if it is missing or outside `^7.18.2`. TypeScript applications also
need `@types/react` `^19.0.0`.

`catalyst-core` no longer installs `react-router-dom`. Change imports from it to `react-router`,
except `RouterProvider`, which comes from `react-router/dom`.

Node `22.12` is the minimum. Nothing checks the version at startup; on Node 20, importing
`catalyst-core/hooks` or `catalyst-core/WebBridge` fails with `ERR_REQUIRE_ESM`.

### Imports From The Root Entry

In `1.0.0` the root entry exports exactly eight names: `RouterDataProvider`, `useCurrentRouteData`,
`useRouterData`, `MetaTag`, `split`, `hydrationReady`, `Head`, and `Body`. `1.0.2` adds a ninth,
`useRouterState`. React Router is no
longer re-exported, so router names move to their own import:

```javascript
// before
import { useCurrentRouteData, useParams, Link } from "catalyst-core"

// after
import { useCurrentRouteData } from "catalyst-core"
import { useParams, Link } from "react-router"
```

The default export is gone; `split` is named only:

```javascript
// before
import split from "catalyst-core"

// after
import { split } from "catalyst-core"
```

These previously reachable names are now internal and have no replacement: `RouterContext`,
`serverDataFetcher`, `mergeHeadElements`, `deleteHeadTagsByDataAttribute`, `getMetaData`,
`useNavigateWithTransition`, and `sanitizeFilePickerOptions` (from `catalyst-core/hooks`). If your
application depends on one of them, open an issue describing the use case before upgrading.

### Client Entry

`client/index.js` must import `RouterProvider` from `react-router/dom`, not from `react-router`.
The `react-router/dom` build passes React DOM's `flushSync` into the router, which view
transitions and `flushSync` navigations depend on. Importing it from `react-router` renders the
same tree without any error, but silently skips that.

```javascript title="client/index.js"
// before
import { RouterProvider, hydrationReady } from "catalyst-core"

// after
import { hydrationReady } from "catalyst-core"
import { RouterProvider } from "react-router/dom"
```

### Removed Export Paths

- `catalyst-core/caching` is removed; the caching feature was withdrawn with no replacement.
- `catalyst-core/document` is removed; import `Head` and `Body` from the root entry.

### Native Hook Keys

The native hooks now share one set of key names: `data`, `loading`, `error`, `isNative`, `isWeb`,
and `execute` for single-action hooks. The old names keep working as deprecated aliases until
2.0, but new code should use the canonical keys. Your editor shows the deprecated names struck
through.

| Hook                        | Deprecated alias | Use instead     |
| --------------------------- | ---------------- | --------------- |
| `useCamera`                 | `photo`          | `data`          |
| `useCamera`                 | `isLoading`      | `loading`       |
| `useCamera`                 | `clearPhoto`     | `clear`         |
| `useCameraPermission`       | `permission`     | `data`          |
| `useCameraPermission`       | `isLoading`      | `loading`       |
| `useCameraPermission`       | `request`        | `execute`       |
| `useDeviceInfo`             | `deviceInfo`     | `data`          |
| `useFilePicker`             | `isLoading`      | `loading`       |
| `useFilePicker`             | `clearFile`      | `clear`         |
| `useIntent`                 | `isLoading`      | `loading`       |
| `useIntent`                 | `reset`          | `clear`         |
| `useNativeTransition`       | `transitioning`  | `loading`       |
| `useNotificationPermission` | `permission`     | `data`          |
| `useNotificationPermission` | `isLoading`      | `loading`       |
| `useNotification`           | `execute`        | `scheduleLocal` |
| `useNotification`           | `schedule`       | `scheduleLocal` |

Hooks that wrap several operations expose named functions and no `execute`: `useVideoStream`,
`useDataProtection`, and `useNativeTransition`. `useNotification` is also multi-action; its
`execute` and `schedule` aliases predate this rule and stay frozen. Read-only hooks report state
and have no action functions: `useNetworkStatus`, `useDeviceInfo`, and `useSafeArea`. See
[Hooks](../11-API%20Reference/01-Hooks.md) for the full surface.

### Hook Errors

Hook failures are now `CatalystError` values carrying a `RUNTIME-NATIVE-*` code, a message, a
category, a suggested action, a documentation link, and the originating platform error as
`cause`. Two hooks return no `error` key by design: `useNativeTransition` and `useSafeArea`. On
`useDeviceInfo` and `useNetworkStatus`, `error` stays a plain string until 2.0.

The error fields changed with it. `action` is now `suggestedAction`, `nativeError` is now `cause`,
and `recoverable` and `timestamp` are gone. `code` values are registry codes such as
`RUNTIME-NATIVE-001` instead of names such as `PERMISSION_DENIED`, so compare against
`ERROR_CODES` from `catalyst-core/errors` rather than string literals. `category` is now
`RUNTIME-NATIVE` instead of values such as `PERMISSION`, `NETWORK` and `FILE_SYSTEM`.
`CatalystError` extends `Error`, so `JSON.stringify(error)` no longer includes the message; log
`error.message` explicitly, or use the `code` and `docUrl` fields.

### App Contract Reporting

Missing or malformed app-contract exports are reported once at startup, naming the file, the
export, and what the application must provide. Reporting is not fatal: startup continues instead
of failing later inside an unrelated render. An application that satisfies the contract sees no
change.

The configuration checks are stricter. `catalyst start`, `build` and `serve` now exit before
starting when `config/config.json` is missing one of `NODE_SERVER_HOSTNAME`, `NODE_SERVER_PORT`,
`BUILD_OUTPUT_PATH`, `PUBLIC_STATIC_ASSET_PATH`, `PUBLIC_STATIC_ASSET_URL` or
`CLIENT_ENV_VARIABLES`, or when `package.json` is missing one of the `@api`, `@containers`,
`@server`, `@config`, `@css` or `@routes` module aliases. Apps created from the templates already
have all of them. The contract is documented under
[File Conventions](../11-API%20Reference/03-File-Conventions.md).

---

## Upgrading From 0.2.x To 0.3.0-beta.1

Catalyst `0.3.x` migrates the web runtime from webpack/CommonJS to Vite/ESM. Treat the upgrade as a
coordinated package, application-entry, and deployment change.

### Runtime Dependencies

```json title="package.json"
{
  "dependencies": {
    "catalyst-core": "0.3.0-beta.1",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  }
}
```

Remove `@tata1mg/router` and `@loadable/component`. Keep React and React DOM pinned exactly to
`19.0.0` so the application and framework resolve one runtime.

### Router And Hydration

Import Catalyst router APIs from `catalyst-core`. Replace loadable components with `split()`, and
replace `loadableReady()` with `hydrationReady()` before `hydrateRoot()`. On `0.3.x`,
`RouterProvider` comes from `catalyst-core`; `1.0.0` moves it to `react-router/dom`, as described
above.

```javascript
import { RouterProvider, hydrationReady } from "catalyst-core"
import { hydrateRoot } from "react-dom/client"

window.addEventListener("load", () => {
    hydrationReady().then(() => {
        hydrateRoot(document.getElementById("app"), <RouterProvider router={router} />)
    })
})
```

### Build And Deployment

- Move project plugins to the Vite `buildConfig.js` contract with `clientPlugins` and `ssrPlugins`.
- Use `start` for development and `build` followed by `serve` for production validation.
- Remove `devBuild` and `devServe`.
- Serve browser assets from `build/client` and load the renderer from `build/server`.
- Copy `dist`, `bin`, and `package.json` together when testing a local Catalyst package.
- Test `offline: true` routes under `build` plus `serve`; service workers are disabled under `start`.

See [Vite Customization](../02-Guides%20and%20Tutorials/12-Vite-Customization.md) and
[Code Splitting](../07-Lazy%20Loading/01-Code-Splitting.md) for the current APIs.

---

## Legacy Upgrade: 0.0.1-beta.3 To 0.0.1-beta.4

### Changes

- Implemented dynamic metadata for nested routing.
- Dev build and dev serve configurations for a smoother development experience.
- `metadataFunction` is deprecated and has been renamed to `setMetaData`.
- ESLint security rules for improved code security.
- Security audit conducted on all packages.
- Removed Babel packages already included in the Babel preset.
- Updated router version to support nested routing.
- Redundant Babel packages removed, reducing dependencies.
- Updated documentation to reflect the latest changes.

## Changes required to migrate

1. `metadataFunction` is deprecated and has been renamed to `setMetaData`. You need to change the name of metaDataFunction to setMetaData when defining it in the container.

``` jsx title="src/js/containers/Home/Home.js"
import React from "react"

function HomePage() {
    return <div>Homepage</div>
}

const setMetaData = (apiResponse) => {
    return [
        <title>Home Page</title>,
        <meta name="description" content="Free Web tutorials"/>
    ]
}

HomePage.setMetaData = setMetaData
export default HomePage
```

2. The Dev build and Dev serve configurations enhance the development experience. The devBuild and devServe commands function similarly to build and serve, respectively, with the distinction that they locally serve your assets during development when they are not stored on a CDN. To be able to use devBuild and devServe, add this command to your package.json file.

``` jsx title="package.json"
{
  "scripts": {
    "start": "catalyst start",
    "build": "catalyst build",
    "serve": "catalyst serve",
    "devBuild": "catalyst devBuild",
    "devServe": "catalyst devServe"
  }
}
```

3. ESLint support has been added to the project with basic configuration. Please create a .eslintrc and .eslintignore file inside your project directory. Then, include the ESLint command in the "scripts" section and the necessary packages in the "devDependencies" section of your package.json file. Here's an example:


``` json title=".eslintrc"
{
    "rules": {
        "react-hooks/exhaustive-deps": "error" // Checks effect dependencies
    },
    "env": {
        "browser": true,
        "es6": true,
        "node": true
    },
    "extends": [
        "eslint:recommended",
        "plugin:react/recommended",
    ],
    "parserOptions": {
        "sourceType": "module",
        "ecmaVersion": "latest"
    },
    "plugins": [
        "react",
        "react-hooks"
    ],
     "settings": {
        "react": {
            "pragma": "React",
            "version": "detect"
        }
    }
}
```

``` title=".eslintignore"
**/build/*
```

```jsx title="package.json"
 "scripts: {
    "lint": "eslint .",
 }
 "devDependencies": {
        "eslint": "^8.26.0",
        "eslint-plugin-react": "^7.34.1",
        "eslint-plugin-react-hooks": "^4.6.0"
    },
``` 

4. Nested routing support has been added to the router. To enable nested routing support, please update your router package to the specified version below and replace your src/js/routes/utils.js with below code according to your template. 

```jsx title="package.json"
"dependencies": {
    "@tata1mg/router": "^0.0.1-beta.1"
}
``` 

#### None template
```jsx title="src/js/routes/utils.js"

import React from "react"
import { RouterDataProvider, MetaTag } from "@tata1mg/router"
import App from "@containers/App"
import routes from "./index.js"

/**
 * Making the routes array compatible with the format accepted by createBrowserRouter
 * API on the client side
 * https://reactrouter.com/en/main/routers/create-browser-router
 */

export const preparedRoutes = ({ routerInitialState }) => {
    const getPreparedRoutes = (routes) => {
        return routes.map((route, index) => {
            const Component = route.component
            const routeToRender = {
                ...route,
                element: <Component key={index} />,
            }
            if (route.children) {
                routeToRender.children = getPreparedRoutes(route.children)
            }
            return routeToRender
        })
    }

    return [
        {
            element: (
                <RouterDataProvider config={{}} initialState={routerInitialState}>
                    <MetaTag />
                    <App />
                </RouterDataProvider>
            ),
            children: getPreparedRoutes(routes),
        },
    ]
}

export const getRoutes = () => {
    return routes
}
``` 

#### Redux/RTK template

```jsx title="src/js/routes/utils.js"
import React from "react"
import { RouterDataProvider, MetaTag } from "@tata1mg/router"
import App from "@containers/App"
import routes from "./index.js"

/**
 * Making the routes array compatible with the format accepted by createBrowserRouter
 * API on the client side
 * https://reactrouter.com/en/main/routers/create-browser-router
 */

export const preparedRoutes = ({ store, routerInitialState }) => {
    const getPreparedRoutes = (routes) => {
        return routes.map((route, index) => {
            const Component = route.component
            const routeToRender = {
                ...route,
                element: <Component key={index} />,
            }
            if (route.children) {
                routeToRender.children = getPreparedRoutes(route.children)
            }
            return routeToRender
        })
    }

    return [
        {
            element: (
                <RouterDataProvider config={{}} initialState={routerInitialState} fetcherArgs={{ store }}>
                    <MetaTag />
                    <App />
                </RouterDataProvider>
            ),
            children: getPreparedRoutes(routes),
        },
    ]
}

export const getRoutes = () => {
    return routes
}
```





