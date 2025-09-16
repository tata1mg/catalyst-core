Catalyst Context

-   Catalyst is a framework over react to build UIs

---

TITLE: Creating a new catalyst application

DESCRIPTION: A new catalyst app can be created using the create-catalyst-app CLI command

SOURCE: https://catalyst.1mg.com/public_docs/content/installation

LANGUAGE: bash
CODE:

```
npx create-catalyst-app@latest -y
```

Catalyst has native support for typescript, tailwind, redux, and a local MCP server
To configure these options, a new catalyst app can be created without using the default "-y" flag
Creating an app using this will ask for prompts from the user to configure specific options

LANGUAGE: bash
CODE:

```
npx create-catalyst-app@latest
```

---

---

TITLE: Starting the catalyst application

DESCRIPTION: This snippet starts the catalyst development application, The application supports hot reloading
the application is typically served on `http://localhost:3005`

SOURCE: https://catalyst.1mg.com/public_docs/content/installation

LANGUAGE: bash
CODE:

```
npm run start
```

---

---

TITLE: Building and serving the production version

DESCRIPTION:

-   To create an optimized production build of your Catalyst application, use the following command. This will generate the production-ready assets in the build directory.

LANGUAGE: bash
CODE:

```
npm run build
```

-   To serve the production build locally (for testing or preview), use the following command. This will start a server that serves your built application, typically on `http://localhost:3005`.

LANGUAGE: bash
CODE:

```
npm run serve
```

---

---

TITLE: Adding routes in catalyst

DESCRIPTION:

-   Catalyst uses @tata1mg/router package for routing, which is a wrapper around react-router
-   Catalyst uses react-router-v6 based routing
-   Routes are defined in "src/js/routes/index.js" file
-   Pages are imported at top of this file
-   A new entry in the routes array is added like this

SOURCE: https://catalyst.1mg.com/public_docs/content/Core%20Concepts/Routing/routing/index

LANGUAGE: js
CODE:

```
{
    path: "", // path of the page
    end: false,
    component: Page, // name of the page
},
```

---

---

TITLE: Navigation in catalyst

DESCRIPTION:

-   Navigation in @tata1mg/router is based on react-router-v6, and client side navigation can be achieved through components like <Navigate> or <Link> or through hooks like useNavigate

LANGUAGE: js
CODE:

```
import { useNavigate } from "@tata1mg/router"
const Page = () => {
    const navigate = useNavigate()
    return (
        <div onClick={() => navigate("/about")}>Click to navigate</div>
    )
}
```

LANGUAGE: js
CODE:

```
import { Link } from "@tata1mg/router"
const Page = () => {
    const navigate = useNavigate()
    return (
        <Link to="/about">Click to navigate</Link>
    )
}
```

-   Navigation inside clientFetcher function can be achieved through the navigate property which is available as an argument in clientFetcher.

LANGUAGE: js
CODE:

```
Page.clientFetcher = async ({ navigate }) => {
  navigate("/about")
}
```

-   Navigation inside serverFetcher function can also be achieved through the navigate property which is available as an argument in serverFetcher.
    navigate available inside server fetcher is a wrapper around response.send() so it would result it server side navigation.

LANGUAGE: js
CODE:

```
Page.serverFetcher = async ({ navigate }) => {
  navigate("/about") // will be navigated to /about on the server
}
```

---

---

TITLE: Data fetching in catalyst

DESCRIPTION:

-   Routes can fetch data using two primary functions:

1. **Client Fetcher**: Executes during client-side navigation or absence of **_server fetcher_**.
2. **Server Fetcher**: Executes during server-side rendering (SSR)

LANGUAGE: js
CODE:

```
const Page = ()=> <div>Some Page</div>

// Client-side data fetching
Page.clientFetcher = (routerProps,fetcherArgs) => { return new Promise()}

// Server-side data fetching
Page.serverFetcher = (serverRouterProps,fetcherArgs) => { return new Promise()}
```

clientFetcher will be called during client side navigation, when navigating through <Link/> or <Navigate> components or by using hooks like useNavigate provided by router.

LANGUAGE: js
CODE:

```
Page.clientFetcher = async ({ route, location, params, searchParams, navigate }, { store }) => {
  const res = await fetch('<https://api.example.com/data>');
  const json = await res.json();
  return json;
};
```

serverFetcher will be called during the first fold request or when navigation is done by window.location.href or similar methods. It will only be called on the server and will not be included in the client bundle, so it is safe to use server only secrets in this function

LANGUAGE: js
CODE:

