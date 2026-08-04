# Wanderlog

A travel-journal example app used to exercise Catalyst's native capabilities
from a real product UI rather than a capability checklist. Built to be run
inside the Catalyst Companion preview flow.

Hooks demonstrated: `useCamera`, `useDeviceInfo`, `useHapticFeedback`,
`useNetworkStatus`, `useNotification`, `useSafeArea`.

## Setup

`config/config.json` is machine-specific and gitignored — the native shell
loads the app over your LAN, so it needs your actual IP:

```bash
cp config/config.example.json config/config.json
# replace YOUR_LAN_IP with your machine's LAN address (e.g. 192.168.1.20)
```

Set `sdkPath` too if you plan to build for Android.

## Running

```bash
npm install
npm run sync-core   # required — see below
npm run build
npm run serve
```

`sync-core` is not optional. `package.json` pins a published
`catalyst-core` only so a fresh clone installs cleanly; that release does
not contain the Companion preview flow. `sync-core` builds the local
`packages/catalyst-core` and installs it over the top (`--no-save`, so
your manifest and lockfile are untouched).

Skip it and the app runs, but Companion cannot preview it.

Re-run it after any change to `packages/catalyst-core` — what lands in
`node_modules` is a snapshot, not a live link.

Then open the app in Companion via the QR/preview flow, or load
`http://YOUR_LAN_IP:3005` in a browser.

## Note on image assets

The seed photos are imported from `src/static/img/` rather than referenced
from `public/`. Two constraints drive this:

- `public/` is not served in production; the static root is
  `build/client/assets`.
- Under SSR, Vite asset imports resolve against the server build base, which
  is never served — so `Home.js` re-roots the imported filename onto the
  client asset path.

Importing is what makes Vite emit the files at all; dropping the import
stops emission and the URLs 404.
