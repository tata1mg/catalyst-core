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
