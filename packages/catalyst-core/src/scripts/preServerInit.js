import path from "path"
import { createRequire } from "module"
import loadEnvironmentVariables from "./loadEnvironmentVariables.js"
import { safeCallNamed } from "../server/utils/validator.js"

// react-router is a peer dependency: fail loudly at startup rather than on a
// missing export deep inside a render. Resolve from the app root, not from
// catalyst-core's own tree — the app's copy is the one vite and SSR load.
const REQUIRED_REACT_ROUTER = "^7.18.2"
const appRequire = createRequire(path.join(process.env.src_path, "package.json"))
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
    const hooks = await import(path.join(process.env.src_path, "server/index.js"))
    preServerInit = hooks.preServerInit
} catch {
    // No hooks file — preServerInit remains undefined
}
await loadEnvironmentVariables()
await safeCallNamed("preServerInit", preServerInit)
