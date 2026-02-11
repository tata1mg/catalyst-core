import { createRequire } from "module"

/**
 * Shared helper to bridge ESM server entry files with legacy CommonJS helpers.
 *
 * Usage (in an ESM server file):
 *   import { cjsRequire } from "catalyst-core/server/cjsRequire"
 *   const legacyHelper = cjsRequire("./legacy/helper")
 */
export const cjsRequire = createRequire(import.meta.url)