```
Page.serverFetcher = async ({ route, location, params, searchParams, navigate },{ store }) => {
  const res = await fetch('<https://api.example.com/data>');
  const json = await res.json();
  return json;
};
```

useCurrentRouteData hook from @tata1mg/router returns the current router context object with data, error, isFetching, isFetched, refetch and clear properties.

LANGUAGE: js
CODE:

```
import { useCurrentRouteData } from "@tata1mg/router"
const Home = () => {
  const { isFetching, isFetched, error, data, refetch, clear } = useCurrentRouteData()
}

Home.clientFetcher = async () => {
  return {status:200}
}
```

The useRouterData hook returns a router context object with data of all the fetchers in the current route tree.

refetch executes the client loader. A custom argument can be passed while calling it through refetch in client loader to handle use cases where the fetch function needs to access the application state like for pagination, infinite scroll, etc.

LANGUAGE: js
CODE:

```
const Home = () => {
  ...
  useEffect(()=>{
    refetch({pageNo})
  },[pageNo])
}
Home.clientFetcher = async ({},{},{pageNo}) => {
  const res = await fetch(`some_url/${pageNo}`)
  const json = await res.json()
  return json
}
```

The clear function clears the data for the particular route from where it is called.

LANGUAGE: js
CODE:

```
const Home = () => {
  ...
  useEffect(()=>{
    clear()
  },[pathname])

  //will clear data for this particular route on navigation
}
```

---

---

TITLE: Environment variables in catalyst

DESCRIPTION:

-   Catalyst can be configured through a config/config.json file in the root of your project directory. You can define your keys to access them inside the project.
-   These variables will be accessible through process.env[variable_name].
-   Out of the complete contents of config/config.json, keys listed in CLIENT_ENV_KEYS are filtered and made available for the client side code.
-   Any key that is listed in CLIENT_ENV_KEYS will be exposed on the client and can become a security issue. Be careful while adding keys

---

---

TITLE: App shell in catalyst

DESCRIPTION:

-   Catalyst offers an app shell, which serves as a wrapper around your page code, enabling you to perform common operations required for all pages. You can access the app shell inside the src/js/containers/App directory under the src folder.
-   All your pages will be rendered in this app shell. It will be the parent component for all your apps.
-   The app shell provides you with a function called serverSideFunction, which you can use to perform any operations while rendering your page on the server. This function is similar to serverFetcher, which we define in the page component. The key distinction lies in the fact that serverSideFunction runs on each page request, whereas serverFetcher runs only when that specific page is requested.

LANGUAGE: js
CODE:

```
import React from "react"
import { Outlet } from "@tata1mg/router"

const App = () => {
    return (
        <>
            <Outlet />
        </>
    )
}

App.serverSideFunction = ({store, req, res}) => {
    return new Promise((resolve) => resolve())
}

export default App
```

---

---

TITLE: Lifecycle methods in catalyst

DESCRIPTION:

-   Catalyst provides several methods to handle different stages of the SSR lifecycle, allowing for more fine grain control over the flow
-   Functions
    1. preServerInit - Triggers before starting the server.
    2. onServerError - Triggered if the SSR server fails to start or encounters a critical error. Useful for handling server initialization issues.
    3. onRouteMatch - Called after route matching attempts, regardless of whether a match was found or not. This method enables you to handle both successful and failed route matches
    4. onFetcherSuccess - Triggered after running a container's serverFetcher (currently running for both success and failure case)
    5. onRenderError - Executes when the rendering process encounters an error. This allows you to handle any failures during component rendering.
    6. onRequestError - Executes if any error occurs while handling the document request (think of it like the outer most catch block)
-   All these functions can be defined in and exported from server/index.js

LANGUAGE: js
CODE:

```
export const preServerInit = () => {}
```

---

---

TITLE: Adding middlewares on the server

DESCRIPTION:

-   Catalyst offers a flexible approach to defining server-side code, granting you greater control and customization over server operations.
-   To modify the server behavior, create a file named server.js within the server directory of your app.
-   Define a function named addMiddlewares, which receives the app server instance as a parameter. Catalyst - provides this instance when executing the function on the server.
-   Use the app parameter to configure middleware for your application.

LANGUAGE: js
File: server/server.js
CODE:

```
export function addMiddlewares(app) {
  // server code
}
```

---

---

TITLE: Styling in catalyst

DESCRIPTION:

-   Catalyst offers a variety of methods for styling your application

Global CSS

-   Global styles can be imported into any layout, page, or component.
-   Place all your global css in "/src/static/css/base"
-   Placing css in "/src/static/css/base" would prevent it from being modularized as css-module is enabled by default in Catalyst
-   Import these global css file in client/styles.js so that it can be available globally.

