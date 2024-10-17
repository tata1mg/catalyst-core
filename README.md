<div align="center" style="padding: 24px;">
 <img alt="Catalyst logo" src="https://onemg.gumlet.io/staging/7ee66dfb-b5fb-4fbe-8dea-789685e45f7a.svg" height="128">
</div>

## Table of Contents

-   Overview
-   Installation
-   Data Fetching with Catalyst
    -   serverFetcher
    -   clientFetcher
    -   refetch (for data revalidation)
-   State Management

## Overview

This package provides a way to proxy your request through your server. It allows you to cache your incoming request to improve your server response time.

## Installation

**System Requirements**

-   Node version 20.4.0 or later
-   macOS and Linux are supported

**Automatic Installation**

-   Run the following commands in the directory where you want to set up the Catalyst app.

```js
npx create-catalyst-app@latest
```

If successful, you will see the following prompts in your terminal.

-   Enter the name of your Catalyst application.
-   Choose state management.
-   Once packages are installed,start the development server by running the following command.

```js
cd project-name && npm run start
```

-   Navigate to http://localhost:3005

The dev server should be running now.

Visit our official documentation:
https://catalyst.1mg.com/public_docs/content/installation

## Data Fetching with Catalyst

we have serverFetcher function for fetching with SSR and clientFetcher function for fetching during client side rendering and navigations.

**serverFetcher**

server fetcher will get request, request params, search params and store (if project is setup with redux or rtk) as arguments. We can declare it as an async function and use await for fetching or use then chaining for data fetching.

if server fetcher is called for a route then client fetcher will not be called for that route, unless called with refetch.

```js
Home.serverFetcher = async ({ req, params, searchParams }, { store }) => {
    store.dispatch(someAction())
    const res = await fetch("some_url")
    const json = await res.json()
    return json
}
```

data returned from fetcher function will be accessible through useCurrentRouteData() hook provided by router.

```js
const [data, error, isFetched] = useCurrentRouteData()
```

error and loading state would be handled by router.

**clientFetcher**

client fetcher would be called on client side rendering and client side navigations. `store` would be available as a param in client side for dispatching redux/rtk actions.

```js
Home.clientFetcher = async ({ route, location, params, searchParams, navigate }, { store }) => {
    store.dispatch(someAction())
    const res = await fetch("some_url")
    const json = await res.json()
    return json
}
```

data returned from client fetcher function will be accessible through useCurrentRouteData() hook provided by router (hook for data access through client is same).

```js
const [data, error, isFetched] = useCurrentRouteData()
```

**refetch (for data revalidation)**

refetch function can be used were we need to execute clientFetcher based on some condition(such as for infinite scroll or some state change inside container or onClick.)

We can pass arguments in refetch function which would

```js
const [data,error,isFetched,refetch] = useCurrentRouteData()

useEffect(()=>{
  refetch({refetchArgument:some_value})
},[arg])

clientFetcher = ({},{refetchArgument}) => {

  const res = await api_call // refetchArg can be used as a param in api call
  return res
}

```

## State Management

state management wrappers are defined in stateProvider.js file

store can be configured by manipulating store/index.js as per user requirements (custom middlewares etc can be added in this way.

initial state and request object would be provided in createStore function which will be called on server and client, we use the params to add additional arguments and middlewares in redux store.

```js
const configureStore = (initialState, cookies, requestObj, customHeaders) => {
    const api = fetchInstance
    const store = createStore({
        reducer: rootReducer,
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

## Documentation

Visit https://catalyst.1mg.com to view the full documentation.
