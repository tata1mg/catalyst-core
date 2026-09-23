const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")

const repoRoot = path.resolve(__dirname, "..", "..")
const syncTemplatesScript = path.join(repoRoot, "scripts", "release", "sync-cca-templates.js")
const checkStableDepsScript = path.join(repoRoot, "scripts", "release", "check-stable-deps.js")

const workspaces = {
    core: { dir: "packages/catalyst-core", name: "catalyst-core" },
    cca: { dir: "packages/create-catalyst-app", name: "create-catalyst-app" },
    ai: { dir: "packages/catalyst-ai", name: "catalyst-ai" },
}

const channelPatterns = {
    latest: /^\d+\.\d+\.\d+$/,
    beta: /^\d+\.\d+\.\d+-beta\.\d+$/,
    canary: /^\d+\.\d+\.\d+-canary\.\d+$/,
}

function fail(message) {
    console.error(message)
    process.exit(1)
}

function matchesChannel(channel, version) {
    return channelPatterns[channel].test(version)
}

function run(command, args, options = {}) {
    return execFileSync(command, args, { cwd: repoRoot, encoding: "utf8", stdio: "pipe", ...options })
}

function runInherit(command, args) {
    execFileSync(command, args, { cwd: repoRoot, stdio: "inherit" })
}

function npmViewOrNull(args) {
    try {
        return run("npm", ["view", ...args]).trim()
    } catch {
        return null
    }
}

function publishedVersions(packageName) {
    const output = npmViewOrNull([packageName, "versions", "--json"])
    if (!output) {
        return []
    }
    const parsed = JSON.parse(output)
    return Array.isArray(parsed) ? parsed : [parsed]
}

function versionExists(packageName, version) {
    return Boolean(npmViewOrNull([`${packageName}@${version}`, "version"]))
}

function manifestPath(workspace) {
    return path.join(repoRoot, workspace.dir, "package.json")
}

function readManifest(workspace) {
    return JSON.parse(fs.readFileSync(manifestPath(workspace), "utf8"))
}

function setVersion(workspace, version) {
    run("npm", ["pkg", "set", `version=${version}`, "--workspace", workspace.dir])
}

function selectedWorkspaces(includeAi) {
    const selected = [workspaces.core, workspaces.cca]
    if (includeAi) {
        selected.push(workspaces.ai)
    }
    return selected
}

function writeOutputs(entries) {
    const outputFile = process.env.GITHUB_OUTPUT
    if (!outputFile) {
        return
    }
    const lines = Object.entries(entries)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${value}\n`)
    fs.appendFileSync(outputFile, lines.join(""))
}

function parseArgs(argv) {
    const args = { flags: new Set(), values: {} }
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (!arg.startsWith("--")) {
            fail(`unexpected argument '${arg}'`)
        }
        if (arg === "--include-ai" || arg === "--dry-run") {
            args.flags.add(arg)
            continue
        }
        const next = argv[index + 1]
        if (!next || next.startsWith("--")) {
            fail(`${arg} requires a value`)
        }
        args.values[arg] = next
        index += 1
    }
    return args
}

/** --version (core, cca) or --ai-version (ai): the X.Y.Z base, always explicit. */
function requiredBase(args, workspace) {
    const flag = workspace === workspaces.ai ? "--ai-version" : "--version"
    const base = args.values[flag]
    if (!base) fail(`${flag} is required (X.Y.Z)`)
    if (!channelPatterns.latest.test(base)) fail(`${flag} must be X.Y.Z (got '${base}')`)
    return base
}

function syncTemplates(coreVersion) {
    runInherit("node", [syncTemplatesScript, `--package-version=${coreVersion}`])
}

function commandVersion(args) {
    const includeAi = args.flags.has("--include-ai")
    const versions = {}

    for (const workspace of selectedWorkspaces(includeAi)) {
        const current = readManifest(workspace).version
        const next = requiredBase(args, workspace)

        if (versionExists(workspace.name, next)) {
            fail(`${workspace.name}@${next} already exists on npm`)
        }

        setVersion(workspace, next)
        versions[workspace.name] = next
        console.log(`${workspace.name}: ${current} -> ${next}`)
    }

    syncTemplates(versions[workspaces.core.name])
    runInherit("npm", ["install", "--package-lock-only", "--ignore-scripts"])

    writeOutputs({
        core_version: versions[workspaces.core.name],
        cca_version: versions[workspaces.cca.name],
        ai_version: versions[workspaces.ai.name],
    })
}

// next prerelease number for `<base>-<channel>.N`, starting at 1
function nextPrereleaseVersion(workspace, base, channel) {
    const pattern = new RegExp(`^${base.replace(/\./g, "\\.")}-${channel}\\.(\\d+)$`)
    const numbers = publishedVersions(workspace.name)
        .map((version) => version.match(pattern))
        .filter(Boolean)
        .map((match) => Number(match[1]))

    return `${base}-${channel}.${numbers.length > 0 ? Math.max(...numbers) + 1 : 1}`
}

function waitForNpm(packageName, version, dryRun) {
    if (dryRun) {
        return
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (versionExists(packageName, version)) {
            return
        }
        if (attempt < 3) {
            console.log(`waiting for ${packageName}@${version} on npm (${attempt}/3)`)
            execFileSync("sleep", ["10"])
        }
    }
    fail(`${packageName}@${version} was not visible on npm after 3 attempts`)
}

function publishWorkspace(workspace, version, channel, dryRun) {
    if (versionExists(workspace.name, version)) {
        console.log(`${workspace.name}@${version} already on npm, skipping publish`)
        if (npmViewOrNull([`${workspace.name}@${channel}`, "version"]) !== version) {
            if (dryRun) {
                console.log(`would move dist-tag ${channel} to ${workspace.name}@${version}`)
            } else {
                runInherit("npm", ["dist-tag", "add", `${workspace.name}@${version}`, channel])
            }
        }
        return
    }

    const publishArgs = ["publish", "--workspace", workspace.dir, "--tag", channel, "--access", "public"]

    if (dryRun) {
        console.log(`would publish ${workspace.name}@${version} --tag ${channel}`)
        runInherit("npm", [...publishArgs, "--dry-run"])
        return
    }

    runInherit("npm", publishArgs)
}

function pushTag(workspace, version, dryRun) {
    const tag = `${workspace.name}@${version}`
    try {
        run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`])
        console.log(`tag ${tag} already exists`)
        return
    } catch {
        // absent tag is the expected case
    }

    if (dryRun) {
        console.log(`would tag ${tag}`)
        return
    }

    run("git", ["tag", tag])
    runInherit("git", ["push", "origin", tag])
}