LANGUAGE: js
File: Home.js
CODE:

```
const Home = () => {
    return <section className="marginTop-4">Home</section>
}
```

LANGUAGE: js
File: client/styles.js
CODE:

```
import "src/static/css/base/layout.css"
```

LANGUAGE: css
File: src/static/css/base/layout.css
CODE:

```
.marginTop-4 {
    margin-top: 4px;
}
```

CSS modules

-   Catalyst enables support for css-module out-of-the-box. CSS-modules locally scope CSS by creating unique names. This allows you to use same classnames in different files without worrying about naming conflicts.

LANGUAGE: js
CODE:

```
import css from "./styles.css"

const Home = () => {
    return <section className={css.layout}>Home</section>
}
```

Sass

-   Catalyst includes out-of-the-box support for Sass. Utilize Sass in Catalyst with the .scss file extension.
-   Place all mixins, variables, and other Sass resources in /src/static/css/resources. These will be automatically imported into your .scss files, allowing you to use these resources without manual imports.

---

---

TITLE: Code splitting in catalyst

DESCRIPTION:

-   Catalyst utilizes loadable-components for efficient code splitting on both the client and server. It offers built-in support for code splitting, making it easy to split your code into smaller chunks.

LANGUAGE: js
CODE:

```
const Component = loadable(()=> import("@components/Component.js"),{
    fallback: <div>Fallback</div>,
    ssr:false
})

const App = () => {
  return (
      <Component />
  );
};
```

---

---

TITLE: Module aliases in catalyst

DESCRIPTION:

-   Catalyst supports module aliases to create shorter and more descriptive import paths for modules. This practice can make the codebase cleaner and more maintainable. Some module aliases come pre-configured when setting up Catalyst, making imports cleaner.
-   To create module aliases, add \_moduleAliases key to package.json

LANGUAGE: JSON
CODE:

```
{
  "_moduleAliases": {
    "@api": "api.js",
    "@containers": "src/js/containers",
    "@server": "server",
    "@config": "config",
    "@css": "src/static/css",
    "@routes": "src/js/routes/",
    "@store": "src/js/store/index.js"
  }
}
```

---

---

TITLE: Custom document

DESCRIPTION:

-   The document is an HTML file served by the Node server whenever a page request is made. It contains the head, body, and all HTML tags.
-   Custom Document enables ability to update these tags and render the data according to the needs.
-   Head and Body tags are required and the application won't work without it. It is mandatory to pass props because they are used in Head and Body tags.
-   Custom tags should be added between the Head and Body tags.

LANGUAGE: js
FILE: server/document.js
CODE:

```
import { Head, Body } from "catalyst"

function Document(props) {
    return (
        <html lang={props.lang}>
            <Head {...props} />
            <Body {...props} />
        </html>
    )
}
export default Document
```

---

---

TITLE: Webpack customization

DESCRIPTION:

-   Catalyst provides ways to customize webpack configuration for specific needs through the webpackConfig.js file.

Catalyst allows customizing webpack's chunk splitting behavior through the splitChunksConfig option
LANGUAGE: js
CODE:

```
module.exports = {
  splitChunksConfig: {
    chunks: 'all',
    minSize: 20000,
    minChunks: 1,
  }
};
```

Some packages are distributed as ESM-only (ECMAScript Modules) and cannot be directly imported in Catalyst's CommonJS environment. To handle these packages, you can use the transpileModules option:

```
module.exports = {
  transpileModules: [
    'esm-only-package',
    /@scope/another-esm-package/
  ]
};
```

---

---

TITLE: State management

DESCRIPTION:

-   To address use cases where a global store is needed and must be accessible on both the client and server, Catalyst provides built-in support for Redux and Redux Toolkit
-   The Redux store should be defined in src/js/store/index.js

Redux integration demo

LANGUAGE: js
FILE: src/js/store/index.js
CODE:

```
import { compose, createStore, applyMiddleware } from "redux"
import homeReducer from "@reducers/homeReducer.js"

export default function configureStore(initialState,request) {
  // request object is available when the store is initialized on the server
  // creating store with homeReducer and initialData recieved from server
    const store = createStore(
        homeReducer
        initialState,
    )
    return store
}
```

RTK integration demo

LANGUAGE: js
FILE: src/js/store/index.js
CODE:

```
import { configureStore as createStore } from "@reduxjs/toolkit"
import { combineReducers } from "redux"
import { shellReducer } from "@containers/App/reducer.js"
import fetchInstance from "@api"

const configureStore = (initialState) => {
    const api = fetchInstance
    const store = createStore({
        reducer: combineReducers({ shellReducer }),
        middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
                thunk: {
                    extraArgument: { api },
                },
            }),
        preloadedState: initialState,
    })
    return store
}

export default configureStore

```

