---
title: Asset Loading
slug: asset-loading
id: asset-loading
sidebar_position: 8
---

# Asset Loading

Serve static images and assets from your application.

---

## Create the Assets Directory

Create a directory for images:

```
src/static/images/
```

Add your logo image (e.g., `dog-logo.png`) to this directory.

---

## Configure Static Asset Serving

Update `server/server.js` to serve static files:

```javascript title="server/server.js"
const express = require("express");
const path = require("path");

export function addMiddlewares(app) {
  app.use("/assets", express.static(path.join(__dirname, "../src/static/images")));
}
```

---

## Usage

Reference assets using the `/assets/` path:

```jsx
<img src="/assets/dog-logo.png" alt="Logo" />
```

The logo now displays in the header component.

Next, we'll add custom fonts.