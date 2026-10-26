---
title: CLI Reference
slug: cli-reference
id: cli-reference
sidebar_position: 35
---

# CLI Reference

Catalyst workflows are split between the framework CLI and project-level npm scripts. The CLI handles web app lifecycle commands, while native builds are usually exposed as scripts in the generated app.

## Core Commands

These commands apply to Catalyst `0.3.x` and `1.x`:

| Command | Purpose |
|---------|---------|
| `npx create-catalyst-app@latest` | Create a new Catalyst project |
| `catalyst start` | Start the local development environment |
| `catalyst build` | Create a production web build |
| `catalyst serve` | Serve the production build |
| `catalyst serve:inspect` | Serve the production build with the Node inspector attached |
| `catalyst plugins` | Turn native plugins on or off |

Run `catalyst --help` for the full list, or `catalyst --version` to print the installed version. A mistyped command suggests the closest match.

## Terminal Output

From `1.0.2`, every command prints output in the same shape: a short header, one line per step with its timing, and a final result line that names the next command to run. When something fails, the command prints one diagnostic block on stderr and exits non-zero. The block has the error code, the file and line when known, a code frame, a hint, and a link to the error's page in the [error reference](/errors).

Two options add detail to any command:

| Option | Effect |
|--------|--------|
| `--verbose` | Show every step and the full tool output, such as the complete Vite or Gradle log on a failed build |
| `--debug` | Everything `--verbose` shows, plus stacks and the environment |

Through npm scripts, pass the option after `--`, for example `npm run build -- --verbose`. You can also set `CATALYST_OUTPUT_MODE=verbose` or `CATALYST_OUTPUT_MODE=debug` in the environment.

`catalyst serve` is the exception to the formatted output. Once the production server is up, everything the app writes reaches stdout and stderr unchanged, so log shippers such as PM2, Docker or Datadog read the app's own lines.

## Typical npm Scripts

Most apps wrap the CLI in package scripts:

```json title="package.json"
{
  "scripts": {
    "start": "catalyst start",
    "build": "catalyst build",
    "serve": "catalyst serve",
    "buildApp": "catalyst buildApp",
    "buildApp:android": "catalyst buildApp:android",
    "buildApp:ios": "catalyst buildApp:ios"
  }
}
```

Your exact script names can differ, but the flow should remain clear and predictable for the team.

### Legacy Catalyst 0.2.x

`devBuild` and `devServe` are webpack-era commands available to legacy `0.2.x` applications. They
were removed in `0.3.x`; use `start` for Vite development and `build` followed by `serve` for a
production-style run.

## Universal App Commands

| Command | Purpose |
|---------|---------|
| `npm run setupEmulator:android` | Install JDK, Android SDK packages and an emulator if missing, then boot it |
| `npm run setupEmulator:ios` | Check Xcode, install an iOS runtime and a simulator if missing, then boot it |
| `npm run buildApp:android` | Build and run the Android debug app |
| `npm run buildApp:android -- --release --build-number <n>` | Build the signed Android App Bundle for Google Play |
| `npm run buildApp:ios` | Build and run the iOS app using the configured build type |

For native builds, the scripts read `WEBVIEW_CONFIG` from `config/config.json`. `buildApp:android` builds a release when given `--release` or when `WEBVIEW_CONFIG.android.buildType` is `release`.

| Option | Effect |
|--------|--------|
| `--release` | Build the signed store release, using `WEBVIEW_CONFIG.release` over the base config |
| `--build-number <n>` | The store build number (Android `versionCode`). Also read from `CATALYST_BUILD_NUMBER` |
| `--yes` | `setupEmulator`: download missing SDK pieces, create the emulator or simulator, and save the config without asking |
| `--accept-licenses` | `setupEmulator:android`: accept the Android SDK licences without the interactive review (for CI) |

A debug `buildApp` starts the dev server in the background when nothing is listening on `WEBVIEW_CONFIG.port`, so `npm run buildApp:android` or `npm run buildApp:ios` is enough on its own.

The flags can go before or after the command. Android release signing reads `CATALYST_ANDROID_KEYSTORE_BASE64`, `CATALYST_ANDROID_STORE_PASSWORD`, `CATALYST_ANDROID_KEY_PASSWORD` and `CATALYST_ANDROID_KEY_ALIAS` in CI; see [Universal App Deployment](/content/08-Deployment/02-Universal-App-Deployment.md) for the full flow.

## Production Web Flow

1. Run `catalyst build`.
2. Start the server with `catalyst serve` or your process manager.
3. In production deployments, teams commonly run the server through PM2 or a container entrypoint.

Before it starts the server, `catalyst serve` checks the build:

- If the build output folder (`BUILD_OUTPUT_PATH`, `build` by default) does not exist, it exits and asks you to run `catalyst build` first.
- If `PUBLIC_STATIC_ASSET_URL`, `PUBLIC_STATIC_ASSET_PATH` or a `CLIENT_ENV_VARIABLES` value in `config/config.json` changed since the build, it refuses to serve with [PREFLIGHT-022](/errors/PREFLIGHT/PREFLIGHT-022) and lists each changed value. These values are inlined into the bundles at build time, so the old build would use the old values. Run `catalyst build` again, then `catalyst serve`.
- If the port is already taken, it names the process that holds it instead of failing inside server startup.

In `0.3.x`, `catalyst build` emits separate Vite client and SSR outputs and generates the offline
manifest. Service workers and route offline snapshots are not enabled by `catalyst start`.

## Related Docs

- [React App Migration](/content/12-Migration/03-React-App-to-Catalyst.md)
- [Configuration API](/content/11-API%20Reference/02-Configuration.mdx)
- [Catalyst App Deployment](/content/08-Deployment/01-Deployment.md)
- [Universal App Deployment](/content/08-Deployment/02-Universal-App-Deployment.md)