-   This store is available in both clientFetcher and serverFetcher

LANGUAGE: js
CODE:

```
HomePage.serverFetcher = async ({ req }, { store }) => {
  dispatch(isLoading())
  // returning async action
  return dispatch(getHomePageData())
}
HomePage.clientFetcher = async ({ req }, { store }) => {
  dispatch(isLoading())
  // returning async action
  return dispatch(getHomePageData())
}
```

---

---

TITLE: Universal App Setup

DESCRIPTION:

-   Catalyst also provides support to build native iOS/android applications
-   This feature is currently only available in the canary version, setup the application using `npx create-catalyst-app@0.0.3-canary.10`

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/universal-app

To install the android simulator

1. Download and install Android Studio
2. Launch Android Studio
3. From the welcome screen, click More Actions and select SDK Manager
4. Navigate to Settings > Languages & Frameworks > Android SDK
5. In the SDK Platforms tab:
    - Select the latest Android version (API level)
    - Make sure the box next to the selected version is checked
6. Switch to the SDK Tools tab and ensure these components are installed:
    - At least one version of Android SDK Build-Tools
    - Android Emulator
    - Android SDK Platform-Tools
7. Important: Note down the Android SDK Location path displayed at the top
    - You'll need this path for environment variables or other development tools
8. Click Apply and then OK to begin the installation
    - Wait for all selected components to download and install
    - This may take several minutes depending on your internet connection

To install the ios simulator

1. Install Xcode
2. Install Xcode Command Line Tools

```
# Check if already installed
xcode-select -p

# If not installed, run:
xcode-select --install
```

-   To configure the android / iOS simulators, run `npm run setupEmulator:android` or `npm run setupEmulator:ios`
-   To run the application, first start the development server `npm run start`
-   Then in a new terminal, build the app using `npm run buildApp:android` or `npm run buildApp:ios`

---

---

TITLE: Universal App Cache Management

DESCRIPTION:

The cache manager implementation provides efficient caching mechanisms for web resources in both Android and iOS WebView applications. It supports configurable caching patterns, revalidation strategies, and automatic cache cleanup.

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/UniversalCacheManagement

## Configuration

### Android Configuration

Configure caching through the `config.json` file:

```json
{
    "WEBVIEW_CONFIG": {
        "android": {
            "buildType": "debug",
            "cachePattern": "*.css,*.js"
        }
    }
}
```

Configuration options:

-   `buildType`: Set to "debug" to bypass caching. This is crucial for development with Hot Module Replacement (HMR), ensuring that WebView receives real-time updates without cache interference
-   `cachePattern`: Comma-separated list of file patterns to cache (e.g., "_.css,_.js")

### iOS Configuration

Configure caching by setting cache patterns in constants:

-   Define patterns for files to be cached (e.g., CSS and JS files)
-   Multiple patterns can be specified in an array

## Cache Pattern Format

Both platforms support wildcard patterns for cache matching:

-   `*.css`: Matches all CSS files
-   `*.js`: Matches all JavaScript files
-   Multiple patterns can be specified
-   File extensions are case-insensitive

## Internal Implementation

### Android Cache Manager

The Android implementation features:

1. Two-Level Caching:
    - Memory cache using LruCache for fast access
    - Disk cache for persistence
2. Cache Entry Management:

    - Cache entries include:
        - Response data
        - Timestamp
        - ETag
        - Last-Modified headers

3. Cache Validation Strategy:

    - Implements stale-while-revalidate pattern
    - Handles cache expiration
    - Supports background revalidation

4. Automatic Cache Maintenance:
    - Maximum cache size: 100MB
    - Automatic cleanup of expired entries
    - LRU (Least Recently Used) eviction policy

### iOS Cache Manager

The iOS implementation uses a custom URL protocol :

1. Request Interception:

    - Intercepts WebView requests matching cache patterns
    - Handles both HTTP and HTTPS schemes

2. Caching Strategy:

    - Checks cache before network requests
    - Supports conditional requests (ETag, Last-Modified)
    - Automatic cache invalidation

3. Resource Handling:
    - MIME type preservation
    - Content validation
    - Error handling

## Cache Lifecycle

The cache implements a sophisticated lifecycle management strategy that balances performance with data freshness:

### Content States

1. Fresh Content (< 24 hours)

    - Content is served directly from cache
    - No network requests made
    - Fastest possible response time

