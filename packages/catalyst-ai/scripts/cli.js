#!/usr/bin/env node
// catalyst-ai command line. Only `pricing` for now.
const commands = { pricing: () => require("./pricing-cli.js").run }

const [name, ...rest] = process.argv.slice(2)
if (!name || name === "--help" || name === "-h" || !commands[name]) {
    const known = Object.keys(commands).join(", ")
    process.stdout.write(`Usage: catalyst-ai <command>\n\nCommands: ${known}\n`)
    process.exit(name && !["--help", "-h"].includes(name) ? 2 : 0)
}
commands[name]()(rest).then(
    (code) => process.exit(code),
    (error) => {
        process.stderr.write(`${error.message}\n`)
        process.exit(1)
    }
)
