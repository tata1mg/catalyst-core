#!/usr/bin/env node
/**
 * Catalyst MCP v2 — mcp.js (entry point)
 *
 * Startup validation → auto-setup (if needed) → module init → JSON-RPC loop over stdio.
 *
 * Hard fails if:
 *   - No Catalyst package in package.json (not a catalyst project)
 *
 * If context.db is missing, it is created and seeded automatically on first
 * run (same logic as setup.js) so single-command install flows (Smithery,
 * `npx catalyst-mcp`) work without a separate setup step.
 *
 * Tool routing: LLM reads tool name + description to route.
 * No classifier code at runtime — descriptions use intent language.
 */

const fs = require("fs")
const path = require("path")
const readline = require("readline")
const Database = require("better-sqlite3")

const MCP_PACKAGE = require("./package.json")
const { findCatalystRoot } = require("./lib/helpers")
const { seedKnowledgeBase } = require("./lib/seed")
const conversion = require("./tools/conversion")
const config = require("./tools/config")
const debug = require("./tools/debug")
const build = require("./tools/build")
const tasks = require("./tools/tasks")
const sync = require("./tools/sync")
const knowledge = require("./tools/knowledge")
const github = require("./tools/github")

const MCP_DIR = __dirname
const DB_PATH = path.join(MCP_DIR, "context.db")
const TASKS_PATH = path.join(MCP_DIR, "conversion-tasks.json")

// ── Startup validation ────────────────────────────────────────────────────────

const projectInfo = findCatalystRoot()
if (!projectInfo) {
    process.stderr.write(
        JSON.stringify({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message:
                    "Not a Catalyst project. No catalyst-core or catalyst-core-internal dependency found in package.json.",
            },
            id: null,
        }) + "\n"
    )
    process.exit(1)
}
if (projectInfo.notInstalled) {
    process.stderr.write(
        JSON.stringify({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: `${projectInfo.catalystPackageName} is listed in package.json (${projectInfo.catalystVersion}) but not installed in node_modules. Run: npm install`,
            },
            id: null,
        }) + "\n"
    )
    process.exit(1)
}

const dbIsNew = !fs.existsSync(DB_PATH)
const db = new Database(DB_PATH, { readonly: false })

if (dbIsNew) {
    try {
        const schema = fs.readFileSync(path.join(MCP_DIR, "schema.sql"), "utf8")
        db.exec(schema)
        seedKnowledgeBase(db, path.join(MCP_DIR, "knowledge-base.json"), projectInfo)
        db.exec(`DROP TABLE IF EXISTS fk_fts`)
    } catch (e) {
        process.stderr.write(
            JSON.stringify({
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: `First-run setup failed: ${e.message}. Try running setup manually: node ${path.join(MCP_DIR, "setup.js")}`,
                },
                id: null,
            }) + "\n"
        )
        process.exit(1)
    }
}

const CONVERSION_TASKS = JSON.parse(fs.readFileSync(TASKS_PATH, "utf8"))

// ── Module init ───────────────────────────────────────────────────────────────

conversion.init(projectInfo, CONVERSION_TASKS)
config.init(projectInfo)
debug.init(db)
build.init(db)
tasks.init(db)
sync.init(db)
knowledge.init(db)
github.init(projectInfo)

// ── Intent classification (internal, not exposed as tool) ─────────────────────

const INTENT_PATTERNS = {
    // execute = wants to DO something — only intent that should chain create_task_plan
    execute: /\b(convert|migrat|implement|set\s*up|add\s+support|upgrade|rewrite|refactor|integrate)\b/i,
    // guidance = wants to UNDERSTAND something — answer only, no task planning
    guidance:
        /\b(what\s+is|what\s+are|how\s+does|how\s+do|explain|show\s+me|tell\s+me|hook|api|usage|example)\b/i,
    status: /status|done|complet|finish|check.*config|config.*check|what.*(left|remain|todo|next|pending)|how far|progress/i,
    // feedback = wants to raise an issue or discussion on GitHub
    feedback:
        /\b(issue|bug\s+report|report\s+(a\s+)?bug|open\s+(an?\s+)?issue|create\s+(an?\s+)?issue|raise\s+(an?\s+)?issue|discussion|discuss|feature\s+request|proposal|suggest)\b/i,
    debug: /error|fail|broken|not work|crash|issue|bug|why|wrong/i,
    build: /build|compile|webpack|vite|bundle|android|ios|platform/i,
    sync: /sync|update.*doc|fetch.*doc|latest.*doc/i,
}