2. Stale Content (24-25 hours)

    - Content is served from cache immediately
    - Background revalidation is triggered
    - User sees cached content while fresh data is fetched
    - Updates cache if content has changed

3. Expired Content (> 25 hours)
    - Cache entry is considered invalid
    - Fresh content is fetched from network
    - New cache entry is created
    - User waits for network response

This stale-while-revalidate pattern provides:

-   Optimal user experience with immediate responses
-   Efficient network usage
-   Up-to-date content without sacrificing performance
-   Graceful handling of network issues

### Production vs Development

```json
{
    "WEBVIEW_CONFIG": {
        "android": {
            "buildType": "debug", // Development: enables HMR
            "cachePattern": "*.css,*.js"
        }
    }
}
```

```json
{
    "WEBVIEW_CONFIG": {
        "android": {
            "buildType": "release", // Production: enables caching
            "cachePattern": "*.css,*.js"
        }
    }
}
```

---

---

TITLE: Universal App Build Optimization

DESCRIPTION:

The Build Optimization feature significantly enhances performance by preloading static assets directly from device storage rather than retrieving them over the network. This approach reduces page load times by approximately 90%, especially for the initial app launch.

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/BuildOptimisation

## Configuration

Configure the build optimization through the `config.json` file:

```json
{
    "WEBVIEW_CONFIG": {
        "android": {
            "sdkPath": "/path/to/android/sdk",
            "emulatorName": "your_emulator_name",
            "buildOptimisation": true,
            "cachePattern": "*.png,*.jpg,*.css,*.js",
            "buildType": "debug"
        }
    }
}
```

Configuration options:

-   `buildOptimisation`: Enable/disable the feature (set to `true` to enable)

## Asset Loading Process

The optimized asset loading follows this sequence:

1. **Initial Route Request**:

    - Intercepts the first GET request
    - Serves `index.html` from assets regardless of URL
    - Sets flags to track initial page load status

2. **Static Resource Loading**:

    - Checks if requested resources match static file patterns
    - Extracts asset path from URL
    - Loads resource directly from device storage
    - Logs asset loading statistics

3. **Fallback Mechanism**:
    - If assets can't be loaded locally, falls back to network
    - For cacheable network requests, utilizes the WebCacheManager
    - Maintains loading statistics for monitoring

## Load Time Impact

With Build Optimization enabled:

-   **Load Time Reduction**: ~90% faster page loading
-   **Network Requests**: Near-zero network requests for static assets
-   **Asset Success Rate**: 100% for bundled resources
-   **Initial Page Loading**: Directly from device storage, eliminating network latency

## Best Practices

1. **Asset Selection**:

    - Include critical JS, CSS, and images in your build folder
    - Keep bundle size reasonable to avoid large APK sizes
    - Consider excluding rarely used resources to optimize size

2. **Development vs. Production**:

    ```json
    {
        "WEBVIEW_CONFIG": {
            "android": {
                "buildOptimisation": true, // Enable for production
                "buildType": "release", // Use release for production
                "cachePattern": "*.png,*.jpg,*.css,*.js"
            }
        }
    }
    ```

    For development:

    ```json
    {
        "WEBVIEW_CONFIG": {
            "android": {
                "buildOptimisation": false, // Disable for faster development builds
                "buildType": "debug", // Use debug for development
                "cachePattern": "*.png,*.jpg,*.css,*.js"
            }
        }
    }
    ```

3. **Performance Monitoring**:
    - Check asset loading statistics in logs
    - Monitor cache hit rates
    - Track page load times between versions

## Troubleshooting

If you encounter issues with asset loading:

1. **Check Logs**:

    - Look for "Asset loading stats" in logs
    - Check for failed asset loading attempts
    - Verify MIME type assignment

2. **Configuration Issues**:

    - Ensure `buildOptimisation` is correctly set
    - Verify build assets were copied successfully

3. **Loading Failures**:

    - Asset paths may be incorrect
    - Assets might be missing from the build
    - Check for file permission issues

4. **Rebuild When Required**:
    - Update your app when static assets change significantly
    - Clear cache when troubleshooting loading issues

---

---

TITLE: Universal App Whitelisting

DESCRIPTION:

Network access control and navigation management for universal apps. Control URL access through the access control toggle and allowedUrls configuration.

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/Whitelisting

## Configuration

The whitelisting system is configured through the `WEBVIEW_CONFIG.accessControl` object:

```json
{
    "WEBVIEW_CONFIG": {
        "accessControl": {
            "enabled": true,
            "allowedUrls": ["https://api.example.com/users", "*.example.com", "subdomain.*.example.com"]
        }
    }
}
```

## Access Control Toggle

Control URL access restrictions through the `accessControl.enabled` setting.

