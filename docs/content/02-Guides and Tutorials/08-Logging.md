---
title: Logging
slug: logging
id: logging
---

# Logging

Catalyst provides a global `logger` instance for server-side logging.

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
| `ENABLE_DEBUG_LOGS` | `false` | Enable debug-level logging |
| `ENABLE_CONSOLE_LOGGING` | `true` | Output logs to console |
| `ENABLE_FILE_LOGGING` | `false` | Write logs to files |

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

- Logs are written to the project root directory
- Log files are automatically rotated
- Logs older than 3 days are deleted
