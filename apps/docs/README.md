## Catalyst Docs

This workspace contains the Catalyst documentation app. It builds the public docs, private docs, login app, and Express server used to serve them together.

## Development Setup

Create `apps/docs/config.json` from `apps/docs/config_template.json`. Real local and CI config files are intentionally ignored by Git.

Install docs dependencies from the monorepo root:

```sh
npm --prefix apps/docs install
```

Build the complete docs app from the monorepo root:

```sh
npm run docs:build
```

Start the server from the monorepo root:

```sh
npm run docs:start
```

Useful package-local commands:

```sh
npm --prefix apps/docs run start-private
npm --prefix apps/docs run start-public
npm --prefix apps/docs run start-login-app
```

The docs Dockerfile expects the monorepo root as its Docker build context:

```sh
docker build -f apps/docs/Dockerfile .
```

## Runtime Pieces

The docs app is composed of:

- Docusaurus private docs built to `build/private-docs`
- Docusaurus public docs built to `build/public-docs`
- React login page built to `login-page/build`
- Express server in `server/`, which serves the built apps and API routes