### Properties

#### enabled

-   **Type**: Boolean
-   **Default**: `false`
-   **Description**: Enables or disables access control whitelisting
-   **Behavior**:
    -   `true`: Only URLs in `allowedUrls` array can be accessed (default deny)
    -   `false`: All URLs are accessible (no restrictions)

#### allowedUrls

-   **Type**: Array of strings
-   **Default**: `[]`
-   **Description**: List of URLs that are permitted when access control is enabled
-   **Format**: Supports exact URLs, wildcard patterns, and subdomain matching

## Whitelisting Behavior

All network calls are blocked by default when access control is enabled, and all links are considered external by default and will open in the browser. To allow network calls or internal navigation, URLs must be added to the "allowedUrls" configuration.

## URL Matching Patterns

### Exact Match

Match specific URLs exactly as they appear:

```json
{
    "accessControl": {
        "allowedUrls": ["https://api.example.com/users", "https://cdn.example.com/assets/logo.png"]
    }
}
```

### Wildcard Match

Use `*` to match any characters within a URL segment:

```json
{
    "accessControl": {
        "allowedUrls": ["https://api.example.com/*", "https://*.example.com/api/v1/*"]
    }
}
```

### Subdomain Match

Match all subdomains of a domain:

```json
{
    "accessControl": {
        "allowedUrls": ["*.example.com", "subdomain.*.example.com"]
    }
}
```

## Security Benefits

-   **Default Deny**: All network requests are blocked by default, providing a secure baseline
-   **Explicit Allow**: Only explicitly whitelisted URLs can be accessed
-   **Pattern Flexibility**: Support for exact, wildcard, and subdomain matching patterns
-   **Navigation Control**: External links are automatically handled by the system browser

## Use Cases

### API Endpoints

Whitelist specific API endpoints your app needs to access:

```json
{
    "accessControl": {
        "allowedUrls": [
            "https://api.myapp.com/auth/*",
            "https://api.myapp.com/users/*",
            "https://api.myapp.com/data/*"
        ]
    }
}
```

### CDN Resources

Allow access to content delivery networks:

```json
{
    "accessControl": {
        "allowedUrls": ["https://cdn.jsdelivr.net/*", "https://unpkg.com/*", "*.cloudfront.net"]
    }
}
```

### Third-party Services

Whitelist external services and APIs:

```json
{
    "accessControl": {
        "allowedUrls": ["https://maps.googleapis.com/*", "https://api.stripe.com/*", "*.analytics.google.com"]
    }
}
```

## Implementation Notes

-   URLs are matched against the patterns in the order they appear in the array
-   The first matching pattern allows the request
-   If no patterns match, the request is blocked
-   Subdomain patterns support multiple levels (e.g., `*.*.example.com`)
-   Wildcard patterns are greedy and match everything within the segment

---

---

TITLE: Universal App Splashscreen

DESCRIPTION:

Custom splashscreen configuration for universal apps. Control the duration, background color, and custom icon to provide a branded app launch experience.
The splashscreen is configured through the `splashScreen` object in your app configuration:

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/Splashscreen

```json
{
    "splashScreen": {
        "duration": 1000,
        "backgroundColor": "#ffffff"
    }
}
```

## Custom Icon

Place your custom splashscreen icon at `public/splashscreen.jpg`. Supported file extensions:

-   `.png`
-   `.jpg`
-   `.jpeg`
-   `.gif`
-   `.bmp`
-   `.svg`
-   `.webp`

## Behavior

### Default Behavior

-   **No Configuration**: Default Android splashscreen is shown
-   **No Custom Icon**: Fallback Catalyst logo is displayed
-   **With Configuration**: Custom splashscreen with specified duration and background

### Configuration Options

#### Duration

Controls how long the splashscreen is displayed:

```json
{
    "splashScreen": {
        "duration": 2000
    }
}
```

-   **Range**: 500ms - 5000ms
-   **Default**: 1000ms (1 second)
-   **Unit**: Milliseconds

#### Background Color

Sets the background color of the splashscreen:

```json
{
    "splashScreen": {
        "backgroundColor": "#2196F3"
    }
}
```

-   **Format**: Hex color code (e.g., `#ffffff`, `#2196F3`)
-   **Default**: `#ffffff` (white)
-   **Transparency**: Not supported, use solid colors only

## Implementation Notes

-   Configuration is required to enable custom splashscreen
-   Without configuration, the default Android splashscreen is used
-   Custom icon at `public/splashscreen.jpg` is automatically detected
-   Fallback Catalyst logo is shown if configuration exists but no custom icon is found
-   Background color applies to the entire screen, not just behind the icon

