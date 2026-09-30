const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const semver = require("semver")

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

function appendSummary(text) {
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
    }
}

// user-facing lines go to the job summary too
function log(line) {
    console.log(line)
    appendSummary(`- ${line}\n`)
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

// The repo .npmrc sets min-release-age, which would hide versions published minutes ago.
function npmViewOrNull(args) {
    try {
        return run("npm", ["view", ...args, "--min-release-age=0"]).trim()
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
        log(`${workspace.name}: ${current} -> ${next}`)
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
function highestPrereleaseNumber(packageName, base, channel) {
    const pattern = new RegExp(`^${base.replace(/\./g, "\\.")}-${channel}\\.(\\d+)$`)
    const numbers = publishedVersions(packageName)
        .map((version) => version.match(pattern))
        .filter(Boolean)
        .map((match) => Number(match[1]))
    return numbers.length > 0 ? Math.max(...numbers) : 0
}

/**
 * One N for every package sharing a base. If the highest N is missing from any
 * of them, an earlier run stopped part way, so that N is reused and the
 * packages already on npm are skipped at publish time. Otherwise N moves on.
 */
function resolvePrereleaseNumber(highestByPackage) {
    const highest = Math.max(...highestByPackage)
    if (highest === 0) return 1
    return highestByPackage.every((n) => n === highest) ? highest + 1 : highest
}

/**
 * Highest version on npm below `version` on the same channel or stable. Release notes
 * cover the commits since its gitHead, so the sha is only returned when npm has one.
 */
function previousRelease(packageName, version, channel) {
    const previous = publishedVersions(packageName)
        .filter((candidate) => matchesChannel(channel, candidate) || matchesChannel("latest", candidate))
        .filter((candidate) => semver.lt(candidate, version))
        .sort(semver.rcompare)[0]
    if (!previous) {
        return { version: "", sha: "" }
    }
    const gitHead = npmViewOrNull([`${packageName}@${previous}`, "gitHead"])
    return { version: previous, sha: /^[0-9a-f]{40}$/.test(gitHead || "") ? gitHead : "" }
}

function previousOutputs(coreVersion, channel) {
    const previous = previousRelease(workspaces.core.name, coreVersion, channel)
    if (previous.version) {
        const sha = previous.sha ? previous.sha.slice(0, 7) : "no gitHead"
        log(`previous release: ${workspaces.core.name}@${previous.version} (${sha})`)
    }
    return { previous_version: previous.version, previous_sha: previous.sha }
}

function waitForNpm(packageName, version, dryRun) {
    if (dryRun) {
        return
    }
    const attempts = 60
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (versionExists(packageName, version)) {
            return
        }
        if (attempt < attempts) {
            console.log(`waiting for ${packageName}@${version} on npm (${attempt}/${attempts})`)
            execFileSync("sleep", ["10"])
        }
    }
    fail(`${packageName}@${version} was not visible on npm after ${attempts} attempts`)
}

function publishWorkspace(workspace, version, channel, dryRun) {
    if (versionExists(workspace.name, version)) {
        log(`${workspace.name}@${version} already on npm, skipping publish`)
        if (npmViewOrNull([`${workspace.name}@${channel}`, "version"]) !== version) {
            if (dryRun) {
                log(`would move dist-tag ${channel} to ${workspace.name}@${version}`)
            } else {
                runInherit("npm", ["dist-tag", "add", `${workspace.name}@${version}`, channel])
            }
        }
        return
    }

    const publishArgs = ["publish", "--workspace", workspace.dir, "--tag", channel, "--access", "public"]

    if (dryRun) {
        log(`would publish ${workspace.name}@${version} --tag ${channel}`)
        runInherit("npm", [...publishArgs, "--dry-run"])
        return
    }

    runInherit("npm", publishArgs)
    log(`published ${workspace.name}@${version}`)
}

function pushTag(workspace, version, dryRun) {
    const tag = `${workspace.name}@${version}`
    try {
        run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`])
        log(`tag ${tag} already exists`)
        return
    } catch {
        // absent tag is the expected case
    }

    if (dryRun) {
        log(`would tag ${tag}`)
        return
    }

    run("git", ["tag", tag])
    runInherit("git", ["push", "origin", tag])
    log(`tagged ${tag}`)
}

function commandPublish(args) {
    const channel = args.values["--channel"]
    if (!channel || !channelPatterns[channel]) {
        fail("--channel must be latest, beta or canary")
    }

    const includeAi = args.flags.has("--include-ai")
    const dryRun = args.flags.has("--dry-run")
    const targets = []
    const pending = []

    appendSummary(`### Release: ${channel}${dryRun ? " (dry run)" : ""}\n\n`)

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
        pending.push({ workspace, base })
    }

    for (const base of new Set(pending.map((entry) => entry.base))) {
        const group = pending.filter((entry) => entry.base === base)
        const number = resolvePrereleaseNumber(
            group.map((entry) => highestPrereleaseNumber(entry.workspace.name, base, channel))
        )
        for (const { workspace } of group) {
            const version = `${base}-${channel}.${number}`
            setVersion(workspace, version)
            targets.push({ workspace, version })
        }
    }

    if (targets.length === 0) {
        log("nothing to publish")
        const coreVersion = readManifest(workspaces.core).version
        writeOutputs({
            published: "false",
            core_version: coreVersion,
            ...previousOutputs(coreVersion, channel),
        })
        return
    }

    for (const target of targets) {
        if (!matchesChannel(channel, target.version)) {
            fail(`${target.workspace.name}@${target.version} is not a valid ${channel} version`)
        }
        log(`${target.workspace.name}@${target.version} -> ${channel}`)
    }

    const coreTarget = targets.find((target) => target.workspace === workspaces.core)
    const templatePin = coreTarget ? coreTarget.version : readManifest(workspaces.core).version

    if (!coreTarget && !versionExists(workspaces.core.name, templatePin)) {
        fail(`template pin catalyst-core@${templatePin} is not published on npm`)
    }

    const previous = previousOutputs(templatePin, channel)

    syncTemplates(templatePin)

    if (channel === "latest") {
        runInherit("node", [checkStableDepsScript, workspaces.core.dir, workspaces.cca.dir])
    }

    // core's prepublishOnly runs the build, under --dry-run too. Tag before waiting on
    // npm so a timed-out wait does not leave a published version untagged.
    for (const target of targets) {
        publishWorkspace(target.workspace, target.version, channel, dryRun)
        if (channel === "latest") {
            pushTag(target.workspace, target.version, dryRun)
        }
        if (target.workspace === workspaces.core) {
            waitForNpm(target.workspace.name, target.version, dryRun)
        }
    }

    writeOutputs({
        core_version: templatePin,
        core_published: String(!dryRun && targets.some((target) => target.workspace === workspaces.core)),
        published: dryRun ? "false" : "true",
        sha: run("git", ["rev-parse", "HEAD"]).trim(),
        ...previous,
    })
}

module.exports = { resolvePrereleaseNumber, previousRelease }

if (require.main === module) {
    const [subcommand, ...rest] = process.argv.slice(2)
    const parsed = parseArgs(rest)

    if (subcommand === "version") {
        commandVersion(parsed)
    } else if (subcommand === "publish") {
        commandPublish(parsed)
    } else {
        fail("usage: release.js <version|publish> [options]")
    }
}
