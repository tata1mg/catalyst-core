---
title: MCP Integration
slug: mcp-integration
id: mcp-integration
---

# MCP (Model Context Protocol) Integration

Catalyst supports [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) so AI tools can connect to a project-aware server instead of working from generic assumptions. This is useful when you want framework-aware answers about routing, configuration, build flow, and project setup.

## Setting Up MCP Support

When creating a new Catalyst application, you can enable MCP support during the setup process:

```bash
npx create-catalyst-app@latest
```

You'll be prompted with:
```
Add MCP (Model Context Protocol) support? (Y/n)
```

Selecting `Y` will create a local `mcp.js` file in your project that can be linked to any MCP-supporting client.

## What The Generated Server Does

The generated `mcp.js` entrypoint exposes Catalyst project context to MCP-compatible tools. In practice, this gives AI clients a better understanding of:

- the Catalyst project root
- framework-specific configuration
- routing and architecture concepts
- build and universal app setup
- version-scoped guidance for legacy Catalyst `0.2.x` and current `0.3.x` projects

The MCP server reads the installed `catalyst-core` version before returning router, build, hydration,
or conversion instructions. This keeps webpack-era `0.2.x` guidance separate from the Vite and
integrated-router contracts in `0.3.x`. If the installed version cannot be determined, confirm the
target version before applying generated migration steps.

### On-device AI (`catalyst-ai`)

The knowledge base covers on-device AI, so an MCP client can walk you through enabling Gemma 4 E2B (LiteRT-LM) or Apple Foundation Models: installing `catalyst-ai`, setting `WEBVIEW_CONFIG.ai.enabled`, picking an engine with `useAI({ provider: "litert" | "foundation-models" })`, and the iOS requirements. See [`useAI`](/content/11-API%20Reference/01-Hooks.md) for the hook options and [On-Device AI](/content/11-API%20Reference/02-Configuration.mdx) for the config and iOS requirements. The `check_config` tool also flags `ai.enabled` without `catalyst-ai` installed, an unknown `AI_CONFIG.browser.engine`, and an on-device provider configured while `ai.enabled` is off.

## Connecting To MCP Clients

Replace `/complete/path/to/your/project/mcp/mcp.js` with the absolute path to your project's `mcp.js` file.

### Claude Desktop

To connect your Catalyst MCP server to Claude Desktop, add the following configuration to your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "catalyst": {
      "command": "node",
      "args": ["/complete/path/to/your/project/mcp/mcp.js"]
    }
  }
}
```

## Monorepo Note

In monorepo setups, run MCP setup from the Catalyst app package itself rather than from the monorepo root. Catalyst resolves the nearest package that actually depends on `catalyst-core`, and that package becomes the MCP project root.

## Recommended Practice

- keep the configured path absolute
- configure the MCP server per project, not as a generic shared script
- if you use a monorepo, verify the client points to the Catalyst sub-package, not the repository root

### Cursor

For Cursor integration, create or update `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "catalyst": {
      "command": "node",
      "args": ["/complete/path/to/your/project/mcp/mcp.js"]
    }
  }
}
```

### Deputy Dev

For Deputy Dev integration, create or update `.deputydev/mcp_settings.json` in your project root:

```json
{
  "mcp_servers": {
    "catalyst": {
      "command": "node",
      "args": ["/complete/path/to/your/project/mcp/mcp.js"]
    }
  }
}
```
