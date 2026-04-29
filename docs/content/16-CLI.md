---
title: CLI Reference
slug: cli-reference
id: cli-reference
sidebar_position: 35
---

# CLI Reference

Catalyst workflows are split between the framework CLI and project-level npm scripts. The CLI handles web app lifecycle commands, while native builds are usually exposed as scripts in the generated app.

## Core Commands

| Command | Purpose |
|---------|---------|
| `npx create-catalyst-app@latest` | Create a new Catalyst project |
| `catalyst start` | Start the local development environment |
| `catalyst build` | Create a production web build |
| `catalyst serve` | Serve the production build |

## Typical npm Scripts

Most apps wrap the CLI in package scripts:

```json title="package.json"
{
  "scripts": {
    "start": "catalyst start",
    "build": "catalyst build",
    "serve": "catalyst serve",
    "devBuild": "BUILD_ENV=development catalyst build",
    "devServe": "BUILD_ENV=development catalyst serve",
    "buildApp:android": "catalyst buildApp:android",
    "buildApp:ios": "catalyst buildApp:ios"
  }
}
```

Your exact script names can differ, but the flow should remain clear and predictable for the team.

## Universal App Commands

| Command | Purpose |
|---------|---------|
| `npm run buildApp:android` | Build and run the Android debug app |
| `npm run buildApp:ios` | Build and run the iOS app using the configured build type |

For native builds, the scripts read `WEBVIEW_CONFIG` from `config/config.json`. Release behavior is driven by the configured `buildType`, not by a separate built-in `:release` command.

## Production Web Flow

1. Run `catalyst build`.
2. Start the server with `catalyst serve` or your process manager.
3. In production deployments, teams commonly run the server through PM2 or a container entrypoint.

## Related Docs

- [React App Migration](/content/12-Migration/03-React-App-to-Catalyst.md)
- [Configuration API](/content/11-API%20Reference/02-Configuration.md)
- [Catalyst App Deployment](/content/08-Deployment/01-Deployment.md)
- [Universal App Deployment](/content/08-Deployment/02-Universal-App-Deployment.md)
