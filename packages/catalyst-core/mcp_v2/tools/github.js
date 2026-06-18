"use strict"

/**
 * tools/github.js - Catalyst MCP v2
 *
 * GitHub issue workflow for AI agents:
 *   1. start_github_issue_flow      - tells the LLM what details to collect
 *   2. gather_github_issue_context  - reads project/framework context for triage
 *   3. preview_github_feedback      - formats the issue and checks duplicate candidates
 *   4. create_github_issue          - publishes after duplicate review, with markdown fallback
 *   5. generate_issue_markdown      - manual fallback when auth/API is unavailable
 *
 * Authentication:
 *   1. GITHUB_TOKEN environment variable
 *   2. GitHub CLI session (`gh auth token`)
 */

const fs = require("fs")
const path = require("path")
const https = require("https")
const { execSync } = require("child_process")

let _projectInfo = null

const GITHUB_OWNER = "tata1mg"
const GITHUB_REPO = "catalyst-core"
const FALLBACK_DIR = ".mcp_issues"

const DEFAULT_LABELS = [
    "bug",
    "dependencies",
    "documentation",
    "duplicate",
    "enhancement",
    "good first issue",
    "help wanted",
    "invalid",
    "question",
    "wontfix",
]

const LABEL_GUIDANCE = {
    bug: "Something is broken, regressed, ignored, crashes, or behaves differently from the documented/configured behavior.",
    dependencies: "Dependency/package update work, package-lock changes, npm audit fixes, or vulnerability remediation.",
    documentation: "Docs, README, examples, guides, migration notes, tutorials, or wording fixes.",
    duplicate: "The same issue already exists.",
    enhancement: "New capability, framework improvement, or actionable feature request.",
    "good first issue": "Small, well-scoped change suitable for newcomers.",
    "help wanted": "Needs extra maintainer/community attention or implementation help.",
    invalid: "The report is not applicable or does not describe a valid Catalyst problem.",
    question: "Needs clarification, usage guidance, or design direction before implementation.",
    wontfix: "A consciously unsupported or not-planned request.",
}

const ISSUE_TEMPLATES = {
    bug: {
        label: "bug",
        name: "Bug report",
        use_when: "Something is not working, is ignored, crashes, regresses, or differs from expected Catalyst behavior.",
        sections: [
            "Preflight Checklist",
            "What's Wrong?",
            "Steps to Reproduce",
            "Expected Behavior",
            "Actual Behavior",
            "Error Messages/Logs",
            "Environment",
            "What I Tried",
            "Additional Information",
            "Related Issues",
        ],
    },
    enhancement: {
        label: "enhancement",
        name: "Feature request / enhancement",
        use_when: "A new capability, universal hook behavior, CLI improvement, or framework ergonomics improvement is needed.",
        sections: [
            "Summary",
            "Motivation",
            "Proposed Behaviour",
            "Example Usage / Output",
            "Proposed Fix",
            "Optional Follow-ups",
        ],
    },
    documentation: {
        label: "documentation",
        name: "Documentation improvement",
        use_when: "Docs, examples, README, guides, migration notes, or API reference need to be added or corrected.",
        sections: [
            "Summary",
            "Current Documentation",
            "Suggested Documentation",
            "Affected Pages / Examples",
            "Optional Follow-ups",
        ],
    },
    dependencies: {
        label: "dependencies",
        name: "Dependency update",
        use_when: "A dependency, lockfile, audit finding, package version, or security update needs attention.",
        sections: [
            "Summary",
            "Current Dependency",
            "Target Dependency",
            "Reason / Impact",
            "Validation Plan",
        ],
    },
    question: {
        label: "question",
        name: "Question / clarification",
        use_when: "The report primarily asks for usage guidance, clarification, or a decision before implementation.",
        sections: [
            "Question",
            "Context",
            "What I Tried",
            "Expected Guidance",
        ],
    },
}

function init(projectInfo) {
    _projectInfo = projectInfo
}

function getProjectRoot(args = {}) {
    return args.project_path || (_projectInfo && _projectInfo.dir) || process.cwd()
}

function safeReadJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"))
    } catch {
        return null
    }
}

function safeReadText(filePath, maxBytes = 8000) {
    try {
        const content = fs.readFileSync(filePath, "utf8")
        return content.length > maxBytes ? `${content.slice(0, maxBytes)}\n...[truncated]` : content
    } catch {
        return null
    }
}

function runGit(root, command) {
    try {
        return execSync(command, {
            cwd: root,
            encoding: "utf8",
            timeout: 4000,
            stdio: ["ignore", "pipe", "ignore"],
        }).trim()
    } catch {
        return null
    }
}

function slugify(input) {
    return String(input || "github-issue")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "github-issue"
}

function ensureFallbackDir(root) {
    const dir = path.join(root, FALLBACK_DIR)
    fs.mkdirSync(dir, { recursive: true })
    return dir
}

function getToken() {
    const envToken = process.env.GITHUB_TOKEN
    if (envToken && envToken.trim()) {
        return { ok: true, token: envToken.trim(), source: "env:GITHUB_TOKEN" }
    }

    try {
        const ghToken = execSync("gh auth token", {
            encoding: "utf8",
            timeout: 4000,
            stdio: ["ignore", "pipe", "ignore"],
        }).trim()
        if (ghToken) return { ok: true, token: ghToken, source: "gh-cli" }
    } catch {
        // gh not installed or not logged in.
    }

    return {
        ok: false,
        error:
            "No GitHub credentials found. Run `gh auth login` with repo scope, or pass GITHUB_TOKEN in the MCP server environment.",
    }
}

function githubRequest(method, urlPath, token, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null
        const options = {
            hostname: "api.github.com",
            path: urlPath,
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "catalyst-mcp/2.0",
                "X-GitHub-Api-Version": "2022-11-28",
                ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
            },
        }

        const req = https.request(options, (res) => {
            let data = ""
            res.on("data", (chunk) => (data += chunk))
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) })
                } catch {
                    resolve({ status: res.statusCode, body: data })
                }
            })
        })

        req.on("error", reject)
        if (payload) req.write(payload)
        req.end()
    })
}

function normalizeLabels(labels) {
    if (!Array.isArray(labels)) return []
    const seen = new Set()
    return labels
        .filter((label) => typeof label === "string")
        .map((label) => label.trim().toLowerCase())
        .filter((label) => {
            if (!label || !DEFAULT_LABELS.includes(label) || seen.has(label)) return false
            seen.add(label)
            return true
        })
}

function inferPrimaryLabel(title, body) {
    const text = `${title || ""}\n${body || ""}`.toLowerCase()

    if (/\b(dependenc|package-lock|package\.json|npm audit|vulnerab|upgrade package)\b/.test(text)) {
        return "dependencies"
    }
    if (/\b(doc|docs|documentation|readme|guide|tutorial|typo)\b/.test(text)) {
        return "documentation"
    }
    if (/\b(bug|broken|fail|error|exception|crash|incorrect|ignored|not working|regression)\b/.test(text)) {
        return "bug"
    }
    if (/\b(question|how do|how to|clarify|doubt)\b/.test(text)) {
        return "question"
    }

    return "enhancement"
}

function resolveIssueTemplate(args, body) {
    const requested = typeof args.issue_template === "string" ? args.issue_template.trim().toLowerCase() : ""
    if (ISSUE_TEMPLATES[requested]) return requested

    const labels = normalizeLabels(args.labels)
    const templateLabel = labels.find((label) => ISSUE_TEMPLATES[label])
    if (templateLabel) return templateLabel

    const inferred = inferPrimaryLabel(args.title, body)
    return ISSUE_TEMPLATES[inferred] ? inferred : "enhancement"
}

function resolveIssueLabels(args, body) {
    const labels = normalizeLabels(args.labels)
    if (labels.length > 0) return labels

    return [resolveIssueTemplate(args, body)]
}

function stripExistingFooter(body) {
    return String(body || "")
        .replace(/\n---\n(?:\*\*(?:Project|catalyst-core version|Project path|Reported via):\*\*.*\n?)+$/m, "")
        .trim()
}

