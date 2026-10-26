---
title: Styling
slug: styling
id: styling
---

# Styling

Catalyst supports multiple styling approaches out of the box.

---

## Folder Structure

Keep shared and component-level styles in predictable locations:

```text
src/
├── static/
│   └── css/
│       └── base/
│           ├── layout.css
│           └── theme.css
└── js/
    ├── components/
    │   └── Card/
    │       ├── Card.js
    │       └── Card.module.scss
    └── pages/
        └── Home/
            ├── Home.js
            └── Home.module.css
```

- Use `src/static/css/base` for global styles shared across the app.
- Keep component or page-specific styles next to the component that uses them.
- Use `.module.css` or `.module.scss` when styles should stay scoped to one component.

---

## Global CSS

Place global styles in `/src/static/css/base` and import them in `client/styles.js`:

```css title="src/static/css/base/layout.css"
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 16px;
}
```

```javascript title="client/styles.js"
import "@static/css/base/layout.css";
```

> Files in `/src/static/css/base` are not processed as CSS Modules.

---

## CSS Modules

CSS Modules scope styles locally by generating unique class names. Use the `.module.css` extension:

```css title="src/js/pages/Home/Home.module.css"
.wrapper {
  padding: 20px;
}

.title {
  color: #333;
  font-size: 24px;
}

.button {
  background: #007bff;
  color: white;
  border: none;
  padding: 10px 20px;
}
```

```jsx title="src/js/pages/Home/Home.js"
import styles from "./Home.module.css";

function Home() {
  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>Welcome</h1>
      <button className={styles.button}>Click me</button>
    </div>
  );
}
```

---

## SCSS

Catalyst includes Sass support. Use `.scss` or `.module.scss` extensions:

```scss title="src/js/components/Card/Card.module.scss"
$primary-color: #007bff;
$border-radius: 8px;

.card {
  border-radius: $border-radius;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  &:hover {
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  }

  .header {
    background: $primary-color;
    color: white;
    padding: 16px;
  }

  .body {
    padding: 16px;
  }
}
```

---

## Third-Party Libraries

Libraries like Tailwind CSS or Material UI can be integrated without additional build configuration.
