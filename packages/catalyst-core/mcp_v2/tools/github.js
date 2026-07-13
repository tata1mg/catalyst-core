"use strict"

/**
 * tools/github.js - Catalyst MCP v2
 *
 * GitHub issue workflow for AI agents:
 *   create_github_issue({ dry_run: true })  - first asks the developer to select labels
 *   create_github_issue({ dry_run: true, labels }) - gathers context, templates, and duplicate candidates
 *   create_github_issue({ dry_run: false }) - publishes after explicit developer approval
 *   markdown fallback is generated internally when auth/API publishing fails
 *
 * Authentication:
 *   1. Direct GitHub API token from GITHUB_TOKEN, GITHUB_PAT, or CATALYST_GITHUB_TOKEN
 *   2. Optional fallback to GitHub CLI session (`gh auth token`)
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
    dependencies:
        "Dependency/package update work, package-lock changes, npm audit fixes, or vulnerability remediation.",
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
        use_when:
            "Something is not working, is ignored, crashes, regresses, or differs from expected Catalyst behavior.",
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
        use_when:
            "A new capability, universal hook behavior, CLI improvement, or framework ergonomics improvement is needed.",
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
        use_when:
            "Docs, examples, README, guides, migration notes, or API reference need to be added or corrected.",
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
        use_when:
            "A dependency, lockfile, audit finding, package version, or security update needs attention.",
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
        use_when:
            "The report primarily asks for usage guidance, clarification, or a decision before implementation.",
        sections: ["Question", "Context", "What I Tried", "Expected Guidance"],
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
    let fd
    try {
        fd = fs.openSync(filePath, "r")
        const stats = fs.fstatSync(fd)
        const limit = Math.max(0, maxBytes)
        const buffer = Buffer.alloc(limit)
        const bytesRead = fs.readSync(fd, buffer, 0, limit, 0)
        const content = buffer.subarray(0, bytesRead).toString("utf8")
        return stats.size > bytesRead ? `${content}\n...[truncated]` : content
    } catch {
        return null
    } finally {
        if (typeof fd === "number") {
            try {
                fs.closeSync(fd)
            } catch {
                // Ignore close failures; callers treat unreadable files as absent.
            }
        }
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
    return (
        String(input || "github-issue")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "github-issue"
    )
}

function ensureFallbackDir(root) {
    const dir = path.join(root, FALLBACK_DIR)
    fs.mkdirSync(dir, { recursive: true })
    return dir
}

function getToken() {
    const envTokenNames = ["GITHUB_TOKEN", "GITHUB_PAT", "CATALYST_GITHUB_TOKEN"]
    for (const name of envTokenNames) {
        const envToken = process.env[name]
        if (envToken && envToken.trim()) {
            return { ok: true, token: envToken.trim(), source: `env:${name}` }
        }
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
        error: "No GitHub credentials found. Set GITHUB_TOKEN, GITHUB_PAT, or CATALYST_GITHUB_TOKEN in the MCP server environment. As an optional fallback, you can also run `gh auth login` with repo scope.",
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
                ...(payload
                    ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
                    : {}),
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
        req.setTimeout(30000, () => {
            req.destroy(new Error("GitHub API request timed out after 30 seconds"))
        })
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

function hasLabelsInput(args) {
    return Object.prototype.hasOwnProperty.call(args, "labels")
}

function buildLabelSelectionResponse(args = {}) {
    const textForSuggestion = [
        args.title,
        args.body,
        args.summary,
        args.current_behavior,
        args.actual_behavior,
        args.expected_behavior,
        args.error_logs,
    ]
        .filter((value) => typeof value === "string" && value.trim())
        .join("\n")
    const suggestedLabel = textForSuggestion ? inferPrimaryLabel(args.title, textForSuggestion) : null

    return {
        ok: true,
        dry_run: true,
        label_selection_required: true,
        repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
        possible_labels: DEFAULT_LABELS,
        label_guidance: LABEL_GUIDANCE,
        suggested_label: suggestedLabel,
        instructions:
            "Ask the developer to select one or more labels before gathering context, rendering the issue preview, checking duplicates, or publishing. Call create_github_issue again with labels set to the selected labels.",
        next_action: "Wait for developer label selection, then call create_github_issue with labels.",
    }
}

function stripExistingFooter(body) {
    return String(body || "")
        .replace(/\n---\n(?:\*\*(?:Project|catalyst-core version|Project path|Reported via):\*\*.*\n?)+$/, "")
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

function hasContentValue(value) {
    if (typeof value === "string") return Boolean(value.trim())
    if (Array.isArray(value)) return value.some(hasContentValue)
    if (value && typeof value === "object") return Object.keys(value).length > 0
    return false
}

function hasUserIssueContent(args = {}) {
    return [
        "body",
        "summary",
        "current_behavior",
        "actual_behavior",
        "expected_behavior",
        "error_logs",
        "environment",
        "what_i_tried",
        "additional_information",
        "related_issues",
        "root_cause",
        "proposed_fix",
        "optional_followups",
        "steps_to_reproduce",
        "repro",
        "notes",
        "context",
    ].some((key) => hasContentValue(args[key]))
}

function appendSection(sections, heading, content) {
    const text = Array.isArray(content)
        ? toMarkdownList(content)
        : content && typeof content === "object"
          ? JSON.stringify(content, null, 2)
          : firstNonEmpty(content)
    if (text) sections.push(`## ${heading}\n\n${text}`)
}

function isPathInside(root, candidate) {
    const resolvedRoot = path.resolve(root)
    const resolvedCandidate = path.resolve(candidate)
    const relative = path.relative(resolvedRoot, resolvedCandidate)
    return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative))
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
        appendSection(
            sections,
            "Current Documentation",
            firstNonEmpty(args.current_behavior, args.actual_behavior)
        )
        appendSection(
            sections,
            "Suggested Documentation",
            firstNonEmpty(args.expected_behavior, args.proposed_fix, args.suggested_fix)
        )
        appendSection(sections, "Affected Pages / Examples", args.steps_to_reproduce || args.repro)
        appendSection(sections, "Optional Follow-ups", args.optional_followups || args.follow_ups)
        return sections.join("\n\n").trim()
    }

    if (template === "dependencies") {
        appendSection(sections, "Summary", firstNonEmpty(args.summary, rawBody))
        appendSection(
            sections,
            "Current Dependency",
            firstNonEmpty(args.current_behavior, args.actual_behavior)
        )
        appendSection(sections, "Target Dependency", args.expected_behavior)
        appendSection(sections, "Reason / Impact", firstNonEmpty(args.root_cause, args.notes))
        appendSection(sections, "Validation Plan", args.steps_to_reproduce || args.repro)
        return sections.join("\n\n").trim()
    }

    if (template === "question") {
        appendSection(sections, "Question", firstNonEmpty(args.summary, rawBody))
        appendSection(
            sections,
            "Context",
            firstNonEmpty(args.current_behavior, args.actual_behavior, args.root_cause, args.notes)
        )
        appendSection(sections, "What I Tried", args.steps_to_reproduce || args.repro)
        appendSection(sections, "Expected Guidance", args.expected_behavior)
        return sections.join("\n\n").trim()
    }

    if (template === "enhancement") {
        appendSection(sections, "Summary", firstNonEmpty(args.summary, rawBody))
        appendSection(
            sections,
            "Motivation",
            firstNonEmpty(args.current_behavior, args.actual_behavior, args.root_cause, args.notes)
        )
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
    appendSection(
        sections,
        "Error Messages/Logs",
        args.error_logs ? `\`\`\`\n${args.error_logs}\n\`\`\`` : ""
    )
    appendSection(sections, "Environment", args.environment)
    appendSection(sections, "What I Tried", args.what_i_tried || args.what_tried)
    appendSection(
        sections,
        "Additional Information",
        firstNonEmpty(
            args.additional_information,
            args.root_cause,
            args.notes,
            args.proposed_fix,
            args.suggested_fix
        )
    )
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

        const absolutePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw)
        if (!isPathInside(root, absolutePath)) {
            localFiles.push({ path: raw, exists: false, rejected: true, reason: "outside_project_root" })
            lines.push(`- ${raw} (outside project root; not included)`)
            continue
        }
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
        const context =
            typeof args.context === "string" ? args.context : JSON.stringify(args.context, null, 2)
        sections.push(`## Catalyst/Project Context\n\n\`\`\`json\n${context}\n\`\`\``)
    }

    if (args.environment && resolveIssueTemplate(args, styledBody) !== "bug") {
        const environment =
            typeof args.environment === "string"
                ? args.environment
                : JSON.stringify(args.environment, null, 2)
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
    }
    lines.push("**Reported via:** Catalyst MCP v2")
    return lines.join("\n")
}

function normalizeSearchText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s/_:-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function buildDuplicateSearchText(title, body, duplicateSearchQuery) {
    const explicitQuery = normalizeSearchText(duplicateSearchQuery)
    if (explicitQuery) return explicitQuery

    const titleQuery = normalizeSearchText(title)
    if (titleQuery) return titleQuery

    return normalizeSearchText(body).split(/\s+/).slice(0, 8).join(" ")
}

const SENSITIVE_FILE_PATTERN =
    /(^|\/)(\.env|\.npmrc|\.pypirc|config\/config\.json|google-services\.json|googleservice-info\.plist|.*keystore.*|.*\.jks|.*\.p12|.*\.pem|.*\.key)$/i

const SENSITIVE_TEXT_PATTERN =
    /\b(api[_-]?key|auth[_-]?token|authorization|client[_-]?secret|cookie|firebase|google[_-]?services|password|private[_-]?key|secret|session[_-]?id|sentry[_-]?dsn|token)\b/i

const SENSITIVE_BODY_PATTERN =
    /\b(api[_-]?key|auth[_-]?token|authorization|client[_-]?secret|cookie|password|private[_-]?key|secret|session[_-]?id|sentry[_-]?dsn|token)\b\s*[:=]\s*\S+|\bbearer\s+[a-z0-9._-]+/i

function addSensitiveFinding(findings, seen, finding) {
    const key = `${finding.type}:${finding.path || ""}:${finding.reason}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push(finding)
}

function detectSensitiveIssueData({ body, context }) {
    const findings = []
    const seen = new Set()

    if (context && context.config) {
        addSensitiveFinding(findings, seen, {
            type: "config",
            path: "config/config.json",
            reason: "Issue context includes Catalyst config fields.",
        })
    }

    const relatedFiles = context && Array.isArray(context.related_files) ? context.related_files : []
    for (const file of relatedFiles) {
        if (!file || typeof file.path !== "string") continue

        if (SENSITIVE_FILE_PATTERN.test(file.path)) {
            addSensitiveFinding(findings, seen, {
                type: "file",
                path: file.path,
                reason: "Related file path is a config or credential-looking file.",
            })
        }

        if (typeof file.content === "string" && SENSITIVE_TEXT_PATTERN.test(file.content)) {
            addSensitiveFinding(findings, seen, {
                type: "content",
                path: file.path,
                reason: "Related file content contains secret-looking keys or values.",
            })
        }
    }

    if (typeof body === "string" && SENSITIVE_BODY_PATTERN.test(body)) {
        addSensitiveFinding(findings, seen, {
            type: "body",
            path: null,
            reason: "Rendered issue body contains sensitive-looking words or values.",
        })
    }

    return {
        required_before_publish: findings.length > 0,
        status: findings.length > 0 ? "needs_user_review" : "no_sensitive_or_config_data_detected",
        findings,
        publish_override_field:
            findings.length > 0
                ? "Pass sensitive_data_confirmed:true with dry_run:false only after the developer reviews the preview and confirms the config/sensitive-looking data may be posted."
                : null,
    }
}

async function searchDuplicates(token, title, body, duplicateSearchQuery) {
    const searchText = buildDuplicateSearchText(title, body, duplicateSearchQuery)
    if (!searchText) return []

    try {
        const q = encodeURIComponent(
            `repo:${GITHUB_OWNER}/${GITHUB_REPO} ${searchText} in:title,body is:issue`
        )
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

function collectRelatedFiles(root, query, explicitFiles) {
    const files = []
    const candidates = Array.isArray(explicitFiles) ? explicitFiles : []
    for (const file of candidates) {
        if (typeof file !== "string") continue
        const absolute = path.isAbsolute(file) ? path.resolve(file) : path.resolve(root, file)
        if (!isPathInside(root, absolute)) continue
        const content = safeReadText(absolute, 12000)
        if (content) {
            files.push({ path: path.relative(root, absolute), content })
        }
    }

    if (files.length > 0 || !query) return files

    const words = normalizeSearchText(query).split(/\s+/).filter(Boolean).slice(0, 5)
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

function gatherGithubIssueContext(args = {}) {
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
    }
}

function generateIssueMarkdown(args = {}) {
    const { title } = args
    if (!title || typeof title !== "string" || title.trim() === "") {
        return { ok: false, error: "title is required." }
    }

    const root = getProjectRoot(args)
    if (!hasUserIssueContent(args)) {
        return { ok: false, error: "body or structured issue fields are required." }
    }

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
    const labels = normalizeLabels(args.labels)
    if (!hasLabelsInput(args) || labels.length === 0) {
        if (hasLabelsInput(args)) {
            return {
                ok: false,
                error: "labels must include at least one valid Catalyst GitHub label.",
                possible_labels: DEFAULT_LABELS,
                label_guidance: LABEL_GUIDANCE,
            }
        }
        return buildLabelSelectionResponse(args)
    }

    const { title } = args
    if (!title || typeof title !== "string" || title.trim() === "") {
        return { ok: false, error: "title is required and must be a non-empty string." }
    }

    if (!hasUserIssueContent(args)) {
        return { ok: false, error: "body or structured issue fields are required." }
    }

    const dryRun = args.dry_run !== false
    const gatheredContext = gatherGithubIssueContext({
        ...args,
        query: args.query || args.duplicate_search_query || args.summary || args.body || args.title,
    })
    const issueArgs = {
        ...args,
        context: args.context,
    }
    const built = buildIssueBody(issueArgs)
    if (!built.body || built.body.trim() === "") {
        return { ok: false, error: "body or structured issue fields are required." }
    }

    let duplicates = []
    let tokenSource = "none"
    const tokenResult = getToken()
    if (tokenResult.ok) {
        tokenSource = tokenResult.source
        duplicates = await searchDuplicates(
            tokenResult.token,
            title,
            built.body,
            issueArgs.duplicate_search_query
        )
    }

    const preview = {
        type: "issue",
        repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
        title: title.trim(),
        body: built.body,
        labels,
        suggested_template: ISSUE_TEMPLATES[resolveIssueTemplate(issueArgs, built.body)],
        possible_labels: DEFAULT_LABELS,
        label_guidance: LABEL_GUIDANCE,
        images: built.images,
        context: gatheredContext,
    }

    const duplicateReview = {
        required_before_publish: duplicates.length > 0,
        status: duplicates.length > 0 ? "needs_user_review" : "no_duplicate_candidates_found",
        candidates: duplicates,
        publish_override_field:
            duplicates.length > 0
                ? "Pass duplicate_review_confirmed:true with dry_run:false only after the developer confirms this is not a duplicate."
                : null,
    }
    const sensitiveDataReview = detectSensitiveIssueData({
        body: built.body,
        context: issueArgs.context,
    })

    if (dryRun) {
        return {
            ok: true,
            dry_run: true,
            preview,
            duplicates,
            duplicate_review: duplicateReview,
            sensitive_data_review: sensitiveDataReview,
            token_source: tokenSource,
            auth_warning: tokenResult.ok ? null : tokenResult.error,
            instructions:
                duplicates.length > 0 || sensitiveDataReview.required_before_publish
                    ? "Show the rendered issue preview, suggested template, labels, attachments, context, duplicate candidates if any, and sensitive/config data warning if present. Ask whether to edit, cancel, use an existing issue, or publish. Publish only after explicit approval with dry_run:false. Include duplicate_review_confirmed:true if duplicates were reviewed, and sensitive_data_confirmed:true if config or sensitive-looking data was detected and the developer confirms it may be posted."
                    : "Show the rendered issue preview, suggested template, labels, attachments, and context to the developer. Ask whether to edit, cancel, or publish. Publish only after explicit approval with dry_run:false.",
            next_action:
                "Wait for explicit developer approval before calling create_github_issue with dry_run:false.",
        }
    }

    const payload = {
        title: title.trim(),
        body: built.body,
        labels,
    }

    if (sensitiveDataReview.required_before_publish && args.sensitive_data_confirmed !== true) {
        return {
            ok: false,
            blocked: true,
            error: "The rendered GitHub issue includes config or sensitive-looking data. Show the preview and warning to the developer, and publish only if they explicitly confirm this data may be posted.",
            sensitive_data_review: sensitiveDataReview,
            next_action:
                "If the developer confirms the config/sensitive-looking data may be posted, call create_github_issue again with sensitive_data_confirmed:true and dry_run:false.",
        }
    }

    if (!tokenResult.ok) {
        const fallback = generateIssueMarkdown(issueArgs)
        return {
            ok: false,
            error: tokenResult.error,
            fallback: fallback.ok ? fallback : null,
        }
    }

    try {
        if (duplicates.length > 0 && args.duplicate_review_confirmed !== true) {
            return {
                ok: false,
                blocked: true,
                error: "Possible duplicate GitHub issues were found. Show these candidates to the developer and publish only if they confirm this report is distinct.",
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
                local_images_requiring_manual_upload: built.images.local_files.filter(
                    (image) => image.exists
                ),
            }
        }

        const apiMessage = res.body && res.body.message ? res.body.message : JSON.stringify(res.body)
        const fallback = generateIssueMarkdown(issueArgs)
        return {
            ok: false,
            error: `GitHub API returned HTTP ${res.status}: ${apiMessage}`,
            fallback: fallback.ok ? fallback : null,
        }
    } catch (err) {
        const fallback = generateIssueMarkdown(issueArgs)
        return {
            ok: false,
            error: `Network error while calling GitHub API: ${err.message}`,
            fallback: fallback.ok ? fallback : null,
        }
    }
}

module.exports = {
    init,
    handle_create_github_issue,
}
