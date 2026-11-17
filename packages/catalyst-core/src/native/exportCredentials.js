import { credentialsEnvName, packCredentials } from "./credentials.js"

// `catalyst credentials:export <android|ios>`: print credentials/<platform>/
// as the value of the CATALYST_<PLATFORM>_CREDENTIALS CI secret. The value
// goes to stdout alone (so it can be piped to pbcopy); the one line on where
// to paste it goes to stderr. The same value is the backup of the folder.

const GUTTER = "  "

/**
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {string} [options.cwd]
 * @param {(text: string) => void} [options.stdout]
 * @param {(text: string) => void} [options.stderr]
 * @returns {number} the exit code
 */
function runExportCredentials({
    argv = process.argv.slice(2),
    cwd = process.cwd(),
    stdout = (text) => process.stdout.write(text),
    stderr = (text) => process.stderr.write(text),
} = {}) {
    const platform = argv.find((arg) => !arg.startsWith("-"))
    if (platform !== "android" && platform !== "ios") {
        stderr(`\n${GUTTER}Usage: catalyst credentials:export <android|ios>\n\n`)
        return 1
    }
    try {
        const value = packCredentials(platform, { cwd })
        stdout(`${value}\n`)
        stderr(
            `\n${GUTTER}Paste this into a GitHub Actions secret named ${credentialsEnvName(platform)} ` +
                "(Settings > Secrets and variables > Actions), and keep a copy somewhere safe as your backup.\n\n"
        )
        return 0
    } catch (error) {
        const lines = [`\n${GUTTER}error ${error.code ? `[${error.code}] ` : ""}${error.message}`]
        if (error.hint) lines.push(`${GUTTER}hint  ${error.hint}`)
        if (error.docUrl) lines.push(`${GUTTER}docs  ${error.docUrl}`)
        stderr(`${lines.join("\n")}\n\n`)
        return 1
    }
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
    process.exit(runExportCredentials())
}

export { runExportCredentials }
