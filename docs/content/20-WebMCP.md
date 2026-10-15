---
title: WebMCP
slug: webmcp
id: webmcp
sidebar_position: 40
---

# WebMCP

WebMCP lets a page expose **tools** (named actions with a JSON-schema input) to an AI agent running in the browser. Catalyst ships it as `catalyst-core/webmcp`.

> **Not the same as [MCP Integration](/docs/mcp-integration).** That page is about a Node-side MCP server that helps AI *coding* tools understand your project. WebMCP runs in your *app's* browser tab and exposes the app's own actions to agents.

> **Status.** Catalyst targets the opt-in DOM shim (`catalyst-core/webmcp/shim`). Native browser `document.modelContext` is intentionally unsupported for now, because no agent can drive it yet.

## Setup

Install the shim once, before the provider mounts, and wrap your app in `WebMcpProvider` inside `RouterDataProvider`:

```jsx
import { WebMcpProvider } from "catalyst-core/webmcp"
import { installShim } from "catalyst-core/webmcp/shim"
import routes from "./routes"

installShim()

export const App = ({ children }) => (
    <WebMcpProvider routes={routes} filterNavigable={(route) => !route.path.startsWith("/docs/")}>
        {children}
    </WebMcpProvider>
)
```

`routes` is your own route table. `filterNavigable` is optional and keeps large generated page sets out of the built-in `navigate` tool's enum.

The provider registers three built-in tools for you: `navigate`, `get_current_route` and `get_page_info` (built from the page's `setMetaData`).

## Three ways to author tools

**1. Declarative, on the route.** Add `tool` to a route and Catalyst derives the name, the input schema (path params required, `searchParams` optional) and a navigating `execute`. These are available app-wide.

```js
{
    path: "/products",
    component: ProductList,
    tool: {
        description: "Browse the catalogue, optionally filtered.",
        searchParams: { category: { type: "string", enum: ["footwear", "apparel"] } },
    },
}
```

**2. Imperative, in a component.** `useTool` registers an action tool for the component's lifetime and removes it on unmount or when the user leaves the route.

```jsx
useTool({
    name: "add_to_cart",
    description: "Add the current product to the cart.",
    inputSchema: { type: "object", properties: { quantity: { type: "number", minimum: 1 } } },
    execute: async ({ quantity = 1 }) => {
        dispatch(addItem({ id, quantity }))
        return { added: true }
    },
})
```

**3. Stateful, with `deps`.** Pass a deps array when the description or schema depends on state (for example an `enum` of cart item ids). Catalyst refreshes the registration in place, so a call already in flight still completes.

```jsx
useTool({ name: "remove_from_cart", /* schema built from cartItemIds */ execute }, [cartItemIds.join()])
```

## Errors

Throw `WebMcpError` with a code from `WEBMCP_ERROR_CODES` (for example `INVALID_ARGS`, `TOOL_NOT_FOUND`) so the agent gets something to act on. Arguments listed in the schema's `required` array are checked before `execute` runs.

## Design lessons

- **Do side effects in the tool, not in a hint.** Agents routinely ignore "now call X" hints in a result. If navigating, highlighting or saving matters, the tool must do it itself.
- **Mark intent.** Use `readOnlyHint` for reads and `consequentialHint` for irreversible actions such as checkout.
- **Keep names unique.** Route tool names derive from the path and must not collide with `navigate`, `get_current_route` or `get_page_info`. Collisions log a warning and the later tool is dropped.

## Working on Catalyst itself

The docs app and examples consume the **local** build of `catalyst-core`, because the published package may not have the `webmcp` subpath yet. Run `npm ci` first, then `npm run sync-core`. Running an install afterwards restores the published package and removes the synced build.
