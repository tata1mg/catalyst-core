// config/config.json is git-ignored for every example app (see the repo
// .gitignore) — the committed file is config/config.template.json. Copy the
// template into place if config.json is absent, so a fresh checkout / CI can
// boot the app. The demo and test both rewrite config.json for their
// scenarios and restore it afterwards, so this only matters for the very
// first run.
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const configPath = path.join(appDir, "config", "config.json")
const templatePath = path.join(appDir, "config", "config.template.json")

if (!fs.existsSync(configPath)) {
    fs.copyFileSync(templatePath, configPath)
    console.log("[error-catalog] created config/config.json from config.template.json")
}