function hasMarkdownHeadings(body) {
    return /^#{2,3}\s+\S/m.test(body || "")
}

function toMarkdownList(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
            .map((item, index) => {
                if (/^\d+\.\s/.test(item) || /^[-*]\s/.test(item)) return item
                return `${index + 1}. ${item}`
            })
            .join("\n")
    }
    return typeof value === "string" ? value.trim() : ""
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim()
    }
    return ""
}

function appendSection(sections, heading, content) {
    const text = Array.isArray(content) ? toMarkdownList(content) : firstNonEmpty(content)
    if (text) sections.push(`## ${heading}\n\n${text}`)
}

function buildPreflightChecklist(args) {
    const checklist = Array.isArray(args.preflight_checklist)
        ? args.preflight_checklist
        : [
              "I have searched existing issues and this has not already been reported.",
              "This is a single issue, not a bundle of unrelated issues.",
              "I have included reproduction steps, environment details, and logs where available.",
          ]

    return checklist
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .map((item) => (item.startsWith("[") ? `- ${item}` : `- [x] ${item}`))
        .join("\n")
}

function buildStyledIssueSections(args) {
    const rawBody = stripExistingFooter(args.body)

    if (rawBody && hasMarkdownHeadings(rawBody)) {
        return rawBody
    }

    const sections = []
    const template = resolveIssueTemplate(args, rawBody)

    if (template === "documentation") {
        appendSection(sections, "Summary", firstNonEmpty(args.summary, rawBody))
        appendSection(sections, "Current Documentation", firstNonEmpty(args.current_behavior, args.actual_behavior))
        appendSection(sections, "Suggested Documentation", firstNonEmpty(args.expected_behavior, args.proposed_fix, args.suggested_fix))
        appendSection(sections, "Affected Pages / Examples", args.steps_to_reproduce || args.repro)
        appendSection(sections, "Optional Follow-ups", args.optional_followups || args.follow_ups)
        return sections.join("\n\n").trim()
    }

    if (template === "dependencies") {
        appendSection(sections, "Summary", firstNonEmpty(args.summary, rawBody))
        appendSection(sections, "Current Dependency", firstNonEmpty(args.current_behavior, args.actual_behavior))
        appendSection(sections, "Target Dependency", args.expected_behavior)
        appendSection(sections, "Reason / Impact", firstNonEmpty(args.root_cause, args.notes))
        appendSection(sections, "Validation Plan", args.steps_to_reproduce || args.repro)
        return sections.join("\n\n").trim()
    }

    if (template === "question") {
        appendSection(sections, "Question", firstNonEmpty(args.summary, rawBody))
        appendSection(sections, "Context", firstNonEmpty(args.current_behavior, args.actual_behavior, args.root_cause, args.notes))
        appendSection(sections, "What I Tried", args.steps_to_reproduce || args.repro)
        appendSection(sections, "Expected Guidance", args.expected_behavior)
        return sections.join("\n\n").trim()
    }

    if (template === "enhancement") {
        appendSection(sections, "Summary", firstNonEmpty(args.summary, rawBody))
        appendSection(sections, "Motivation", firstNonEmpty(args.current_behavior, args.actual_behavior, args.root_cause, args.notes))
        appendSection(sections, "Proposed Behaviour", args.expected_behavior)
        appendSection(sections, "Example Usage / Output", args.steps_to_reproduce || args.repro)
        appendSection(sections, "Proposed Fix", firstNonEmpty(args.proposed_fix, args.suggested_fix))
        appendSection(sections, "Optional Follow-ups", args.optional_followups || args.follow_ups)
        return sections.join("\n\n").trim()
    }

    appendSection(sections, "Preflight Checklist", buildPreflightChecklist(args))
    appendSection(sections, "What's Wrong?", firstNonEmpty(args.summary, rawBody))
    appendSection(sections, "Steps to Reproduce", args.steps_to_reproduce || args.repro)
    appendSection(sections, "Expected Behavior", args.expected_behavior)
    appendSection(sections, "Actual Behavior", firstNonEmpty(args.actual_behavior, args.current_behavior))
    appendSection(sections, "Error Messages/Logs", args.error_logs ? `\`\`\`\n${args.error_logs}\n\`\`\`` : "")
    appendSection(sections, "Environment", args.environment)
    appendSection(sections, "What I Tried", args.what_i_tried || args.what_tried)
    appendSection(sections, "Additional Information", firstNonEmpty(args.additional_information, args.root_cause, args.notes, args.proposed_fix, args.suggested_fix))
    appendSection(sections, "Related Issues", args.related_issues)

    return sections.join("\n\n").trim()
}

