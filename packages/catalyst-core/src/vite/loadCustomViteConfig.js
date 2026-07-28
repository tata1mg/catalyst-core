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
        .map((configName) => path.join(process.env.src_path, configName))
        .find((candidatePath) => existsSync(candidatePath))

    if (!configPath) {
        return emptyConfig
    }

    const configModule = await import(pathToFileURL(configPath).href)
    return configModule.default || configModule
}
