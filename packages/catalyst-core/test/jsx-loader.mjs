import { transformSync } from "esbuild"

/**
 * A minimal Node ESM loader hook, scoped to `node --test` only — not registered
 * by the `test:unit` npm script itself, so it changes nothing for any test that
 * doesn't need it. Transforms .jsx source to plain JS via esbuild and nothing
 * else (no module-alias resolution, unlike src/vite/node-loader.mjs, which is
 * built for consuming apps and does enough extra work to have caused a duplicate
 * React module instance when reused here — hence a separate, narrower loader).
 */
export const load = async (url, context, nextLoad) => {
    if (!url.endsWith(".jsx")) return nextLoad(url, context)

    const result = await nextLoad(url, { ...context, format: "module" })
    const source = typeof result.source === "string" ? result.source : result.source.toString()
    const { code } = transformSync(source, { loader: "jsx", jsx: "automatic", format: "esm" })

    return { format: "module", source: code, shortCircuit: true }
}