function normalizeImages(images, root) {
    if (!Array.isArray(images)) return { markdown: "", local_files: [], remote_urls: [] }

    const localFiles = []
    const remoteUrls = []
    const lines = []

    for (const image of images) {
        const value = typeof image === "string" ? { path: image } : image
        if (!value || typeof value !== "object") continue

        const raw = value.url || value.path || value.file
        if (!raw || typeof raw !== "string") continue

        const alt = typeof value.alt === "string" && value.alt.trim() ? value.alt.trim() : "attachment"
        if (/^https?:\/\//i.test(raw)) {
            remoteUrls.push(raw)
            lines.push(`![${alt}](${raw})`)
            continue
        }

        const absolutePath = path.isAbsolute(raw) ? raw : path.resolve(root, raw)
        const exists = fs.existsSync(absolutePath)
        localFiles.push({ path: absolutePath, exists })
        lines.push(`- ${absolutePath}${exists ? "" : " (not found)"}`)
    }

    if (lines.length === 0) return { markdown: "", local_files: localFiles, remote_urls: remoteUrls }

    return {
        markdown: ["", "## Attachments", "", ...lines].join("\n"),
        local_files: localFiles,
        remote_urls: remoteUrls,
    }
}

function buildIssueBody(args, options = {}) {
    const root = getProjectRoot(args)
    const images = normalizeImages(args.images, root)
    const sections = []
    const styledBody = buildStyledIssueSections(args)

    if (styledBody) sections.push(styledBody)

    const labels = resolveIssueLabels(args, styledBody)
    if (labels.length > 0) {
        sections.push(
            [
                "## Suggested Labels",
                "",
                labels.map((label) => `\`${label}\``).join(", "),
                "",
                "> These labels are included in the GitHub API request. If they are not visible on the issue, the token/user likely does not have permission to apply labels.",
            ].join("\n")
        )
    }

    if (args.context) {
        const context = typeof args.context === "string" ? args.context : JSON.stringify(args.context, null, 2)
        sections.push(`## Catalyst/Project Context\n\n\`\`\`json\n${context}\n\`\`\``)
    }

    if (args.environment && resolveIssueTemplate(args, styledBody) !== "bug") {
        const environment = typeof args.environment === "string" ? args.environment : JSON.stringify(args.environment, null, 2)
        sections.push(`## Environment\n\n${environment}`)
    }

    if (args.duplicate_review_note && typeof args.duplicate_review_note === "string") {
        sections.push(`## Duplicate Review\n\n${args.duplicate_review_note.trim()}`)
    }

    if (images.markdown) sections.push(images.markdown.trim())

    const body = sections.filter(Boolean).join("\n\n").trim()
    return {
        body: options.enrich === false ? body : enrichBody(body),
        images,
    }
}

function enrichBody(body) {
    const lines = [stripExistingFooter(body), "", "---"]
    if (_projectInfo) {
        if (_projectInfo.pkg && _projectInfo.pkg.name) {
            lines.push(`**Project:** \`${_projectInfo.pkg.name}\``)
        }
        const version = _projectInfo.installedVersion || _projectInfo.catalystVersion || "unknown"
        lines.push(`**catalyst-core version:** \`${version}\``)
        if (_projectInfo.dir) {
            lines.push(`**Project path:** \`${_projectInfo.dir}\``)
        }
    }
    lines.push("**Reported via:** Catalyst MCP v2")
    return lines.join("\n")
}

