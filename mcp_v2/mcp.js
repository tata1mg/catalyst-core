#!/usr/bin/env node
/**
 * Catalyst MCP v2 — mcp.js (entry point)
 *
 * Startup validation → module init → JSON-RPC loop over stdio.
 *
 * Hard fails if:
 *   - No catalyst-core in package.json (not a catalyst project)
 *   - context.db missing (setup.js not run)
 *
 * Tool routing: LLM reads tool name + description to route.
 * No classifier code at runtime — descriptions use intent language.
 */

const fs = require("fs")
const path = require("path")
const readline = require("readline")
const Database = require("better-sqlite3")

const { findCatalystRoot } = require("./lib/helpers")
const conversion = require("./tools/conversion")
const config = require("./tools/config")
const debug = require("./tools/debug")
const build = require("./tools/build")
const tasks = require("./tools/tasks")
const sync = require("./tools/sync")
const knowledge = require("./tools/knowledge")

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
                message: "Not a catalyst-core project. No catalyst-core dependency found in package.json.",
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
                message: `catalyst-core is listed in package.json (${projectInfo.catalystVersion}) but not installed in node_modules. Run: npm install`,
            },
            id: null,
        }) + "\n"
    )
    process.exit(1)
}

if (!fs.existsSync(DB_PATH)) {
    process.stderr.write(
        JSON.stringify({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: `context.db not found at ${DB_PATH}. Run setup first: node ${path.join(MCP_DIR, "setup.js")}`,
            },
            id: null,
        }) + "\n"
    )
    process.exit(1)
}

const db = new Database(DB_PATH, { readonly: false })
const CONVERSION_TASKS = JSON.parse(fs.readFileSync(TASKS_PATH, "utf8"))

// ── Module init ───────────────────────────────────────────────────────────────

conversion.init(projectInfo, CONVERSION_TASKS)
config.init(projectInfo)
debug.init(db)
build.init(db)
tasks.init(db)
sync.init(db)
knowledge.init(db)

// ── Intent classification (internal, not exposed as tool) ─────────────────────

const INTENT_PATTERNS = {
    // execute = wants to DO something — only intent that should chain create_task_plan
    execute: /\b(convert|migrat|implement|set\s*up|add\s+support|upgrade|rewrite|refactor|integrate)\b/i,
    // guidance = wants to UNDERSTAND something — answer only, no task planning
    guidance:
        /\b(what\s+is|what\s+are|how\s+does|how\s+do|explain|show\s+me|tell\s+me|hook|api|usage|example)\b/i,
    status: /status|done|complet|finish|check.*config|config.*check|what.*(left|remain|todo|next|pending)|how far|progress/i,
    debug: /error|fail|broken|not work|crash|issue|bug|why|wrong/i,
    build: /build|compile|webpack|bundle|android|ios|platform/i,
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
            "Use when the developer asks: 'what do I need to convert?', 'what's left to do?', 'show me pending tasks', 'what do I fix next?', 'give me a fix guide'. Runs live detection on project files and returns only the tasks relevant to THIS project (features it actually uses). Not-applicable tasks (features the project doesn't use) are hidden by default.",
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
            "Use when the developer asks: 'how far along am I?', 'what have I completed?', 'show my conversion progress', 'what's done vs pending?'. Auto-detects which tasks apply to THIS project based on what web features it actually uses. Tasks for unused features are not_applicable and hidden by default.",
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
            "Use when the developer asks about building, serving, or deploying — e.g. 'how do I build for android?', 'walk me through the release build', 'how do I serve in production?', 'my android build is failing', 'how does the iOS debug build work?'. Returns step-by-step build flow adapted to the project's actual config, with warnings for missing config and related known errors.",
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
        name: "sync_catalyst_docs",
        description:
            "Use when the developer asks: 'sync docs', 'update framework knowledge', 'fetch latest catalyst docs'. Intent: sync. Fetches changelog and template diffs, updates the KB. Maintenance only — no task planning needed after.",
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
    sync_catalyst_docs: sync.handle_sync_catalyst_docs,
    query_knowledge: knowledge.handle_query_knowledge,
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
                    name: "catalyst-mcp",
                    version: "2.0.0",
                    description: `Catalyst MCP v2 — ${projectInfo.pkg.name || projectInfo.dir} (catalyst-core@${projectInfo.catalystVersion})`,
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
                                        "This query is outside Catalyst MCP scope. MCP handles: conversion tracking, debugging, config validation, build flow, architecture, task planning, and doc sync.",
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
