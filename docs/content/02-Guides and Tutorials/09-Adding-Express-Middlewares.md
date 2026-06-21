---
title: Adding Express Middlewares
slug: adding-express-middlewares
id: adding-express-middlewares
---

# Adding Express Middlewares

Catalyst uses Express.js under the hood, allowing you to add custom middlewares in `server/server.js`.

## Basic Setup

Export an `addMiddlewares` function that receives the Express app instance:

```javascript title="server/server.js"
import express from "express";

export function addMiddlewares(app) {
  // Add your middlewares here
}
```

## Examples

### Serving Static Files

```javascript title="server/server.js"
import express from "express";
import path from "path";

export function addMiddlewares(app) {
  app.use("/assets", express.static(path.join(__dirname, "../src/static")));
  app.use("/favicon.ico", express.static(path.join(__dirname, "../public/favicon.ico")));
}
```

### Adding Custom Headers

```javascript title="server/server.js"
export function addMiddlewares(app) {
  app.use((req, res, next) => {
    res.setHeader("X-Custom-Header", "value");
    next();
  });
}
```

### Request Logging

```javascript title="server/server.js"
import morgan from "morgan";

export function addMiddlewares(app) {
  app.use(morgan("combined"));
}
```

### Authentication Middleware

```javascript title="server/server.js"
export function addMiddlewares(app) {
  app.use((req, res, next) => {
    const token = req.headers.authorization;
    if (token) {
      req.user = verifyToken(token);
    }
    next();
  });
}
```

## Middleware Order

Middlewares execute in the order they are added. Place authentication and logging middlewares before route handlers:

```javascript title="server/server.js"
export function addMiddlewares(app) {
  // 1. Logging (runs first)
  app.use(morgan("combined"));

  // 2. Static files
  app.use("/assets", express.static("./public"));

  // 3. Authentication
  app.use(authMiddleware);

  // 4. Custom headers
  app.use(headerMiddleware);
}
```

