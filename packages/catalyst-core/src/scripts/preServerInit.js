import path from "path"
import { createRequire } from "module"
import loadEnvironmentVariables from "./loadEnvironmentVariables.js"
import { validatePreInitServer, handleError, safeCallNamed } from "../server/utils/validator.js"

// src_path is the application root, set by the CLI when it spawns this process.
// Without it every path below would be resolved against undefined.
const appRoot = process.env.src_path
if (!appRoot) {
    throw new Error(
        "catalyst-core: process.env.src_path is not set, so the application root cannot be resolved. " +
            "Start the server with `catalyst serve` or `catalyst start` from the application root."
    )
}

// validator.ts renders registry errors through this. It is also bundled into
// the app's SSR build, which cannot reach the CLI by a relative path, so the
// server process hands the renderer over here, in the first module it loads.
const { registryFailure } = createRequire(import.meta.url)("../cli/diagnostic.js")
// eslint-disable-next-line no-undef -- the scripts lint env predates globalThis
globalThis.__catalystRenderRegistryError = (error, scope) => registryFailure(error, { scope, cwd: appRoot })

// react-router is a peer dependency: fail loudly at startup rather than on a
// missing export deep inside a render. Resolve from the app root, not from
// catalyst-core's own tree — the app's copy is the one vite and SSR load.
const REQUIRED_REACT_ROUTER = "^7.18.2"
const appRequire = createRequire(path.join(appRoot, "package.json"))
let reactRouterVersion
try {
    reactRouterVersion = appRequire("react-router/package.json").version
} catch {
    throw new Error(
        `catalyst-core requires react-router ${REQUIRED_REACT_ROUTER} as a peer dependency, but it is not installed. ` +
            `Install it: npm install react-router@${REQUIRED_REACT_ROUTER}`
    )
}
const [major, minor, patch] = reactRouterVersion.split("-")[0].split(".").map(Number)
const isValid =
    [major, minor, patch].every(Number.isFinite) &&
    major === 7 &&
    (minor > 18 || (minor === 18 && patch >= 2))
if (!isValid) {
    throw new Error(
        `catalyst-core requires react-router ${REQUIRED_REACT_ROUTER}, but found ${reactRouterVersion}. ` +
            `Install a compatible version: npm install react-router@${REQUIRED_REACT_ROUTER}`
    )
}

let preServerInit
try {
    const hooks = await import(path.join(appRoot, "server/index.js"))
    preServerInit = hooks.preServerInit
} catch {
    // No hooks file — preServerInit remains undefined
}
try {
    await loadEnvironmentVariables()
} catch {
    // loadEnvironmentVariables already printed an actionable message. Letting
    // this propagate would print the raw stack again as an unhandled rejection.
    process.exit(1)
}

// preServerInit is an OPTIONAL hook — an app with no server/index.js is
// valid, so PREFLIGHT-010 (missing) is deliberately not surfaced here. But
// if the app DID export something under that name and it isn't callable,
// that's a real mistake worth flagging (PREFLIGHT-011).
if (preServerInit !== undefined) {
    const preInitErr = validatePreInitServer(preServerInit)
    if (preInitErr) handleError(preInitErr)
}
await safeCallNamed("preServerInit", preServerInit)
