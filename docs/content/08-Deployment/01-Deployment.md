---
title: Catalyst App Deployment
slug: catalyst-app-deployment
id: catalyst-app-deployment
---

# Catalyst App Deployment

Use this flow to deploy a Catalyst web app consisting of the SSR server and the emitted static assets.

## Production Flow

1. Build the production bundle with `catalyst build` or `npm run build`.
2. Start the production server with `catalyst serve`, `npm run serve`, or a process manager entrypoint.
3. Route logs to stdout and stderr so the app behaves well in containers and managed infrastructure.

## Build Output

Catalyst produces:

- client assets under `build/public/`
- the server bundle under `build/server.js`

If you use code splitting, Catalyst also emits the stats needed to resolve route chunks correctly at runtime.

## Required Configuration

Set production values in `config/config.json` before building:

- `NODE_SERVER_HOSTNAME`
- `NODE_SERVER_PORT`
- `PUBLIC_STATIC_ASSET_URL`
- `PUBLIC_STATIC_ASSET_PATH`
- `BUILD_OUTPUT_PATH`

Use a production-ready `PUBLIC_STATIC_ASSET_URL`, especially when assets are served from a CDN or a dedicated static host.

## Process Management

Catalyst apps are commonly run behind PM2 or inside a container. A typical PM2 runtime entrypoint looks like:

```bash
NODE_ENV=production BUILD_ENV=production pm2-runtime ./ecosystem.config.js --wait-ready --listen-timeout 15000
```

`ecosystem.config.js` usually controls:

- process name
- restart policy
- memory limits
- timeouts

## Pre-Deploy Checklist

- confirm production config values
- verify the public asset URL matches the deployed asset host
- validate SSR routes and metadata in the built app
- confirm logs and monitoring are wired for the server process
- smoke-test the built app with `catalyst serve` before shipping

## Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3005
CMD ["npm", "run", "serve"]
```