---

---

TITLE: Universal App Icon

DESCRIPTION:
Custom app icon configuration for universal apps. Replace the default Android icon with your branded app icon for a professional appearance in device launchers and app stores.

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/App-Icon

## Configuration

App icons are automatically detected and applied when placed in the correct location. No additional configuration is required in your app settings.

## Custom Icon Setup

### File Location

Place your custom app icon at `public/icon.jpg`

## File Structure

```
your-project/
├── public/
│   └── icon.jpg          # Your custom app icon
├── src/
└── package.json
```

### Supported File Extensions

-   `.png`
-   `.jpg`
-   `.jpeg`
-   `.gif`
-   `.bmp`
-   `.svg`
-   `.webp`

## Behavior

### Default Behavior

-   **No Custom Icon**: Default Android icon is displayed
-   **With Custom Icon**: Automatically uses `public/icon.jpg` as the app icon

## Important Notes

-   Icon replacement is automatic - no code changes required
-   Changes take effect on the next app build
-   Default Android icon is used as fallback if custom icon is not found
-   Icon appears in device launchers, app stores, and system settings

---

---

TITLE: Universal App Native APIs

DESCRIPTION:
Catalyst Core provides a comprehensive set of native APIs through React hooks that enable seamless integration between web and native platforms in universal apps.

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/API/Available-APIs

## Camera API

Comprehensive camera functionality for universal apps with photo capture, permission management, and error handling.

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/API/Camera-APIs

LANGUAGE: js
CODE:

```
import React from 'react';
import { useCamera } from "catalyst-core/hooks";

function CameraApp() {
  const {
    // New standardized interface
    data: photoData,
    execute: executeCamera
  } = useCamera();

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>📷 Camera Demo</h2>

      {/* Camera Controls */}

        <button onClick={executeCamera} >
          "Take Photo"
        </button>
        </div>

        {photoData && (
          <div>
            <h3>Photo Captured!</h3>
            <p>Name: {photoData.fileName}</p>
            <p>Size: {formatFileSize(photoData.size)}</p>
            <img src={photoData.fileSrc} alt="Captured" style={{ maxWidth: '300px' }} />

          </div>
        )}
    </div>
  );
}

export default CameraApp;
```

## File management API

Comprehensive file management functionality for selecting files and opening them with external applications in universal apps.

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/API/File-APIs

LANGUAGE: js
CODE:

```
import React from 'react';
import { useFilePicker, useIntent } from "catalyst-core/hooks";

function FileManagementApp() {
  const {
    data: fileData,
    execute: executeFilePicker
  } = useFilePicker();
  const {
    execute: executeIntent
  } = useIntent();

  return (
    <div style={{ padding: '20px', maxWidth: '600px' }}>
      <h2>📁 File Management Demo</h2>

      {/* File Picker Section */}
      <div style={{ marginBottom: '30px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
        <h3>📂 File Picker</h3>

        <div style={{ marginBottom: '15px' }}>
          <button
            onClick={() => executeFilePicker('image/*')}

            style={{ padding: '10px 15px', marginRight: '10px', fontSize: '14px' }}
          >
            '📁 Pick Image'
          </button>

          <button
            onClick={() => executeFilePicker('application/pdf')}

            style={{ padding: '10px 15px', marginRight: '10px', fontSize: '14px' }}
          >
            '📄 Pick PDF'
          </button>

          <button
            onClick={() => executeFilePicker()}

            style={{ padding: '10px 15px', fontSize: '14px' }}
          >
            '📋 Pick Any File'
          </button>
        </div>

        {fileData && (
          <div style={{
            padding: '10px',
            backgroundColor: '#e8f5e8',
            borderRadius: '4px',
            marginBottom: '10px'
          }}>
            <p><strong>Selected File:</strong></p>
            <p>📄 Name: {fileData.fileName}</p>
            <p>📏 Size: {(fileData.size / 1024).toFixed(2)} KB</p>
            <p>🔗 Type: {fileData.mimeType || 'Unknown'}</p>
            <p>📏 Transport: {fileData.transport}</p>

          </div>
        )}
      </div>

      {/* Intent Section */}
      <div style={{ marginBottom: '30px', padding: '15px', backgroundColor: '#f0f8ff', borderRadius: '8px' }}>
        <h3>🔗 Open with External App</h3>

        <div style={{ marginBottom: '15px' }}>
          <button
            onClick={() => executeIntent('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', 'application/pdf')}

            style={{ padding: '10px 15px', marginRight: '10px', fontSize: '14px' }}
          >
            '📄 Open Sample PDF'
          </button>

          <button
            onClick={() => executeIntent('https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4', 'video/mp4')}

            style={{ padding: '10px 15px', fontSize: '14px' }}
          >
            '🎥 Open Sample Video'
          </button>
        </div>
      </div>

      {/* Combined Actions */}
      {fileData && (
        <div style={{ padding: '15px', backgroundColor: '#fff3cd', borderRadius: '8px' }}>
          <h3>🔄 File Actions</h3>
          <p>Selected file: <strong>{fileData.fileName}</strong></p>

          <button
            onClick={() => executeIntent(fileData.fileSrc, fileData.mimeType)}

            style={{
              padding: '10px 15px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              marginRight: '10px'
            }}
          >
            '🔗 Open Selected File'
          </button>

        </div>
      )}
    </div>
  );
}

export default FileManagementApp;
```

