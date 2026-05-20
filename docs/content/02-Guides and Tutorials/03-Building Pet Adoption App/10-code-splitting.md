---
title: Code Splitting
slug: code-splitting
id: code-splitting
sidebar_position: 10
---

# Code Splitting

Load JavaScript only when needed to improve performance.

---

## Route-Based Code Splitting

Use `@loadable/component` to lazy-load page components:

```jsx title="src/js/routes/index.js"
import loadable from "@loadable/component";
import MainLayout from "../layouts/MainLayout/MainLayout";

const Home = loadable(() => import("../pages/Home/Home"), {
  ssr: true,
});

const BreedDetails = loadable(() => import("../pages/BreedDetails/BreedDetails"), {
  ssr: true,
});

const About = loadable(() => import("../pages/About/About"), {
  ssr: false,
  fallback: <div>Loading...</div>,
});

const routes = [
  {
    path: "/",
    component: MainLayout,
    children: [
      { path: "", index: true, component: Home },
      { path: "breed/:breed", component: BreedDetails },
      { path: "about", component: About },
    ],
  },
];

export default routes;
```

---

## Configuration Options

| Option | Description |
|--------|-------------|
| `ssr: true` | Component renders on server and client |
| `ssr: false` | Component renders only on client |
| `fallback` | Loading placeholder while component loads |

---

## Benefits

- **Smaller initial bundle** — Only load code for the current page
- **Faster page loads** — Reduce JavaScript parsing time
- **Better UX** — Pages load progressively

---

## Verify It Works

Open browser DevTools → Network tab. Navigate to the About page and watch for a new JavaScript chunk being loaded.

You've completed the tutorial! See the conclusion for next steps.
