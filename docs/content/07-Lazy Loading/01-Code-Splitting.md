---
title: Code Splitting
slug: code-splitting
id: code-splitting
---
# Code Splitting

Code splitting allows you to split your code into separate bundles that load on demand, reducing initial bundle size and improving performance.

Catalyst supports code splitting through `@loadable/component` for SSR-compatible lazy loading.

---

## Route-based Code Splitting

The most common approach - each route loads independently:

```jsx title="src/js/routes/index.js"
import loadable from "@loadable/component";
import HomeFallback from "@Fallback/HomeFallback/HomeFallback.js";

const Home = loadable(() => import("@pages/Home/Home.js"), {
  ssr: false,
  fallback: <HomeFallback />
});

const About = loadable(() => import("@pages/About/About.js"), {
  ssr: false,
  fallback: <div>Loading...</div>
});

const routes = [
  {
    path: "/",
    end: true,
    component: Home,
  },
  {
    path: "/about",
    component: About,
  },
];

export default routes;
```

---

## Component-based Code Splitting

Load components conditionally based on application state:

```jsx
import loadable from "@loadable/component";

const UserDetails = loadable(() => import("@components/UserDetails/UserDetails.js"), {
  ssr: false,
});

const Profile = ({ isLoggedIn }) => {
  if (isLoggedIn) {
    return <UserDetails />;
  }
  return <button>Log In</button>;
};

export default Profile;
```

---

## Options

| Option | Type | Description |
|--------|------|-------------|
| `ssr` | boolean | Enable/disable server-side rendering for the component |
| `fallback` | ReactNode | Component to show while loading |

---

## Best Practices

1. **Split at route level first** - provides the biggest performance gains
2. **Use meaningful fallbacks** - show loading skeletons that match the expected content
3. **Disable SSR for client-only components** - charts, maps, or components using browser APIs
4. **Monitor bundle sizes** - use `ANALYZE_BUNDLE=true` to inspect chunk sizes
