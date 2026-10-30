---
title: CLI Reference
slug: cli-reference
id: cli-reference
sidebar_position: 35
---

# CLI Reference

Catalyst workflows are split between the framework CLI and project-level npm scripts. The generated app wraps the web and native commands in scripts.

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
    "android": "catalyst buildApp:android",
    "ios": "catalyst buildApp:ios",
    "android:release": "catalyst buildApp:android --release",
    "ios:release": "catalyst buildApp:ios --release"
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
| `npm run android` (`catalyst buildApp:android`) | Install what is missing, start the dev server if needed, then build and run the Android debug app |
| `npm run ios` (`catalyst buildApp:ios`) | The same for iOS, on a simulator or connected iPhone |
| `npm run android:release` (`catalyst buildApp:android --release`) | Build the signed Android App Bundle for Google Play |
| `npm run ios:release` (`catalyst buildApp:ios --release`) | Build the signed iOS IPA for App Store Connect |
| `catalyst credentials:export <android\|ios>` | Print `credentials/<platform>/` as one value, for the CI secret and as a backup |
| `catalyst setupEmulator:android` | Install the Android toolchain and an emulator, then start it. Changes nothing in the app |
| `catalyst setupEmulator:ios` | Finish Xcode setup and install a simulator runtime and a simulator. Changes nothing in the app |

Apps created before 1.3.0 have `buildApp:android` and `buildApp:ios` scripts instead; they run the same commands.

| Option | Effect |
|--------|--------|
| `--release` | Build the signed store release |
| `--device` | Run the debug build on the connected phone instead of the emulator or simulator |
| `--url <url>` | The release's production URL, over `WEBVIEW_CONFIG.url` |
| `--yes` | Allow installs and downloads without asking: JDK, SDK packages, emulator, simulator runtime, simulator, Xcode first launch |
| `--accept-licenses` | Accept the Android SDK licences and the Xcode licence without asking |

Through npm scripts, pass options after `--`, for example `npm run android -- --device`. The options can go before or after the command.

Nothing is asked when stdin and stdout are not both terminals or when `CI` is set. A step that needs an answer then fails at once with [NATIVE-005](/errors/NATIVE/NATIVE-005), naming the option that answers it. `--yes` never accepts a licence and never creates a signing key; creating the Android upload key always needs a person at a terminal.

| Environment variable | Use |
|----------------------|-----|
| `CATALYST_ANDROID_CREDENTIALS` | `credentials/android/` from `catalyst credentials:export android`, for CI |
| `CATALYST_IOS_CREDENTIALS` | `credentials/ios/` from `catalyst credentials:export ios`, for CI |
| `CATALYST_BUILD_NUMBER` | Override the build number, which otherwise counts the minutes since 2024-01-01 UTC |
| `ANDROID_SERIAL` | Which Android phone `--device` uses when several are connected |

See [Universal App Deployment](/content/Deployment/universal-app-deployment) for the release flow and CI, and [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp) for development.

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