function extractKeywords(title, body) {
    const stopWords = new Set([
        "a",
        "an",
        "the",
        "is",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "and",
        "or",
        "but",
        "not",
        "with",
        "this",
        "that",
        "can",
        "how",
        "does",
        "issue",
        "bug",
    ])
    const tokenise = (str) =>
        String(str || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((word) => word.length > 2 && !stopWords.has(word))

    const titleWords = tokenise(title).slice(0, 5)
    const bodyWords = tokenise(body)
        .filter((word) => !titleWords.includes(word))
        .slice(0, 3)

    return [...titleWords, ...bodyWords].join(" ")
}

async function searchDuplicates(token, title, body) {
    const keywords = extractKeywords(title, body)
    if (!keywords) return []

    try {
        const q = encodeURIComponent(`repo:${GITHUB_OWNER}/${GITHUB_REPO} ${keywords} in:title,body is:issue`)
        const res = await githubRequest("GET", `/search/issues?q=${q}&per_page=5`, token)
        if (res.status === 200 && Array.isArray(res.body.items)) {
            return res.body.items.slice(0, 5).map((issue) => ({
                number: issue.number,
                title: issue.title,
                url: issue.html_url,
                state: issue.state,
            }))
        }
    } catch {
        // Duplicate detection is best-effort.
    }
    return []
}

async function addLabelsToIssue(token, issueNumber, labels) {
    if (!Array.isArray(labels) || labels.length === 0) {
        return { ok: true, labels: [] }
    }

    const res = await githubRequest(
        "POST",
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/labels`,
        token,
        { labels }
    )

    if (res.status === 200 && Array.isArray(res.body)) {
        return {
            ok: true,
            labels: res.body.map((label) => label.name),
        }
    }

    const apiMessage = res.body && res.body.message ? res.body.message : JSON.stringify(res.body)
    return {
        ok: false,
        status: res.status,
        error: `GitHub API returned HTTP ${res.status}: ${apiMessage}`,
    }
}

async function commentOnIssue(token, issueNumber, body) {
    if (!body || typeof body !== "string" || !body.trim()) {
        return { ok: true }
    }

    const res = await githubRequest(
        "POST",
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments`,
        token,
        { body: body.trim() }
    )

    if (res.status === 201) {
        return { ok: true, url: res.body.html_url }
    }

    const apiMessage = res.body && res.body.message ? res.body.message : JSON.stringify(res.body)
    return {
        ok: false,
        status: res.status,
        error: `GitHub API returned HTTP ${res.status}: ${apiMessage}`,
    }
}

function handle_start_issue_creation(args = {}) {
    const initialBody = args.problem || args._query || ""
    const suggestedTemplate = resolveIssueTemplate({ ...args, title: args.problem || args._query || "", body: initialBody }, initialBody)
    const suggestedLabels = resolveIssueLabels({ ...args, title: args.problem || args._query || "", body: initialBody }, initialBody)

    return {
        ok: true,
        mode: "github_issue_agent",
        repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
        when_to_use: [
            "Use this flow when the developer explicitly asks to create/raise/report/publish a GitHub issue for catalyst-core.",
            "Use this flow when, during another task, the LLM identifies that the failure is likely caused by catalyst-core framework behavior. In that case, ask the developer whether they want to create a GitHub issue before gathering/publishing.",
        ],
        approval_gates: [
            "Ask the developer whether they want to create a GitHub issue if the issue was inferred during another task.",
            "Suggest the best template and labels; ask whether the developer accepts them or wants changes.",
            "Search existing GitHub issues for duplicate candidates and show any matches to the developer before publishing.",
            "If duplicate candidates exist, ask whether to cancel, update/comment on the existing issue manually, or continue because this is distinct.",
            "Show the final rendered issue preview, including screenshots/attachments and labels, before publishing.",
            "Call create_github_issue only after explicit developer approval.",
        ],
        next_steps: [
            "Ask the developer for a concise issue title and problem statement if not already known.",
            "Collect steps to reproduce, expected behavior, actual behavior, error logs, environment, what was tried, related issues, and screenshot/image paths or URLs if available.",
            "Call gather_github_issue_context with the title/problem so the issue includes catalyst-core version, package scripts, git state, and relevant file snippets.",
            "Call preview_github_feedback to select/render the issue template, suggested labels, project context, screenshots/attachments, and duplicate candidates.",
            "Show duplicate candidates first when present. If one is the same issue, stop and suggest using the existing issue instead of creating a duplicate.",
            "Show the preview to the developer and ask for approval or edits. If duplicates were shown and the developer still wants to publish, pass duplicate_review_confirmed:true to create_github_issue.",
            "After approval and duplicate review, call create_github_issue. If it returns ok:false with duplicate_candidates, show them and do not generate a new issue. If it fails due to auth/network/API, use the markdown_path fallback for manual GitHub creation.",
        ],
        supported_labels: DEFAULT_LABELS,
        label_guidance: LABEL_GUIDANCE,
        supported_templates: ISSUE_TEMPLATES,
        template_selection_rules: [
            "Use Bug report + bug for broken behavior, ignored config, crashes, regressions, incorrect output, or failed commands.",
            "Use Feature request / enhancement + enhancement for new APIs, CLI improvements, universal hook behavior, or framework ergonomics.",
            "Use Documentation improvement + documentation for missing/incorrect docs, examples, guides, README, migration notes, or typos.",
            "Use Dependency update + dependencies for package updates, lockfile updates, npm audit/security updates, or dependency version changes.",
            "Use Question / clarification + question when implementation is not yet clear and maintainer input is needed.",
            "Add good first issue only when the change is small and well-scoped; add help wanted when extra maintainer/community attention is needed.",
            "Use duplicate, invalid, or wontfix only after triage establishes that state.",
        ],
        suggested_template: ISSUE_TEMPLATES[suggestedTemplate],
        suggested_labels: suggestedLabels,
        image_support:
            "Hosted image URLs are embedded in the issue body. Local image files are listed in the body and copied into the markdown fallback for manual upload, because GitHub's public Issues API does not upload local binaries.",
        duplicate_policy:
            "The preview step performs a best-effort duplicate search. create_github_issue blocks publishing when matching issues are found unless duplicate_review_confirmed:true is provided after showing those candidates to the developer.",
        manual_fallback:
            "If GitHub auth, network, permission, or validation fails, call generate_issue_markdown or use the fallback returned by create_github_issue so the developer can raise the issue manually.",
        initial_problem: args.problem || args._query || null,
    }
}

function collectRelatedFiles(root, query, explicitFiles) {
    const files = []
    const candidates = Array.isArray(explicitFiles) ? explicitFiles : []
    for (const file of candidates) {
        if (typeof file !== "string") continue
        const absolute = path.isAbsolute(file) ? file : path.join(root, file)
        if (!absolute.startsWith(root)) continue
        const content = safeReadText(absolute, 12000)
        if (content) {
            files.push({ path: path.relative(root, absolute), content })
        }
    }

    if (files.length > 0 || !query) return files

    const words = extractKeywords(query, "").split(/\s+/).filter(Boolean).slice(0, 5)
    if (words.length === 0) return files

    const srcDir = path.join(root, "src")
    const matches = []
    function walk(dir) {
        let entries
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name === ".git") continue
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                walk(full)
            } else if (/\.(js|jsx|ts|tsx|json|scss|css|md|mdx)$/.test(entry.name)) {
                const content = safeReadText(full, 4000)
                if (content && words.some((word) => content.toLowerCase().includes(word))) {
                    matches.push({ path: path.relative(root, full), content })
                }
            }
            if (matches.length >= 5) return
        }
    }
    walk(srcDir)
    return matches.slice(0, 5)
}