## Haptic Feedback API

Enhanced user experience through haptic feedback with multiple intensity levels and contextual feedback types for universal apps.

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/API/Haptic-APIs

LANGUAGE: js
CODE:

```
import React from 'react';
import { useHapticFeedback } from "catalyst-core/hooks";

function ButtonFeedbackDemo() {
  const {
    // New standardized interface
    execute: executeHaptic,
    isSupported
  } = useHapticFeedback();

  return (
    <div style={{ padding: '20px', maxWidth: '500px' }}>
      <h2>🔘 Button Feedback Demo</h2>

      {/* Device availability check */}
      {isSupported ? (
        <p style={{ color: 'green', marginBottom: '20px' }}>
          ✅ Haptic feedback is available on this device
        </p>
      ) : (
        <p style={{ color: 'red', marginBottom: '20px' }}>
          ❌ Haptic feedback is not available on this device
        </p>
      )}

      {/* Haptic feedback buttons */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: '1rem',
        marginBottom: '20px'
      }}>
        <button onClick={() => executeHaptic('light')}>🔹 Light</button>
        <button onClick={() => executeHaptic('medium')}>🔸 Medium</button>
        <button onClick={() => executeHaptic('heavy')}>🔶 Heavy</button>
        <button onClick={() => executeHaptic('success')}>✅ Success</button>
        <button onClick={() => executeHaptic('warning')}>⚠️ Warning</button>
        <button onClick={() => executeHaptic('error')}>❌ Error</button>
      </div>
    </div>
  );
}

export default HapticFeedbackApp;
```

## Universal Storage API

Standard web storage APIs for client-side data persistence in Catalyst Core universal apps.

SOURCE: https://catalyst.1mg.com/public_docs/content/Universal%20App/API/Storage-API

Available Storage APIs:

-   localStorage
-   sessionStorage
-   document.cookie

---

---

TITLE: App name configuration

DESCRIPTION:

Custom app name configuration for universal apps. Control the display name of your application that appears in device launchers, app stores, and system settings.

## Configuration

The app name is configured through the `WEBVIEW_CONFIG` object in your app configuration:

```json
{
    "WEBVIEW_CONFIG": {
        "android": {
            "appName": "My Awesome App"
        }
    }
}
```

---

---

TITLE: Device Info API

DESCRIPTION:

# Device Information API

Access basic device details in your universal app using the Device Information API. This API provides essential device characteristics including hardware specifications and display properties.

## API Usage

### Initialization Method

```javascript
const { getDeviceInfo } = WebBridge.init()
const deviceInfo = await getDeviceInfo()
```

### Direct Access Method

```javascript
const { getDeviceInfo } = window.WebBridge
const deviceInfo = await getDeviceInfo()
```

## Response Format

The `getDeviceInfo()` method returns an object with the following keys:

```javascript
{
  model: "Pixel 10",           // Device model name
  manufacturer: "Google",            // Device manufacturer
  platform: "android",                 // Operating system platform
  screenWidth: 393,                // Screen width in pixels
  screenHeight: 852,               // Screen height in pixels
  screenDensity: 3.0               // Screen pixel density
}
```

---

---

---

TITLE: Protocol Configuration

DESCRIPTION:

# Protocol Configuration

Configure webview protocol settings for your universal app. Control whether the webview uses HTTP or HTTPS protocol to customize app behavior and security.

## Configuration

The protocol setting is configured through the `WEBVIEW_CONFIG.useHttps` property:

```json
{
    "WEBVIEW_CONFIG": {
        "useHttps": true
    }
}
```

-   **Type**: Boolean
-   **Default**: `false`
-   **Description**: Controls the protocol used for webview URLs
-   **Behavior**:
    -   `true`: Uses HTTPS protocol
    -   `false`: Uses HTTP protocol
