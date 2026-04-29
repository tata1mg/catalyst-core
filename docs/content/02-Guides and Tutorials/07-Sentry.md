---
title: Sentry Integration
slug: sentry-integration
id: sentry-integration
---

# Sentry Integration

Catalyst applications can initialize Sentry on both the client and server so errors, messages, and performance signals are captured consistently across the SSR lifecycle.

---

## Installation

First, install the required Sentry packages for your application:

```bash
npm install @sentry/react @sentry/node
```

## Basic Setup

Import the Sentry object from catalyst-core:

```javascript
import Sentry from "catalyst-core/sentry";
```

## Configuration

### `sentry.config.json`

Create a `sentry.config.json` file at the same level as your `config.json` file:

```json
{
  "dsn": "YOUR_SENTRY_DSN",
  "clientOptions": {
    "environment": "development",
    "tracesSampleRate": 1.0,
    "replaysSessionSampleRate": 0.1,
    "replaysOnErrorSampleRate": 1.0
  },
  "serverOptions": {
    "environment": "development",
    "tracesSampleRate": 1.0,
    "profilesSampleRate": 1.0
  },
  "enableTracing": true,
  "enableProfiling": true,
  "release": "1.0.0"
}
```

Use this file to keep environment, release, tracing, and profiling options in one place.

## Initialization

### Client-side

Initialize Sentry on the client side in your `client.js` file:

```javascript
// client.js
import Sentry from "catalyst-core/sentry";

Sentry.init();
```

### Server-side

Initialize Sentry on the server side in `preServerInit()` so it is ready before the SSR server starts handling requests:

```javascript
import Sentry from "catalyst-core/sentry";

export const preServerInit = () => {
  Sentry.init();
};
```

## Why `preServerInit()` Is The Right Place

The server lifecycle hook runs before the Express app begins accepting traffic, which makes it the correct place for server-side monitoring startup. This keeps Sentry initialization aligned with server startup rather than hidden inside request-time code.

## Common Runtime Methods

The catalyst-core Sentry SDK exports several utility functions for error tracking and monitoring:

### `captureException`

Capture and report exceptions to Sentry:

```javascript
import Sentry from "catalyst-core/sentry";

try {
  // Some code that might throw an error
  throw new Error("Something went wrong!");
} catch (error) {
  Sentry.captureException(error);
}
```

### `captureMessage`

Send custom messages to Sentry:

```javascript
import Sentry from "catalyst-core/sentry";

Sentry.captureMessage("User performed a critical action", "info");
```

### `addBreadcrumb`

Add breadcrumbs to track the sequence of events leading up to an error:

```javascript
import Sentry from "catalyst-core/sentry";

Sentry.addBreadcrumb({
  message: "User clicked on submit button",
  level: "info",
  category: "ui.interaction",
});
```

## Production Guidance

- Set `environment` and `release` consistently on both client and server.
- Use tracing and profiling rates intentionally instead of copying high default values into production.
- Capture exceptions at the application boundaries, not in every small helper.
- Add breadcrumbs for meaningful user actions or server milestones, not for every trivial event.

## What To Verify

- client-side errors appear with the expected release and environment
- SSR and server startup failures are captured
- tracing settings do not create unnecessary volume
- source maps and release versions line up with your deployment process