// next_action tells the LLM exactly what to do after getting this response
const INTENT_NEXT_ACTION = {
    execute: "create_task_plan — user wants to implement something. Plan and execute.",
    guidance: "answer_only — user asked a question. Return the answer. Do NOT call create_task_plan.",
    status: "answer_only — show status or config check result. Do NOT call create_task_plan.",
    debug: "answer_only — provide debug guidance. Do NOT call create_task_plan.",
    build: "answer_only — explain build flow. Do NOT call create_task_plan.",
    sync: "answer_only — sync complete. Do NOT call create_task_plan.",
    feedback:
        "answer_only — run the GitHub issue workflow and show the created issue URL or markdown fallback. Do NOT call create_task_plan.",
    unknown: "answer_only — unclear intent. Return what you found. Do NOT call create_task_plan.",
}

function classifyIntent(query) {
    const intents = []
    for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
        if (pattern.test(query)) intents.push(intent)
    }
    const primary = intents[0] || "unknown"
    return {
        intents,
        primary,
        out_of_scope:
            intents.length === 0 && !/catalyst|config|router|bridge|native|build|convert/i.test(query),
        next_action: INTENT_NEXT_ACTION[primary],
    }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: "get_conversion_tasks",
        description:
            "Use when the developer asks: 'what do I need to convert?', 'what's left to do?', 'show me pending tasks', 'what do I fix next?', or asks to migrate between Catalyst versions. Detects the installed catalyst-core generation and keeps legacy 0.2.x webpack/router guidance separate from current 0.3.x Vite/integrated-router guidance.",
        inputSchema: {
            type: "object",
            properties: {
                project_path: {
                    type: "string",
                    description: "Path to the catalyst project root. Defaults to cwd.",
                },
                filter: {
                    type: "string",
                    enum: ["all", "critical", "native", "enhancements"],
                    description:
                        "Filter by tier: 'critical' = Tier 1 (routing/config/server), 'native' = Tier 2 (WEBVIEW_CONFIG/icons), 'enhancements' = Tier 3 (hooks). Defaults to all.",
                },
                include_not_applicable: {
                    type: "boolean",
                    description:
                        "Include tasks where the feature is not used in this project. Default false.",
                },
            },
        },
    },
    {
        name: "get_conversion_status",
        description:
            "Use when the developer asks: 'how far along am I?', 'what have I completed?', 'show my conversion progress', or 'what's done vs pending?'. Reports the detected Catalyst generation so 0.2.x and 0.3.x requirements are never mixed.",
        inputSchema: {
            type: "object",
            properties: {
                project_path: {
                    type: "string",
                    description: "Path to the catalyst project root. Defaults to cwd.",
                },
                include_not_applicable: {
                    type: "boolean",
                    description:
                        "Include tasks where the feature is not used in this project. Default false.",
                },
            },
        },
    },
    {
        name: "debug_issue",
        description:
            "Use when the developer reports an error, something is broken, or asks 'why is X not working?'. Matches the symptom against known_errors in the DB and returns cause + fix. Also queries relevant framework_knowledge rows by layer.",
        inputSchema: {
            type: "object",
            properties: {
                symptom: {
                    type: "string",
                    description: "The error message, behavior, or problem description.",
                },
                layer: {
                    type: "string",
                    enum: ["Config", "Build", "Bridge", "Runtime", "Component"],
                    description: "Optional layer hint to narrow search.",
                },
            },
            required: ["symptom"],
        },
    },
    {
        name: "check_config",
        description:
            "Use when the developer asks: 'is my config correct?', 'check my WEBVIEW_CONFIG', 'validate my setup', 'what's wrong with my config?'. Reads WEBVIEW_CONFIG from the project and validates required fields for both platforms.",
        inputSchema: {
            type: "object",
            properties: {
                project_path: {
                    type: "string",
                    description: "Path to the catalyst project root. Defaults to cwd.",
                },
                platform: {
                    type: "string",
                    enum: ["android", "ios", "both"],
                    description: "Which platform config to check. Defaults to both.",
                },
            },
        },
    },
    {
        name: "get_build_flow",
        description:
            "Use when the developer asks about building, serving, or deploying. Returns version-aware flows: webpack-era behavior for Catalyst 0.2.x and Vite client/server behavior for Catalyst 0.3.x+, plus project config warnings and related known errors.",
        inputSchema: {
            type: "object",
            properties: {
                platform: {
                    type: "string",
                    enum: ["android", "ios", "web"],
                    description: "Target platform.",
                },
                mode: {
                    type: "string",
                    enum: ["dev", "build", "production", "staging", "release"],
                    description: "Build/serve mode. Defaults to dev for web, debug for native.",
                },
                symptom: {
                    type: "string",
                    description:
                        'Optional: describe the error or problem (e.g. "gradle build fails", "app not installing"). Surfaces related known errors alongside the flow.',
                },
            },
            required: ["platform"],
        },
    },
    {
        name: "get_architecture_diagram",
        description:
            "Use when the developer asks how something works architecturally — e.g. 'how does the universal app work?', 'explain the bridge', 'show me request lifecycle', 'how does routing work?', 'what part of the config controls X?', 'show me the build pipeline'. Returns a layered a→b→c flow diagram with project-specific context and known pitfalls.",
        inputSchema: {
            type: "object",
            properties: {
                feature: {
                    type: "string",
                    description:
                        'What to diagram. Examples: "universal app", "request lifecycle", "bridge architecture", "build pipeline", "routing". Free text — will be matched to the best diagram.',
                },
                symptom: {
                    type: "string",
                    description:
                        'Optional: describe a problem (e.g. "bridge not responding"). Surfaces related known errors alongside the diagram.',
                },
            },
            required: ["feature"],
        },
    },
    {
        name: "create_task_plan",
        description:
            "Use when the developer wants to DO something — 'help me convert this app', 'plan out the migration', 'I want to add camera support', 'guide me through implementing X'. Intent: execute. Creates a step-by-step plan persisted in DB — survives context resets.",
        inputSchema: {
            type: "object",
            properties: {
                goal: {
                    type: "string",
                    description:
                        'One sentence describing what the developer wants to accomplish. e.g. "Convert 1mg_web to universal app" or "Add camera support to checkout flow".',
                },
                steps: {
                    type: "array",
                    description:
                        "Optional: provide custom steps as strings or {title, detail} objects. If omitted, steps are auto-generated from the goal.",
                    items: { type: ["string", "object"] },
                },
            },
            required: ["goal"],
        },
    },
    {
        name: "update_task_step",
        description:
            "Use when the developer says: 'mark step X done', 'I finished step 2', 'this step is blocked', 'move to next step', 'add a note to step 1'. Updates the active plan in DB and auto-advances to the next step.",
        inputSchema: {
            type: "object",
            properties: {
                step_index: { type: "number", description: "Zero-based index of the step to update." },
                status: {
                    type: "string",
                    enum: ["done", "blocked", "skipped", "in_progress", "pending"],
                    description: 'New status for the step. Defaults to "done".',
                },
                note: {
                    type: "string",
                    description:
                        "Optional note or finding to attach to this step (e.g. what was discovered, why it is blocked).",
                },
                plan_slug: {
                    type: "string",
                    description:
                        "Optional: target a specific plan by slug. Defaults to the current active plan.",
                },
            },
            required: ["step_index"],
        },
    },
    {
        name: "get_active_task",
        description:
            "Use when the developer asks: 'what was I doing?', 'where did I leave off?', 'resume my task', 'what is the current step?', 'show me my plan'. Returns current active plan with pending steps and progress. Call this at the start of any session to restore context.",
        inputSchema: {
            type: "object",
            properties: {
                include_all_steps: {
                    type: "boolean",
                    description:
                        "If true, include completed and skipped steps too. Default: false (only pending/in_progress/blocked).",
                },
            },
        },
    },
    {
        name: "close_task_plan",
        description:
            "Use when the developer says: 'close the task', 'I am done', 'mark plan complete', 'finish the task', 'clean up the task file'. All steps must be terminal (done/skipped/blocked) before closing. Asks the developer whether to delete the task MD file. If delete_file:true, deletes .mcp_tasks/<slug>.md and removes the DB record. If delete_file:false (default), keeps the file for review and marks it done.",
        inputSchema: {
            type: "object",
            properties: {
                delete_file: {
                    type: "boolean",
                    description:
                        "If true, delete the .mcp_tasks/<slug>.md file after closing. If false (default), keep it for reference.",
                },
                plan_slug: {
                    type: "string",
                    description:
                        "Optional: target a specific plan by slug. Defaults to the current active or last completed plan.",
                },
            },
        },
    },
    {
        name: "query_knowledge",
        description:
            "Use when the developer asks ANY question about Catalyst — how-to, conceptual, debugging, or setup. Examples: 'how do I add meta tags?', 'how does routing work?', 'what hooks are available?', 'how do I set the page title?', 'explain the bridge', 'list all native hooks', 'how does getDeviceInfo work', 'how do I add SEO?', 'how do I use setMetaData?'. Intent: guidance. CRITICAL: Before calling, expand the user's plain-English terms into Catalyst-specific technical keywords. Examples: 'meta tags' → ['setMetaData', 'metaTags', 'Head', 'seo']; 'page title' → ['setMetaData', 'title', 'meta']; 'SEO' → ['setMetaData', 'MetaTag', 'seo', 'head']; 'fonts' → ['document', 'Head', 'custom-document']. Always include both the user's words AND the likely Catalyst API names. Do NOT pass a section unless you are certain — omit section when unsure to search all sections. Do NOT search node_modules or the filesystem — use this tool instead.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "The original user question verbatim. Used for display and intent classification.",
                },
                keywords: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        'Catalyst-specific technical terms expanded from the user query. Always expand plain-English to API names: "meta tags" → ["setMetaData","metaTags","Head","seo"]; "page title" → ["setMetaData","title"]; "SEO" → ["setMetaData","MetaTag","seo"]; "native hooks" → ["useCamera","useFilePicker","hooks"]; "data fetching" → ["serverFetcher","serverDataFetcher"]; "routing" → ["getRoutes","matchPath","RouterDataProvider"]. Include both user terms and expanded API names for best FTS match.',
                },
                section: {
                    type: "string",
                    enum: [
                        "framework_identity",
                        "data_fetching",
                        "routing",
                        "native_hooks",
                        "bridge_architecture",
                        "build_system",
                        "caching",
                        "config_structure",
                        "known_errors",
                        "security",
                        "server_structure",
                        "seo_metadata",
                        "transport_architecture",
                        "webview_config",
                    ],
                    description:
                        "Optional: only pass when you are certain of the section. Omit if unsure — wrong section returns zero results.",
                },
                github_files: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        'Optional: catalyst-core source file paths to fetch from GitHub if KB has no match. E.g. ["src/native/bridge/WebBridge.js", "src/native/bridge/hooks.js"]. Use when you know where in the source the answer lives.',
                },
                _query: {
                    type: "string",
                    description: "Pass the original user query here verbatim for intent classification.",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "sync_knowledge_base",
        description:
            "Use when the developer asks: 'sync docs', 'update framework knowledge', 'fetch latest catalyst docs'. Intent: sync. Pulls the latest knowledge-base.json from tata1mg/catalyst-core@main and re-seeds the KB. Maintenance only — no task planning needed after.",
        inputSchema: {
            type: "object",
            properties: {
                force: {
                    type: "boolean",
                    description: "Force re-fetch all pages even if unchanged. Defaults to false.",
                },
            },
        },
    },
    {
        name: "create_github_issue",
        description:
            "Use when the developer wants to create, raise, report, preview, or publish a GitHub issue for catalyst-core, or after the LLM discovers that a problem is likely caused by catalyst-core framework behavior and the developer agrees to raise an issue. This single tool first asks the developer to select labels when labels are omitted. After labels are supplied, it gathers project context, renders the issue using the selected/suggested template, searches duplicates using duplicate_search_query when provided, supports preview with dry_run:true, publishes only when dry_run:false is explicitly passed, and falls back to a markdown draft on auth/network/API failure. Default to dry_run:true first; if label_selection_required is returned, ask the developer to select labels before collecting/rendering the rest of the issue. Intent: feedback.",
        inputSchema: {
            type: "object",
            properties: {
                dry_run: {
                    type: "boolean",
                    description:
                        "Defaults to true. When true, returns rendered preview, labels, duplicate candidates, and gathered context without publishing. Pass false only after explicit developer approval.",
                },
                project_path: {
                    type: "string",
                    description: "Path to the catalyst app root. Defaults to detected project root.",
                },
                title: {
                    type: "string",
                    description:
                        "Short, descriptive issue title. E.g. 'RouterDataProvider fails on nested dynamic routes'.",
                },
                body: {
                    type: "string",
                    description:
                        "Full issue description. Plain text is upgraded into the catalyst-core issue style; already structured markdown is preserved.",
                },
                summary: {
                    type: "string",
                    description: "Structured issue summary if body is not already composed.",
                },
                issue_template: {
                    type: "string",
                    enum: ["bug", "enhancement", "documentation", "dependencies", "question"],
                    description:
                        "Optional template to force. Use bug for broken behavior, enhancement for feature requests, documentation for docs/examples, dependencies for package updates, question for clarification.",
                },
                current_behavior: {
                    type: "string",
                    description: "What happens today.",
                },
                steps_to_reproduce: {
                    type: "array",
                    items: { type: "string" },
                    description: "Steps to reproduce the issue.",
                },
                expected_behavior: {
                    type: "string",
                    description: "What should happen.",
                },
                actual_behavior: {
                    type: "string",
                    description: "What actually happens.",
                },
                error_logs: {
                    type: "string",
                    description: "Error logs or stack traces.",
                },
                preflight_checklist: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "Optional checklist items for bug reports. Defaults to searched issues, single issue, and included repro/environment/logs.",
                },
                what_i_tried: {
                    type: "string",
                    description: "Troubleshooting already attempted.",
                },
                additional_information: {
                    type: "string",
                    description: "Additional context that does not fit the primary sections.",
                },
                related_issues: {
                    type: "array",
                    items: { type: "string" },
                    description: "Related GitHub issues or links.",
                },
                root_cause: {
                    type: "string",
                    description: "Technical notes or suspected root cause.",
                },
                proposed_fix: {
                    type: "string",
                    description: "Concrete suggested fix.",
                },
                optional_followups: {
                    type: "array",
                    items: { type: "string" },
                    description: "Follow-up cleanup, docs, or test suggestions.",
                },
                environment: {
                    type: "object",
                    description:
                        "Environment details such as platform, OS, browser, device, Node/npm versions.",
                },
                labels: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "Required after the initial label-selection step. Valid catalyst-core labels: bug, dependencies, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix. If omitted, the tool returns label_selection_required and does not gather context, render a full preview, search duplicates, or publish.",
                },
                images: {
                    type: "array",
                    items: { type: "object" },
                    description:
                        "Optional image URLs or local image paths. URLs are embedded directly; local paths are preserved for fallback/manual upload.",
                },
                duplicate_search_query: {
                    type: "string",
                    description:
                        "Optional focused search query for duplicate detection, supplied by the LLM from the issue context. Use the same query reviewed in the dry_run:true preview.",
                },
                duplicate_review_confirmed: {
                    type: "boolean",
                    description:
                        "Set true only after a dry_run:true preview or blocked publish returned duplicate candidates, those candidates were shown to the developer, and the developer explicitly confirmed this issue is distinct and should still be published.",
                },
                sensitive_data_confirmed: {
                    type: "boolean",
                    description:
                        "Set true only after a dry_run:true preview or blocked publish returned sensitive_data_review.required_before_publish=true, the config/sensitive-looking data warning and rendered issue preview were shown to the developer, and the developer explicitly confirmed this data may be posted to GitHub.",
                },
                duplicate_review_note: {
                    type: "string",
                    description:
                        "Optional short note explaining why the issue is not a duplicate, after the developer confirms publishing.",
                },
                files: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional explicit project files to include as context snippets.",
                },
                _query: {
                    type: "string",
                    description: "Original user query for intent classification.",
                },
            },
        },
    },
]

