// Vite customization hook (0.3.x contract: clientPlugins / ssrPlugins only).
// Empty on purpose: docs content is precompiled to plain JS by
// scripts/generate-docs-manifest.mjs, so the stock Catalyst pipeline handles
// everything this app ships.
module.exports = {
    clientPlugins: [],
    ssrPlugins: [],
}
