"use strict"

/**
 * tools/github.js — Catalyst MCP v2
 *
 * Exposes three tools:
 *   preview_github_feedback   → drafts content, searches duplicates, returns preview for approval
 *   create_github_issue       → GitHub REST API  (POST /repos/{owner}/{repo}/issues)
 *   create_github_discussion  → GitHub GraphQL API (createDiscussion mutation)
 *
 * Authentication (in priority order):
 *   1. GITHUB_TOKEN environment variable (Personal Access Token)
 *   2. GitHub CLI session  — `gh auth login` (token read via `gh auth token`)
 *
 *   Required scopes:
 *     - repo              (for creating issues + searching)
 *     - write:discussion  (for creating discussions)
 *
 * Zero external dependencies — uses Node's built-in `https` and `child_process` modules only.
 */

const https = require("https")
const { execSync } = require("child_process")

// ── Module state ──────────────────────────────────────────────────────────────

let _projectInfo = null

// Parsed from catalyst-core package.json "repository.url"
const GITHUB_OWNER = "tata1mg"
const GITHUB_REPO = "catalyst-core"

function init(projectInfo) {
    _projectInfo = projectInfo
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Read a GitHub token in priority order:
 *   1. GITHUB_TOKEN env var
 *   2. Active `gh` CLI session (gh auth token)
 * Returns { ok, token, source } or { ok: false, error }.
 */
function getToken() {
    // 1. Explicit env var
    const envToken = process.env.GITHUB_TOKEN
    if (envToken && envToken.trim()) {
        return { ok: true, token: envToken.trim(), source: "env" }
    }

    // 2. GitHub CLI session — no credentials stored by Catalyst
    try {
        const ghToken = execSync("gh auth token", {
            encoding: "utf8",
            timeout: 4000,
            stdio: ["ignore", "pipe", "ignore"],
        }).trim()
        if (ghToken) return { ok: true, token: ghToken, source: "gh-cli" }
    } catch {
        // gh not installed or not logged in — fall through to error
    }

    return {
        ok: false,
        error:
            "No GitHub credentials found. Provide one of:\n\n" +
            "Option A — GitHub CLI (recommended, no config needed):\n" +
            "  gh auth login\n" +
            "  Required scopes: repo, write:discussion\n\n" +
            "Option B — Environment variable:\n" +
            "  Create a PAT at https://github.com/settings/tokens/new\n" +
            '  Claude Desktop → claude_desktop_config.json → "env": { "GITHUB_TOKEN": "ghp_xxx..." }\n' +
            "  Cursor → .cursor/mcp.json → \"env\": { \"GITHUB_TOKEN\": \"ghp_xxx...\" }",
    }
}

/**
 * Thin wrapper around Node's https for GitHub API calls.
 * Returns parsed JSON body and status code.
 */
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

/**
 * Execute a GitHub GraphQL query/mutation.
 */
function graphql(token, query, variables = {}) {
    return githubRequest("POST", "/graphql", token, { query, variables })
}

/**
 * Append a standard footer to the body with project context.
 * Makes triage easy for the catalyst-core team.
 */
function enrichBody(body) {
    const lines = [body.trim(), "", "---"]
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

/**
 * Extract short search keywords from a title + body.
 * Returns a URL-encoded query string suitable for the GitHub search API.
 */
function extractKeywords(title, body) {
    // Take top words from title (most signal), pad with body words if needed
    const stopWords = new Set([
        "a", "an", "the", "is", "in", "on", "at", "to", "for", "of", "and",
        "or", "but", "not", "with", "this", "that", "it", "be", "are", "was",
        "can", "how", "do", "does", "i", "my", "me", "we", "our",
    ])
    const tokenise = (str) =>
        str
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 2 && !stopWords.has(w))

    const titleWords = tokenise(title).slice(0, 5)
    const bodyWords = tokenise(body)
        .filter((w) => !titleWords.includes(w))
        .slice(0, 3)

    return [...titleWords, ...bodyWords].join("+")
}

/**
 * Search for existing issues or discussions that might be duplicates.
 * Returns array of { number, title, url, state? } — max 5 results.
 *
 * Issues   → GitHub REST Search API  (GET /search/issues)
 * Discussions → GitHub GraphQL search
 */
async function searchDuplicates(token, title, body, type) {
    const keywords = extractKeywords(title, body)
    if (!keywords) return []

    try {
        if (type === "discussion") {
            const query = `
                query SearchDiscussions($q: String!) {
                    search(query: $q, type: DISCUSSION, first: 5) {
                        nodes {
                            ... on Discussion {
                                number
                                title
                                url
                            }
                        }
                    }
                }
            `
            const searchQ = `repo:${GITHUB_OWNER}/${GITHUB_REPO} ${keywords.replace(/\+/g, " ")}`
            const res = await graphql(token, query, { q: searchQ })
            if (res.status === 200 && !res.body.errors) {
                return (res.body.data?.search?.nodes || []).filter(Boolean)
            }
            return []
        } else {
            // Issues via REST Search API
            const q = encodeURIComponent(
                `repo:${GITHUB_OWNER}/${GITHUB_REPO} ${keywords.replace(/\+/g, " ")} in:title,body`
            )
            const res = await githubRequest(
                "GET",
                `/search/issues?q=${q}&type=issue&per_page=5`,
                token
            )
            if (res.status === 200 && Array.isArray(res.body.items)) {
                return res.body.items.slice(0, 5).map((i) => ({
                    number: i.number,
                    title: i.title,
                    url: i.html_url,
                    state: i.state,
                }))
            }
            return []
        }
    } catch {
        // Duplicate search is best-effort — never fail the main flow
        return []
    }
}

/**
 * Fetch the GitHub repository node ID (needed for createDiscussion mutation).
 */
async function getRepositoryId(token) {
    const query = `
        query GetRepoId($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) {
                id
            }
        }
    `
    const res = await graphql(token, query, { owner: GITHUB_OWNER, name: GITHUB_REPO })
    if (res.status !== 200 || res.body.errors) {
        const err = res.body.errors ? res.body.errors[0].message : `HTTP ${res.status}`
        throw new Error(`Failed to fetch repository ID: ${err}`)
    }
    return res.body.data.repository.id
}

/**
 * Fetch all available Discussion categories for the repo.
 * Returns array of { id, name, emoji }.
 */
async function getDiscussionCategories(token) {
    const query = `
        query GetCategories($owner: String!, $name: String!) {
            repository(owner: $owner, name: $name) {
                discussionCategories(first: 25) {
                    nodes {
                        id
                        name
                        emoji
                    }
                }
            }
        }
    `
    const res = await graphql(token, query, { owner: GITHUB_OWNER, name: GITHUB_REPO })
    if (res.status !== 200 || res.body.errors) {
        const err = res.body.errors ? res.body.errors[0].message : `HTTP ${res.status}`
        throw new Error(`Failed to fetch discussion categories: ${err}`)
    }
    return res.body.data.repository.discussionCategories.nodes
}

/**
 * Pick the best matching category from available ones.
 * Falls back to smart auto-detection based on body content.
 */
function resolveCategory(categories, requestedName, body) {
    if (requestedName) {
        // Exact match first (case-insensitive)
        const exact = categories.find((c) => c.name.toLowerCase() === requestedName.toLowerCase())
        if (exact) return exact

        // Partial match
        const partial = categories.find((c) =>
            c.name.toLowerCase().includes(requestedName.toLowerCase())
        )
        if (partial) return partial
    }

    // Auto-detect: if body has a question mark → Q&A, else Ideas or General
    const isQuestion = body.includes("?")
    const isFeatureRequest = /\b(feature|proposal|suggest|idea|would\s+be\s+nice|enhancement)\b/i.test(body)

    if (isQuestion) {
        const qa = categories.find((c) => /q.?a|question/i.test(c.name))
        if (qa) return qa
    }
    if (isFeatureRequest) {
        const ideas = categories.find((c) => /idea|feature|suggest/i.test(c.name))
        if (ideas) return ideas
    }

    // Final fallback: General
    const general = categories.find((c) => /general/i.test(c.name))
    return general || categories[0]
}

// ── Tool: preview_github_feedback ────────────────────────────────────────────

/**
 * Handle preview_github_feedback tool call.
 *
 * Drafts the enriched content, searches for potential duplicates,
 * and returns everything for developer review — WITHOUT publishing anything.
 * The developer then calls create_github_issue or create_github_discussion to confirm.
 *
 * Args:
 *   title    {string}   required — proposed title
 *   body     {string}   required — proposed body
 *   type     {string}   required — "issue" | "discussion"
 *   labels   {string[]} optional — for issues
 *   category {string}  optional — for discussions
 */
async function handle_preview_github_feedback(args) {
    const { title, body, type, labels, category } = args

    if (!title || typeof title !== "string" || title.trim() === "") {
        return { ok: false, error: "title is required." }
    }
    if (!body || typeof body !== "string" || body.trim() === "") {
        return { ok: false, error: "body is required." }
    }
    if (!type || ![ "issue", "discussion" ].includes(type)) {
        return { ok: false, error: "type must be 'issue' or 'discussion'." }
    }

    // Build enriched body (always works, no token needed)
    const enrichedBody = enrichBody(body)

    // Search duplicates (best-effort — requires token but won't fail without it)
    let duplicates = []
    let tokenSource = null
    const tokenResult = getToken()
    if (tokenResult.ok) {
        tokenSource = tokenResult.source
        duplicates = await searchDuplicates(tokenResult.token, title, body, type)
    }

    // Build the preview object — exactly what will be published
    const preview = {
        type,
        title: title.trim(),
        body: enrichedBody,
        ...(type === "issue" && Array.isArray(labels) && labels.length > 0 ? { labels } : {}),
        ...(type === "discussion" && category ? { category } : {}),
    }

    const hasDuplicates = duplicates.length > 0
    const nextStep =
        type === "issue"
            ? `Call create_github_issue with title and body above to publish.`
            : `Call create_github_discussion with title and body above to publish.`

    return {
        ok: true,
        preview,
        duplicates,
        token_source: tokenSource || "none — duplicate search skipped",
        instructions: [
            hasDuplicates
                ? `⚠️  Found ${duplicates.length} similar existing ${type}(s) listed above. Show them to the developer and ask if they still want to proceed.`
                : `✅ No duplicates found.`,
            `Show the preview to the developer for approval, then ${nextStep}`,
        ].join(" "),
    }
}

// ── Tool: create_github_issue ─────────────────────────────────────────────────

/**
 * Handle create_github_issue tool call.
 *
 * Args:
 *   title   {string}   required — short descriptive issue title
 *   body    {string}   required — full description
 *   labels  {string[]} optional — label names (must already exist on the repo)
 */
async function handle_create_github_issue(args) {
    const { title, body, labels } = args

    if (!title || typeof title !== "string" || title.trim() === "") {
        return { ok: false, error: "title is required and must be a non-empty string." }
    }
    if (!body || typeof body !== "string" || body.trim() === "") {
        return { ok: false, error: "body is required and must be a non-empty string." }
    }

    const tokenResult = getToken()
    if (!tokenResult.ok) {
        return { ok: false, error: tokenResult.error }
    }

    const enrichedBody = enrichBody(body)
    const payload = {
        title: title.trim(),
        body: enrichedBody,
    }
    if (Array.isArray(labels) && labels.length > 0) {
        payload.labels = labels.filter((l) => typeof l === "string" && l.trim())
    }

    try {
        const res = await githubRequest(
            "POST",
            `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
            tokenResult.token,
            payload
        )

        if (res.status === 201) {
            return {
                ok: true,
                message: `✅ Issue #${res.body.number} created successfully!`,
                number: res.body.number,
                title: res.body.title,
                url: res.body.html_url,
                labels: (res.body.labels || []).map((l) => l.name),
                state: res.body.state,
            }
        }

        // Handle common errors with actionable messages
        if (res.status === 401) {
            return {
                ok: false,
                error:
                    "GitHub authentication failed (401). Your GITHUB_TOKEN is invalid or expired.\n" +
                    "Generate a new token at: https://github.com/settings/tokens/new (scope: repo)",
            }
        }
        if (res.status === 403) {
            return {
                ok: false,
                error:
                    "GitHub permission denied (403). Your token may not have the `repo` scope, " +
                    "or issues may be disabled on the repository.",
            }
        }
        if (res.status === 404) {
            return {
                ok: false,
                error: `Repository ${GITHUB_OWNER}/${GITHUB_REPO} not found or your token does not have access to it.`,
            }
        }
        if (res.status === 422) {
            const msg = res.body.errors ? res.body.errors.map((e) => e.message).join(", ") : res.body.message
            return {
                ok: false,
                error: `Validation error (422): ${msg}. Check that all label names exist on the repo.`,
            }
        }

        return {
            ok: false,
            error: `Unexpected GitHub API response: HTTP ${res.status} — ${JSON.stringify(res.body)}`,
        }
    } catch (err) {
        return { ok: false, error: `Network error while calling GitHub API: ${err.message}` }
    }
}

