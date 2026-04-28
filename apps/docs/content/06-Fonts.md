---
title: Fonts
slug: fonts
id: fonts
---

# Fonts

Catalyst supports both local fonts and Google Fonts.

---

## Local Fonts

### 1. Add Font Files

Place font files in `src/static/fonts`:

```
src/static/fonts/
├── Poppins-Regular.woff2
├── Poppins-Bold.woff2
└── Poppins-Medium.woff2
```

### 2. Define @font-face

```scss title="src/static/css/base/index.scss"
@font-face {
  font-family: "Poppins";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/assets/fonts/Poppins-Regular.woff2") format("woff2");
}

@font-face {
  font-family: "Poppins";
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("/assets/fonts/Poppins-Bold.woff2") format("woff2");
}
```

### 3. Serve Font Files

```javascript title="server/server.js"
import express from "express";
import path from "path";

export function addMiddlewares(app) {
  app.use("/assets/fonts", express.static(path.join(__dirname, "../src/static/fonts")));
}
```

### 4. Use in CSS

```css
body {
  font-family: "Poppins", sans-serif;
}
```

---

## Third-Party Fonts

Third-party hosted fonts such as Google Fonts, Adobe Fonts, or any CDN-hosted font should be added in `server/document.js` so they are included in the HTML document for every page.

### 1. Add Font Tags in the Document

For Google Fonts, add `preconnect` and the stylesheet link inside `Head`:

```jsx title="server/document.js"
import { Head, Body } from "catalyst";

function Document(props) {
  return (
    <html lang="en">
      <Head {...props}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Body {...props} />
    </html>
  );
}

export default Document;
```

For other providers, add their recommended `<link>` or `<script>` tags in the same place inside `Head`.

### 2. Use the Font in CSS

```css
body {
  font-family: "Inter", sans-serif;
}
```

### 3. Notes

- Use `preconnect` when the provider recommends it to reduce font loading latency.
- Prefer provider-hosted CSS links over `@import` inside your stylesheet.
- Keep a fallback stack such as `sans-serif` or `serif` in case the remote font fails to load.

---

## Performance Tips

1. **Use `font-display: swap`** — Prevents invisible text during font loading
2. **Subset fonts** — Include only characters you need
3. **Preconnect** — Add `rel="preconnect"` for external font hosts
4. **Prefer WOFF2** — Smallest file size with wide browser support