// ── Tool handler dispatch ─────────────────────────────────────────────────────

const TOOL_HANDLERS = {
    get_conversion_tasks: conversion.handle_get_conversion_tasks,
    get_conversion_status: conversion.handle_get_conversion_status,
    debug_issue: debug.handle_debug_issue,
    check_config: config.handle_check_config,
    get_build_flow: build.handle_get_build_flow,
    get_architecture_diagram: build.handle_get_architecture_diagram,
    create_task_plan: tasks.handle_create_task_plan,
    update_task_step: tasks.handle_update_task_step,
    get_active_task: tasks.handle_get_active_task,
    close_task_plan: tasks.handle_close_task_plan,
    sync_knowledge_base: sync.handle_sync_knowledge_base,
    query_knowledge: knowledge.handle_query_knowledge,
    create_github_issue: github.handle_create_github_issue,
}

// ── MCP JSON-RPC over stdio ───────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin })

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n")
}

function wrapWithIntent(result, detectedIntent) {
    if (detectedIntent) {
        result._intent = { primary: detectedIntent.primary, next_action: detectedIntent.next_action }
    }
    return result
}

rl.on("line", (line) => {
    let msg
    try {
        msg = JSON.parse(line)
    } catch {
        return
    }

    const { id, method, params } = msg

    if (method === "initialize") {
        send({
            jsonrpc: "2.0",
            id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: {
                    name: MCP_PACKAGE.name,
                    version: MCP_PACKAGE.version,
                    description: `Catalyst MCP — ${projectInfo.pkg.name || projectInfo.dir} (catalyst-core@${projectInfo.catalystVersion})`,
                },
            },
        })
        return
    }

    if (method === "tools/list") {
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS } })
        return
    }

    if (method === "tools/call") {
        const { name, arguments: args } = params

        // Internal intent classification — runs on every query, never exposed as a tool
        let detectedIntent = null
        if (args && args._query) {
            detectedIntent = classifyIntent(args._query)
            if (detectedIntent.out_of_scope) {
                send({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    error: "out_of_scope",
                                    message:
                                        "This query is outside Catalyst MCP scope. MCP handles: conversion tracking, debugging, config validation, build flow, architecture, task planning, doc sync, and GitHub issue creation.",
                                }),
                            },
                        ],
                    },
                })
                return
            }
        }

        const handler = TOOL_HANDLERS[name]
        if (!handler) {
            send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } })
            return
        }

        try {
            const maybePromise = handler(args || {})
            if (maybePromise && typeof maybePromise.then === "function") {
                maybePromise
                    .then((result) =>
                        send({
                            jsonrpc: "2.0",
                            id,
                            result: {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(wrapWithIntent(result, detectedIntent), null, 2),
                                    },
                                ],
                            },
                        })
                    )
                    .catch((e) => send({ jsonrpc: "2.0", id, error: { code: -32000, message: e.message } }))
            } else {
                send({
                    jsonrpc: "2.0",
                    id,
                    result: {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(wrapWithIntent(maybePromise, detectedIntent), null, 2),
                            },
                        ],
                    },
                })
            }
        } catch (e) {
            send({ jsonrpc: "2.0", id, error: { code: -32000, message: e.message } })
        }
        return
    }

    // notifications (initialized, etc.) — no response needed
    if (!id) return

    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } })
})

process.on("SIGINT", () => {
    db.close()
    process.exit(0)
})
