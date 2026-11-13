"use strict"

/**
 * What differs between operating systems, in one place.
 *
 * CommonJS for the same reason as theme.js: src/native is CJS and src/scripts is
 * ESM, and this is the only form both can consume. Everything reads
 * process.platform when called rather than at load, so tests can stand in for
 * the other platform.
 */

const isWindows = () => process.platform === "win32"

/**
 * The app the command was run in.
 *
 * PWD belongs to POSIX shells. PowerShell and cmd.exe never set it, so on Windows
 * it is either missing or stale: inherited from the Git Bash that launched the
 * terminal, and pointing at some other project. Only the OS's own answer can be
 * trusted there. Elsewhere PWD stays preferred, because it keeps the path the
 * user typed when a symlink led to the app.
 */
function appRoot() {
    return isWindows() ? process.cwd() : process.env.PWD || process.cwd()
}

/**
 * One argument for a cmd.exe command line, using the quoting the Microsoft C
 * runtime parses: backslashes are only special in front of a quote, so those get
 * doubled. Arguments cmd.exe would act on (& | < > ^ ( ) % !) are quoted too.
 */
function quoteWindowsArg(arg) {
    const text = String(arg)
    if (text && !/[\s"&|<>^()%!]/.test(text)) return text
    return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`
}

// What cmd.exe acts on even inside quotes: %VAR% is expanded there, a quote
// ends the quoting, and a line break ends the command.
const UNSAFE_FOR_CMD = /[%"\r\n\0]/

/**
 * The spawn() call that runs a batch file with these arguments. Node refuses to
 * spawn .bat and .cmd files directly (EINVAL since CVE-2024-27980), so it goes
 * through cmd.exe, with the whole line quoted once more for its /s switch.
 *
 * The paths here come from config and the environment (the SDK location, the
 * project folder), so anything cmd.exe would still read as syntax is refused
 * rather than passed on. cmd.exe is named, not taken from ComSpec.
 */
function batchInvocation(batchFile, args = []) {
    for (const arg of [batchFile, ...args]) {
        if (UNSAFE_FOR_CMD.test(String(arg))) {
            throw new Error(
                `Cannot pass ${JSON.stringify(String(arg))} to a batch file: cmd.exe would read its % or quote as syntax. Use a path without them.`
            )
        }
    }
    const line = [batchFile, ...args].map(quoteWindowsArg).join(" ")
    return {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", `"${line}"`],
        options: { windowsVerbatimArguments: true },
    }
}

/** Advice for freeing a port, in commands that exist on this machine. */
function freePortCommand(port) {
    return isWindows()
        ? `netstat -ano | findstr :${port}, then taskkill /PID <pid> /F`
        : `lsof -ti :${port} | xargs kill`
}

/** The command that stops one process, as a person would type it. */
function stopProcessCommand(pid) {
    return isWindows() ? `taskkill /PID ${pid} /F` : `kill ${pid}`
}

module.exports = { isWindows, appRoot, quoteWindowsArg, batchInvocation, freePortCommand, stopProcessCommand }