// ── Tool: create_github_discussion ───────────────────────────────────────────

/**
 * Handle create_github_discussion tool call.
 *
 * Args:
 *   title    {string} required — discussion title
 *   body     {string} required — discussion body
 *   category {string} optional — category name ("Q&A", "Ideas", "General", etc.)
 */
async function handle_create_github_discussion(args) {
    const { title, body, category } = args

    if (!title || typeof title !== "string" || title.trim() === "") {
        return { ok: false, error: "title is required and must be a non-empty string." }
    }
    if (!body || typeof body !== "string" || body.trim() === "") {
        return { ok: false, error: "body is required and must be a non-empty string." }
    }

    const tokenResult = getToken()
    if (!tokenResult.ok) {
        return { ok: false, error: tokenResult.error }
    }

    const token = tokenResult.token

    try {
        // Fetch repo ID and categories in parallel
        const [repositoryId, categories] = await Promise.all([
            getRepositoryId(token),
            getDiscussionCategories(token),
        ])

        if (!categories || categories.length === 0) {
            return {
                ok: false,
                error:
                    "No discussion categories found on the repository. " +
                    "Discussions may not be enabled on catalyst-core.",
            }
        }

        const selectedCategory = resolveCategory(categories, category, body)
        if (!selectedCategory) {
            return {
                ok: false,
                error: `Could not find a matching discussion category. Available: ${categories.map((c) => c.name).join(", ")}`,
            }
        }

        const enrichedBody = enrichBody(body)

        const mutation = `
            mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
                createDiscussion(input: {
                    repositoryId: $repositoryId,
                    categoryId: $categoryId,
                    title: $title,
                    body: $body
                }) {
                    discussion {
                        number
                        title
                        url
                        category {
                            name
                        }
                    }
                }
            }
        `

        const res = await graphql(token, mutation, {
            repositoryId,
            categoryId: selectedCategory.id,
            title: title.trim(),
            body: enrichedBody,
        })

        if (res.status === 200 && !res.body.errors) {
            const discussion = res.body.data.createDiscussion.discussion
            return {
                ok: true,
                message: `✅ Discussion #${discussion.number} created successfully!`,
                number: discussion.number,
                title: discussion.title,
                url: discussion.url,
                category: discussion.category.name,
            }
        }

        // Handle GraphQL-level errors
        if (res.body.errors && res.body.errors.length > 0) {
            const errMsg = res.body.errors[0].message
            if (/not authorized|forbidden/i.test(errMsg)) {
                return {
                    ok: false,
                    error:
                        "GitHub authorization error: Your token may be missing the `write:discussion` scope.\n" +
                        "Generate a new token at: https://github.com/settings/tokens/new",
                }
            }
            return { ok: false, error: `GitHub GraphQL error: ${errMsg}` }
        }

        if (res.status === 401) {
            return {
                ok: false,
                error:
                    "GitHub authentication failed (401). Your GITHUB_TOKEN is invalid or expired.\n" +
                    "Generate a new token at: https://github.com/settings/tokens/new",
            }
        }

        return {
            ok: false,
            error: `Unexpected GitHub API response: HTTP ${res.status} — ${JSON.stringify(res.body)}`,
        }
    } catch (err) {
        return { ok: false, error: `Network error while calling GitHub API: ${err.message}` }
    }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    init,
    handle_preview_github_feedback,
    handle_create_github_issue,
    handle_create_github_discussion,
}
