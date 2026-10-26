"use strict"

/**
 * Hints for failures we actually understand.
 *
 * Deliberately a short list. A hint that guesses is worse than no hint: it
 * sends people down the wrong path with false confidence. Only add an entry
 * when the pattern reliably implies the cause, and say what to *do*, not what
 * went wrong -- the message above the hint already said that.
 */
const HINTS = [
    {
        test: /Failed to resolve import ["']([^"']+)["']/,
        hint: (match) =>
            match[1].startsWith("@")
                ? `The alias ${match[1].split("/")[0]} is not defined in package.json _moduleAliases. Add it, or import with a relative path.`
                : `Check the path, or install the package with npm install ${match[1]}.`,
        docs: "https://catalyst.1mg.com/errors/unresolved-import",
    },
    {
        test: /EADDRINUSE[^0-9]*(?:address already in use\s*)?(\S*?:?(\d+))?\s*$/i,
        hint: (match) => {
            const port = match[2]
            const where = port ? `port ${port}` : "that port"
            return port
                ? `Something is already on ${where}. Free it with \`lsof -ti :${port} | xargs kill\`, or set NODE_SERVER_PORT in config/config.json.`
                : `Something is already on ${where}. Stop it, or set NODE_SERVER_PORT in config/config.json.`
        },
    },
    {
        test: /SDK location not found|ANDROID_HOME/i,
        hint: () =>
            "Set the Android SDK path in config/config.json under WEBVIEW_CONFIG.android.sdkPath, or export ANDROID_HOME.",
    },
    {
        test: /No booted simulator found/i,
        hint: () => "Open Simulator and boot a device, or run catalyst setupEmulator:ios.",
    },
    {
        test: /Unknown AVD name|no such file or directory.*avd/i,
        hint: () =>
            "That emulator does not exist. List the ones you have with `emulator -list-avds`, then set WEBVIEW_CONFIG.android.emulatorName.",
    },
    {
        test: /Command not found: (.+)/,
        hint: (match) =>
            `${match[1].trim()} is not on PATH. Install it, or correct the path in config/config.json.`,
    },
    {
        test: /code signing|CODE_SIGN|provisioning profile/i,
        hint: () =>
            "Open the project in Xcode once and pick a signing team, or build for the simulator instead of a device.",
    },
]

/**
 * @param {string} message
 * @returns {{hint: string, docs?: string}|null}
 */
function hintFor(message) {
    if (!message) return null
    for (const entry of HINTS) {
        const match = entry.test.exec(message)
        if (match) return { hint: entry.hint(match), docs: entry.docs }
    }
    return null
}

module.exports = { hintFor }
