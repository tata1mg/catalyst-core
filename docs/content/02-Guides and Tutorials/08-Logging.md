---
title: Logging
slug: logging
id: logging
---

# Logging

Catalyst provides a server-side logger through `catalyst-core/logger`. Call `configureLogger()` once in `preServerInit()` in `server/index.js`. It creates the logger and sets it as the global `logger`.

```javascript title="server/index.js"
import { configureLogger } from "catalyst-core/logger";

export const preServerInit = () => {
    configureLogger({
        enableDebugLogs: process.env.ENABLE_DEBUG_LOGS,
        enableFileLogging: process.env.ENABLE_FILE_LOGGING,
        enableConsoleLogging: process.env.ENABLE_CONSOLE_LOGGING,
    });
};
```

Keys in `config/config.json` are available on `process.env` by the time `preServerInit()` runs, so the example above reads the settings from the configuration keys below.

---

## Usage

```javascript
logger.info("User logged in");
logger.debug("Processing request", { userId: 123 });
logger.error("Failed to connect to database", error);
```

---

## Log Levels

| Level | Use Case |
|-------|----------|
| `info` | General information |
| `debug` | Detailed debugging |
| `error` | Errors and exceptions |

---

## Log Format

```json
{
  "level": "info",
  "message": "User logged in",
  "timestamp": "2024-01-15 10:30:45"
}
```

---

## Configuration

Configure logging in `config/config.json`:

| Key | Default | Description |
|-----|---------|-------------|
| `ENABLE_DEBUG_LOGS` | `true` | Enable debug-level logging |
| `ENABLE_CONSOLE_LOGGING` | `true` | Output logs to console |
| `ENABLE_FILE_LOGGING` | `true` | Write logs to files |

The defaults are what `configureLogger()` uses when an option is not set, so set a key to `false` to turn it off.

```json title="config/config.json"
{
  "ENABLE_DEBUG_LOGS": true,
  "ENABLE_CONSOLE_LOGGING": true,
  "ENABLE_FILE_LOGGING": true
}
```

---

## File Logging

When `ENABLE_FILE_LOGGING` is `true`:

- Logs are written to `logs/info`, `logs/debug` and `logs/error` under the project root
- Log files are automatically rotated
- Logs older than 3 days are deleted
