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

TITLE: Universal App

DESCRIPTION:

-   Catalyst also provides support to build native iOS/android applications
-   This feature is currently only available in the canary version, setup the application using `npx create-catalyst-app@0.0.3-canary.6`

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
