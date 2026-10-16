# PREFLIGHT-022

**Category:** PREFLIGHT

## Message

The build is stale: config/config.json changed since it was built

## Details

PUBLIC_STATIC_ASSET_URL, PUBLIC_STATIC_ASSET_PATH and the CLIENT_ENV_VARIABLES values are inlined into the bundles at build time, so serving this build would use the old values.

## Suggested action

Run `npm run build` again, then `npm run serve`.
