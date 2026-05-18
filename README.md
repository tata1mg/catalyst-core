# Catalyst

<div align="center">
 <picture>
 <source media="(prefers-color-scheme: dark)" srcset="https://onemg.gumlet.io/staging/7ee66dfb-b5fb-4fbe-8dea-789685e45f7a.svg">
 <img alt="Catalyst logo" src="https://onemg.gumlet.io/staging/2fdb0975-8f51-4fd1-bd7d-6375d793f581.svg" height="128">
 </picture>
</div>

Catalyst is a React framework for building performant web apps and universal apps for Android and iOS. It provides server-side rendering, route-level data fetching, app shell primitives, styling conventions, and native WebView packaging tools.

## Quick Start

Create a new Catalyst app with:

```sh
npx create-catalyst-app@latest
```

Then start the generated app:

```sh
cd <your-app>
npm run start
```

The development server starts at `http://localhost:3005`.

## Documentation

Read the full documentation at [catalyst.1mg.com](https://catalyst.1mg.com).

Useful starting points:

- [Getting Started](https://catalyst.1mg.com/content/Introduction/getting-started)
- [First Catalyst App](https://catalyst.1mg.com/content/Guides%20and%20Tutorials/First%20Catalyst%20App/quick-start)
- [Universal App Setup](https://catalyst.1mg.com/content/Guides%20and%20Tutorials/First%20Universal%20App/first-universal-app)

## Packages

- [`catalyst-core`](./packages/catalyst-core): the framework package used by Catalyst applications.
- [`create-catalyst-app`](./packages/create-catalyst-app): the CLI for scaffolding new Catalyst apps.

## Requirements

- Node.js `20.4.0` or later for generated Catalyst apps.
- macOS or Linux for local development.

## Repository

This repository is a monorepo containing the framework package, scaffolding CLI, docs app, and internal test fixture.

- `packages/catalyst-core`: framework package
- `packages/create-catalyst-app`: CLI and scaffold templates
- `apps/catalyst-core-test`: standalone fixture app used to test `catalyst-core`
- `docs`: Catalyst documentation app

## Contributing

Install dependencies and create local docs config before running build/test commands:

```sh
npm run setup
```

Common development commands:

```sh
npm run core:build
npm run core:test
npm run cca:test
npm run docs:build
```

To scaffold a real app from the current branch packages:

```sh
npm run sandbox:create -- --name release-test
```

The sandbox app is created under `.sandbox/<name>` and uses a local packed `catalyst-core` from the current branch.