function handle_gather_github_issue_context(args = {}) {
    const root = getProjectRoot(args)
    const pkg = safeReadJson(path.join(root, "package.json"))
    const configJson = safeReadJson(path.join(root, "config", "config.json"))
    const branch = runGit(root, "git rev-parse --abbrev-ref HEAD")
    const commit = runGit(root, "git rev-parse --short HEAD")
    const status = runGit(root, "git status --short")
    const nodeVersion = runGit(root, "node --version")
    const npmVersion = runGit(root, "npm --version")
    const relatedFiles = collectRelatedFiles(root, args.query || args.problem || args.title || "", args.files)

    const dependencies = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {}

    return {
        ok: true,
        context: {
            project_path: root,
            package_name: pkg && pkg.name,
            catalyst_core_declared_version: dependencies["catalyst-core"] || null,
            catalyst_core_installed_version: _projectInfo && _projectInfo.installedVersion,
            scripts: pkg && pkg.scripts ? pkg.scripts : {},
            config: configJson
                ? {
                      NODE_SERVER_PORT: configJson.NODE_SERVER_PORT,
                      WEBVIEW_CONFIG: configJson.WEBVIEW_CONFIG,
                  }
                : null,
            git: { branch, commit, dirty: Boolean(status), status },
            runtime: { node: nodeVersion, npm: npmVersion },
            related_files: relatedFiles,
        },
        instructions:
            "Use this context to enrich the issue body. Include only relevant file snippets; do not include secrets or unrelated config.",
    }
}

