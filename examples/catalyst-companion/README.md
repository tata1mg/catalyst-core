## Catalyst Companion

This folder is the native shell only. Its screens (`/app`, `/try`, `/showcase`)
are served by the docs site in `docs/`, and the app opens
`https://catalyst.1mg.com/app` on launch (`WEBVIEW_CONFIG` in
`config/config_template.json`).

## Getting Started

`config/config.json` is gitignored. Copy the template fresh before each build so
it picks up template changes:

```bash
cp config/config_template.json config/config.json
npm install
npm run sync-core        # build and install the local catalyst-core
npm run buildApp:ios     # or buildApp:android
```

## Local development

To point the app at a local docs server instead of production:

1. In `docs/config/config.json`, set `NODE_SERVER_HOSTNAME` to `"0.0.0.0"` and
   `PUBLIC_STATIC_ASSET_URL` to `http://<LAN IP>:3005`, then run `npm start` in
   `docs/`. Config values win over shell env vars, so set them in the file.
2. In this folder's `config/config.json`, set `WEBVIEW_CONFIG.LOCAL_IP` to your
   machine's LAN IP, `port` to `"3005"` and `useHttps` to `false`, then rebuild.

The iOS simulator shares the host network, so `localhost` works on both sides
there.

## Documentation

Explore the complete documentation at [https://catalyst.1mg.com](https://catalyst.1mg.com).
