// Module hook for tests: compiles .jsx files with esbuild (already a dependency through vite).
import { readFile } from "node:fs/promises"
import { transform } from "esbuild"

export async function load(url, context, nextLoad) {
    if (!url.endsWith(".jsx")) return nextLoad(url, context)
    const source = await readFile(new URL(url), "utf8")
    const { code } = await transform(source, { loader: "jsx", jsx: "automatic", format: "esm", sourcefile: url })
    return { format: "module", source: code, shortCircuit: true }
}
