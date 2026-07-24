<!-- mcp-name: io.github.mayankmahavar1mg/mcp -->

# Catalyst MCP

MCP server providing developer-workflow tools for [catalyst-core](https://github.com/tata1mg/catalyst-core) projects: migration guidance, debugging, build config checks, task planning, and framework knowledge search.

## Requirements

Run this from a project that either **is** `catalyst-core` (the source repo) or **declares `catalyst-core` as a dependency** in its `package.json`. The server validates this at startup and exits with an error otherwise.

## Install & run

The server needs a local knowledge-base database (`context.db`). If it doesn't exist yet, `mcp.js` creates and seeds it automatically on first run — no separate setup step required.

**Recommended — via the `create-catalyst-app` CLI**, which fetches and installs it inside an existing project:

```bash
npx create-catalyst-app catalyst-mcp
```

**Standalone**, from inside a project that is (or depends on) `catalyst-core`:

```bash
npx catalyst-mcp
```

Client config:

```json
{
  "catalyst-mcp": {
    "command": "node",
    "args": ["node_modules/catalyst-mcp/mcp.js"]
  }
}
```

To force a re-seed (e.g. to pick up the latest knowledge base), run `node node_modules/catalyst-mcp/setup.js` manually at any time — it's idempotent.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_conversion_tasks` | List pending migration tasks, filtered by tier (routing/config/server, native, hooks). Version-aware for legacy 0.2.x vs current 0.3.x+ projects. |
| `get_conversion_status` | Report migration progress — what's done vs pending, with detected Catalyst generation. |
| `debug_issue` | Match a reported error/symptom against known issues and return cause + fix, plus related framework knowledge. |
| `check_config` | Validate `WEBVIEW_CONFIG` for Android/iOS against required fields. |
| `get_build_flow` | Explain build/serve/deploy behavior for a platform and mode, version-aware (webpack-era 0.2.x vs Vite 0.3.x+), with related known errors. |
| `get_architecture_diagram` | Return a layered architecture diagram (e.g. bridge, routing, build pipeline) with project-specific context and pitfalls. |
| `create_task_plan` | Create a persisted, step-by-step migration/implementation plan that survives context resets. |
| `update_task_step` | Update a step's status (done/blocked/skipped/in_progress) on the active plan, with auto-advance. |
| `get_active_task` | Resume the current active plan — pending steps and progress. Useful at the start of a session. |
| `close_task_plan` | Close a completed plan, optionally deleting its task file. |
| `query_knowledge` | Full-text search over Catalyst framework documentation/knowledge base. |
| `sync_knowledge_base` | Pull the latest knowledge base from `tata1mg/catalyst-core@main` and re-seed it. |
| `create_github_issue` | Draft (dry-run) or publish a GitHub issue against `catalyst-core`, with duplicate detection and template rendering. |

## License

MIT