function commandPublish(args) {
    const channel = args.values["--channel"]
    if (!channel || !channelPatterns[channel]) {
        fail("--channel must be latest, beta or canary")
    }

    const includeAi = args.flags.has("--include-ai")
    const dryRun = args.flags.has("--dry-run")
    const targets = []

    // on latest the version filter decides what ships, so consider every workspace;
    // --include-ai only widens the prerelease channels
    const candidates = channel === "latest" ? Object.values(workspaces) : selectedWorkspaces(includeAi)

    for (const workspace of candidates) {
        const current = readManifest(workspace).version

        if (channel === "latest") {
            if (matchesChannel("latest", current) && !versionExists(workspace.name, current)) {
                targets.push({ workspace, version: current })
            }
            continue
        }

        const base = requiredBase(args, workspace)
        if (versionExists(workspace.name, base)) {
            fail(`${workspace.name}@${base} is already a published stable release, pick a new version`)
        }

        const version = nextPrereleaseVersion(workspace, base, channel)
        setVersion(workspace, version)
        targets.push({ workspace, version })
    }

    if (targets.length === 0) {
        console.log("nothing to publish")
        writeOutputs({ published: "false" })
        return
    }

    for (const target of targets) {
        if (!matchesChannel(channel, target.version)) {
            fail(`${target.workspace.name}@${target.version} is not a valid ${channel} version`)
        }
        console.log(`${target.workspace.name}@${target.version} -> ${channel}`)
    }

    const coreTarget = targets.find((target) => target.workspace === workspaces.core)
    const templatePin = coreTarget ? coreTarget.version : readManifest(workspaces.core).version

    if (!coreTarget && !versionExists(workspaces.core.name, templatePin)) {
        fail(`template pin catalyst-core@${templatePin} is not published on npm`)
    }

    syncTemplates(templatePin)

    if (channel === "latest") {
        runInherit("node", [checkStableDepsScript, workspaces.core.dir, workspaces.cca.dir])
    }

    // core's prepublishOnly runs the build, under --dry-run too
    for (const target of targets) {
        publishWorkspace(target.workspace, target.version, channel, dryRun)
        if (target.workspace === workspaces.core) {
            waitForNpm(target.workspace.name, target.version, dryRun)
        }
        if (channel === "latest") {
            pushTag(target.workspace, target.version, dryRun)
        }
    }

    writeOutputs({
        core_version: templatePin,
        core_published: String(!dryRun && targets.some((target) => target.workspace === workspaces.core)),
        published: dryRun ? "false" : "true",
        sha: run("git", ["rev-parse", "HEAD"]).trim(),
    })
}

const [subcommand, ...rest] = process.argv.slice(2)
const parsed = parseArgs(rest)

if (subcommand === "version") {
    commandVersion(parsed)
} else if (subcommand === "publish") {
    commandPublish(parsed)
} else {
    fail("usage: release.js <version|publish> [options]")
}
