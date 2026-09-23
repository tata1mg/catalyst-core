---
title: Catalyst Version Upgrades
slug: 0.0.1-beta.4
id: 0.0.1-beta.4
---

# Catalyst Version Upgrades

## Upgrading From 0.3.x To 1.0.0

Catalyst `1.0.0` freezes the public API. Upgrade from `0.3.0-beta.5`; if you are on an older
release, work through the sections below first. Removed names fail at build time rather than
resolving to `undefined`. Two changes are not caught by a build: the React Router and Node checks
run at server startup, and the hook error fields under Hook Errors are renamed.

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

Node `22.12` is the minimum; on Node 20, importing `catalyst-core/hooks` or
`catalyst-core/WebBridge` fails with `ERR_REQUIRE_ESM`.

### Imports From The Root Entry

The root entry exports exactly eight names: `RouterDataProvider`, `useCurrentRouteData`,
`useRouterData`, `MetaTag`, `split`, `hydrationReady`, `Head`, and `Body`. React Router is no
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
`ERROR_CODES` from `catalyst-core/errors` rather than string literals. `CatalystError` extends
`Error`, so `JSON.stringify(error)` no longer includes the message; log `error.message`
explicitly, or use the `code` and `docUrl` fields.

### App Contract Reporting

Missing or malformed app-contract exports are reported once at startup, naming the file, the
export, and what the application must provide. Reporting is not fatal: startup continues instead
of failing later inside an unrelated render. An application that satisfies the contract sees no
change. The contract is documented under
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
replace `loadableReady()` with `hydrationReady()` before `hydrateRoot()`.

```javascript
import { hydrationReady } from "catalyst-core"
import { RouterProvider } from "react-router/dom"
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





