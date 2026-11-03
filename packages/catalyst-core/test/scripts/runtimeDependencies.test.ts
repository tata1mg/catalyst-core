import { readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

// `catalyst start`, `build` and `serve` load dist/vite/node-loader.mjs into the
// app's Node process (--import). scripts/build-dist.mjs copies .mjs files
// byte-for-byte, so this test reads the source, src/vite/node-loader.mjs. Every
// package it imports must be installed for the app. A package that is only reachable through npm hoisting (esbuild
// via vite) disappears after `npm prune --omit=dev` and the server fails with
// ERR_MODULE_NOT_FOUND. Issue #539.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")

const manifest = JSON.parse(read("../../package.json"))
const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
])
const builtins = new Set(builtinModules)

// Bare package name of a specifier: "esbuild" -> "esbuild", "@scope/pkg/sub" -> "@scope/pkg".
function packageName(specifier: string) {
    const parts = specifier.split("/")
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

function importedPackages(source: string) {
    const specifiers = [...source.matchAll(/^\s*import\s[^"']*?["']([^"']+)["']/gm)].map((match) => match[1])
    return specifiers
        .filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("/"))
        .filter((specifier) => !specifier.startsWith("node:") && !builtins.has(packageName(specifier)))
        .map(packageName)
}

it("declares every package that node-loader.mjs imports", () => {
    const packages = importedPackages(read("../../src/vite/node-loader.mjs"))

    expect(packages).toContain("esbuild")
    expect(packages.filter((name) => !declared.has(name))).toEqual([])
})