async function handle_preview_github_feedback(args = {}) {
    const { title, type = "issue" } = args

    if (!title || typeof title !== "string" || title.trim() === "") {
        return { ok: false, error: "title is required." }
    }
    if (type !== "issue") {
        return { ok: false, error: "Only GitHub issues are supported by this MCP tool." }
    }

    const built = buildIssueBody(args)
    if (!built.body || built.body.trim() === "") {
        return { ok: false, error: "body or structured issue fields are required." }
    }

    let duplicates = []
    let tokenSource = "none"
    const tokenResult = getToken()
    if (tokenResult.ok) {
        tokenSource = tokenResult.source
        duplicates = await searchDuplicates(tokenResult.token, title, built.body)
    }

    return {
        ok: true,
        preview: {
            type: "issue",
            repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
            title: title.trim(),
            body: built.body,
            labels: resolveIssueLabels(args, built.body),
            suggested_template: ISSUE_TEMPLATES[resolveIssueTemplate(args, built.body)],
            possible_labels: DEFAULT_LABELS,
            label_guidance: LABEL_GUIDANCE,
            images: built.images,
        },
        duplicates,
        duplicate_review: {
            required_before_publish: duplicates.length > 0,
            status: duplicates.length > 0 ? "needs_user_review" : "no_duplicate_candidates_found",
            candidates: duplicates,
            publish_override_field:
                duplicates.length > 0
                    ? "Pass duplicate_review_confirmed:true to create_github_issue only after the developer confirms this is not a duplicate."
                    : null,
        },
        token_source: tokenSource,
        instructions:
            duplicates.length > 0
                ? "Show the suggested template, labels, full issue body, attachments, and duplicate candidates to the developer. Ask whether to cancel/use an existing issue, edit, or publish because this is distinct. Call create_github_issue only after explicit approval, and include duplicate_review_confirmed:true if the developer chooses to publish."
                : "Show the suggested template, labels, full issue body, and attachments to the developer. Ask whether to edit, cancel, or publish. Call create_github_issue only after explicit approval.",
    }
}

