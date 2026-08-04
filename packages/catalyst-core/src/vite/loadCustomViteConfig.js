import { existsSync } from "fs"
import path from "path"
import { pathToFileURL } from "url"

const emptyConfig = {
    ssrPlugins: [],
    clientPlugins: [],
}

export async function loadCustomViteConfig() {
    const configNames = ["buildConfig.js", "webpackConfig.js"]
    const configPath = configNames
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal - configName is one of two hardcoded literals above, and process.env.src_path is the app root set by the framework's own build tooling, not request/user input.
        .map((configName) => path.join(process.env.src_path, configName))
        .find((candidatePath) => existsSync(candidatePath))

    if (!configPath) {
        return emptyConfig
    }

    const configModule = await import(pathToFileURL(configPath).href)
    return configModule.default || configModule
}
