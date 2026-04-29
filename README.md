# Catalyst Monorepo

This repository contains the publishable Catalyst packages and supporting apps:

- `packages/catalyst-core`: the framework package
- `packages/create-catalyst-app`: the CLI and scaffold templates used to generate new apps
- `apps/catalyst-core-test`: standalone fixture app used to test `catalyst-core`
- `docs`: Catalyst documentation app

Release preparation and publishing are managed from the repository root.

## Fresh Clone Setup

Install dependencies and create local docs config before running build/test commands:

```sh
npm run setup
```

Then run the project commands you need:

```sh
npm run core:build
npm run core:test
npm run cca:test
npm run docs:build
```