function handle_generate_issue_markdown(args = {}) {
    const { title } = args
    if (!title || typeof title !== "string" || title.trim() === "") {
        return { ok: false, error: "title is required." }
    }

    const root = getProjectRoot(args)
    const built = buildIssueBody(args, { enrich: true })
    const labels = resolveIssueLabels(args, built.body)
    const dir = ensureFallbackDir(root)
    const filePath = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(title)}.md`)

    const markdown = [
        `# ${title.trim()}`,
        "",
        labels.length ? `Labels: ${labels.join(", ")}` : "Labels: none",
        "",
        `Repository: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/new`,
        "",
        "Copy the title, labels, and body below into GitHub. Upload any local image files listed under Attachments manually.",
        "",
        "## Body",
        "",
        built.body,
        "",
    ].join("\n")

    fs.writeFileSync(filePath, markdown, "utf8")

    return {
        ok: true,
        markdown_path: filePath,
        title: title.trim(),
        labels,
        local_images: built.images.local_files,
        github_new_issue_url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/new`,
    }
}

async function handle_create_github_issue(args = {}) {
    const { title } = args
    if (!title || typeof title !== "string" || title.trim() === "") {
        return { ok: false, error: "title is required and must be a non-empty string." }
    }

    const built = buildIssueBody(args)
    if (!built.body || built.body.trim() === "") {
        return { ok: false, error: "body or structured issue fields are required." }
    }

    const tokenResult = getToken()
    if (!tokenResult.ok) {
        const fallback = handle_generate_issue_markdown(args)
        return {
            ok: false,
            error: tokenResult.error,
            fallback: fallback.ok ? fallback : null,
        }
    }

    const labels = resolveIssueLabels(args, built.body)
    const payload = {
        title: title.trim(),
        body: built.body,
        labels,
    }

    try {
        const duplicates = await searchDuplicates(tokenResult.token, title, built.body)
        if (duplicates.length > 0 && args.duplicate_review_confirmed !== true) {
            return {
                ok: false,
                blocked: true,
                error:
                    "Possible duplicate GitHub issues were found. Show these candidates to the developer and publish only if they confirm this report is distinct.",
                duplicate_candidates: duplicates,
                next_action:
                    "If the developer confirms this is not a duplicate, call create_github_issue again with duplicate_review_confirmed:true and optionally duplicate_review_note.",
            }
        }

        const res = await githubRequest(
            "POST",
            `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
            tokenResult.token,
            payload
        )

        if (res.status === 201) {
            const returnedLabels = (res.body.labels || []).map((label) => label.name)
            const missingLabels = labels.filter((label) => !returnedLabels.includes(label))
            let finalLabels = returnedLabels
            let labelWarning = null

            if (missingLabels.length > 0) {
                const labelResult = await addLabelsToIssue(tokenResult.token, res.body.number, missingLabels)
                if (labelResult.ok) {
                    finalLabels = labelResult.labels
                } else {
                    labelWarning =
                        `Issue was created, but GitHub did not apply label(s): ${missingLabels.join(", ")}. ` +
                        `This usually means the token/user can create issues but does not have triage/write permission to manage labels. ${labelResult.error}`
                    const commentResult = await commentOnIssue(
                        tokenResult.token,
                        res.body.number,
                        [
                            "Catalyst MCP could not apply the requested GitHub label(s).",
                            "",
                            `Requested labels: ${missingLabels.map((label) => `\`${label}\``).join(", ")}`,
                            "",
                            "Please add these labels manually if appropriate. This usually means the token/user can create issues but does not have triage/write permission to manage labels.",
                        ].join("\n")
                    )
                    if (!commentResult.ok) {
                        labelWarning += ` MCP also could not add a label-warning comment. ${commentResult.error}`
                    }
                }
            }

            return {
                ok: true,
                message: labelWarning
                    ? `Issue #${res.body.number} created successfully, but labels need manual review.`
                    : `Issue #${res.body.number} created successfully.`,
                number: res.body.number,
                title: res.body.title,
                url: res.body.html_url,
                labels: finalLabels,
                requested_labels: labels,
                label_warning: labelWarning,
                state: res.body.state,
                token_source: tokenResult.source,
                local_images_requiring_manual_upload: built.images.local_files.filter((image) => image.exists),
            }
        }

        const apiMessage = res.body && res.body.message ? res.body.message : JSON.stringify(res.body)
        const fallback = handle_generate_issue_markdown(args)
        return {
            ok: false,
            error: `GitHub API returned HTTP ${res.status}: ${apiMessage}`,
            fallback: fallback.ok ? fallback : null,
        }
    } catch (err) {
        const fallback = handle_generate_issue_markdown(args)
        return {
            ok: false,
            error: `Network error while calling GitHub API: ${err.message}`,
            fallback: fallback.ok ? fallback : null,
        }
    }
}

module.exports = {
    init,
    handle_start_issue_creation,
    handle_start_github_issue_flow: handle_start_issue_creation,
    handle_gather_github_issue_context,
    handle_preview_github_feedback,
    handle_preview_github_issue: handle_preview_github_feedback,
    handle_create_github_issue,
    handle_generate_issue_markdown,
}
