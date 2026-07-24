<!-- mcp-name: io.github.mayankmahavar1mg/mcp -->

# Catalyst MCP

MCP server providing developer-workflow tools for [catalyst-core](https://github.com/tata1mg/catalyst-core) projects: migration guidance, debugging, build config checks, task planning, and framework knowledge search.

## Requirements

Run this from a project that either **is** `catalyst-core` (the source repo) or **declares `catalyst-core` as a dependency** in its `package.json`. The server validates this at startup and exits with an error otherwise.

## Install & run

The server needs a one-time setup step to create and seed its local knowledge-base database (`context.db`) before it can answer any tool calls.

**Recommended — via the `create-catalyst-app` CLI**, which fetches, installs, and runs setup automatically inside an existing project:

```bash
npx create-catalyst-app catalyst-mcp
```

**Standalone**, from inside a project that is (or depends on) `catalyst-core`:

```bash
npx catalyst-mcp        # installs the package
node node_modules/catalyst-mcp/setup.js   # one-time setup — required before first run
```

`setup.js` prints the exact MCP client config to use once it completes, e.g.:

```json
{
  "catalyst-mcp": {
    "command": "node",
    "args": ["node_modules/catalyst-mcp/mcp.js"]
  }
}
```

If setup hasn't been run, `mcp.js` fails fast at startup with a clear `context.db not found — run setup first` error rather than crashing silently.

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
