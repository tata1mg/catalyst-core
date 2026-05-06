---
title: Defining Routes
slug: routing/index
id: definingRoutes
sidebar_position: 1
---

# Defining Routes

Routes are defined in `src/js/routes/index.js`. Catalyst uses [React Router v6](https://reactrouter.com/en/main) for routing.

> **Note:** Do not prefix child routes with a slash. Use `"settings"` not `"/settings"`.

---

## Basic Routes

```javascript title="src/js/routes/index.js"
import Home from "@pages/Home";
import About from "@pages/About";
import Product from "@pages/Product";

const routes = [
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/about",
    element: <About />,
  },
  {
    path: "/product/:id",
    element: <Product />,
  },
];

export default routes;
```

---

## Nested Routes

```javascript title="src/js/routes/index.js"
import Dashboard from "@pages/Dashboard";
import Settings from "@pages/Settings";
import Profile from "@pages/Profile";

const routes = [
  {
    path: "/dashboard",
    element: <Dashboard />,
    children: [
      {
        path: "settings",  // /dashboard/settings
        element: <Settings />,
      },
      {
        path: "profile",   // /dashboard/profile
        element: <Profile />,
      },
    ],
  },
];

export default routes;
```

---

## Dynamic Routes

Use `:param` syntax for dynamic segments:

```javascript
const routes = [
  {
    path: "/user/:userId",        // matches /user/123
    element: <UserProfile />,
  },
  {
    path: "/post/:postId/comment/:commentId",  // multiple params
    element: <Comment />,
  },
  {
    path: "/docs/*",              // catch-all
    element: <Documentation />,
  },
];
```

---

## Adding Data Fetching

Attach `clientFetcher` and `serverFetcher` functions to components for data loading. See [Data Fetching](/content/data-fetching) for details.

```javascript
import Home from "@pages/Home";

// Define fetchers on the component
Home.clientFetcher = async ({ params }) => {
  const response = await fetch("/api/data");
  return response.json();
};

Home.serverFetcher = async ({ params }) => {
  const response = await fetch("/api/data");
  return response.json();
};
```
