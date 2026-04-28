---
title: RouterDataProvider
slug: routing/router-data-provider
id: router-data-provider
sidebar_position: 3
---

# RouterDataProvider

The `RouterDataProvider` component wraps your application and manages data fetching for routes. It executes fetchers on route changes and provides data to child components.

---

## Props

| Prop | Type | Description |
|------|------|-------------|
| `initialState` | `object` | Initial data state, used to hydrate client with server data |
| `fetcherArgs` | `object` | Arguments passed to all fetcher functions |
| `config` | `object` | Global configuration options |

---

## Basic Usage

```jsx title="src/js/routes/utils.js"
import { RouterDataProvider } from "@tata1mg/router";
import App from "@containers/App";

export const preparedRoutes = ({ routerInitialState }) => {
  return [
    {
      element: (
        <RouterDataProvider
          initialState={routerInitialState}
          fetcherArgs={{}}
          config={{}}
        >
          <App />
        </RouterDataProvider>
      ),
      children: routes,
    },
  ];
};
```

---

## With Redux Store

Pass the Redux store through `fetcherArgs` to make it available in fetchers:

```jsx title="src/js/routes/utils.js"
import { RouterDataProvider } from "@tata1mg/router";
import App from "@containers/App";

export const preparedRoutes = ({ store, routerInitialState }) => {
  return [
    {
      element: (
        <RouterDataProvider
          initialState={routerInitialState}
          fetcherArgs={{ store }}
          config={{}}
        >
          <App />
        </RouterDataProvider>
      ),
      children: routes,
    },
  ];
};
```

Access in fetchers:

```javascript
HomePage.serverFetcher = async ({ params }, { store }) => {
  return store.dispatch(fetchPageData());
};
```
