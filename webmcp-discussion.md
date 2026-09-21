# WebMCP Integration: Exposing Catalyst Apps as Agent-Callable Tools

<!-- SCOPE: post-1.0.0, non-gating. Ships as `catalyst-core/webmcp` subpath or a
sibling `@catalyst/webmcp` package. Story 4 freezes the root at 8 exports. -->

## 1. What's coming: agents that act *through* the browser

A new class of AI agent is arriving in the browser itself — Chrome's is in [origin trial from Chrome 153](https://developer.chrome.com/docs/ai/webmcp), Edge has a preview, and it's being standardized in the W3C Web Machine Learning Community Group as **WebMCP** ([spec](https://webmachinelearning.github.io/webmcp/), [explainer](https://github.com/webmachinelearning/webmcp)). These agents don't screen-scrape and don't call your backend. They ask the *page* what it can do, and the page answers with a list of typed, named actions.

The whole API is one object on `document`. A page registers a **tool** — a `{ name, description, inputSchema, execute }` descriptor where `inputSchema` is JSON Schema and `execute` runs your own client-side code:

```js
await document.modelContext.registerTool({
  name: "filter_products",
  description: "Filter the product list by category, price, and rating.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string" },
      maxPrice: { type: "number" },
      minRating: { type: "number", minimum: 0, maximum: 5 },
    },
  },
  execute: async (filters) => {
    await applyFilters(filters);          // the same call your filter UI makes
    return `Showing ${visibleCount()} products.`;
  },
}, { signal: controller.signal });        // controller.abort() unregisters
```

An in-page agent then discovers and runs tools via `document.modelContext.getTools()` / `executeTool()`. There's also a declarative form — an HTML `<form toolname="…" tooldescription="…">` is auto-synthesized into a tool.

**Why it matters:** the agent works on the real page, in the user's real session, with the user watching — no parallel API to build and secure, no re-implementing auth on an MCP server, no brittle selectors.

**It's early.** The entry point moved from `navigator.modelContext` to `document.modelContext` in 2026, bulk registration was removed, and the `execute` return shape isn't finalized. The *idea* — pages expose typed tools to a browser agent — is what's stable. Full API: [developer.chrome.com/docs/ai/webmcp](https://developer.chrome.com/docs/ai/webmcp).

<!-- VIDEO: drag webmcp-catalyst.mp4 into the GitHub editor here — it becomes an inline player. 40s walkthrough: the problem, the integration, the query flow. -->

## 2. The problem: WebMCP assumes one document = one tool set

WebMCP's model is a **document**: a page loads, registers its tools, you navigate away, the document is destroyed, the next one registers its own. A multi-page site gets this for free — every navigation is a fresh `document.modelContext`.

A single-page app has **one document for its whole lifetime**. React Router swaps components; the document never changes. Three things break.

Take a storefront: `/`, `/category/:slug`, `/product/:id`.

**1 — Tools outlive their page.**
The category page registers `filter_products`. The user opens a product. `filter_products` is *still registered* unless that component tore it down on unmount — so the agent, now on a detail page, still sees a filter tool and will call it into the void.

> The spec hit this itself: the bulk `provideContext()` call was **removed** in 2026 because "register everything up front" left stale tools around after their UI was gone.

**2 — The schema is written three times.**
`/product/:id` declares `id` in the route. The fetcher for that page already reads `params.id`. Now the tool's `inputSchema` describes `id` a third time, by hand. No single owner — it drifts the moment the route changes.

**3 — SSR + hydration is a dead zone.**
`document.modelContext` doesn't exist on the server. An agent landing on `/product/shoe-123` sees the server-rendered page, but between HTML paint and hydration there are **zero tools**, and nothing signals when that window closes.

**The existing React libraries only fix #1.** [`@mcp-b/react-webmcp`](https://www.npmjs.com/package/@mcp-b/react-webmcp) and [`webmcp-react`](https://github.com/agentcathq/webmcp-react) scope tool lifetime to component lifetime with `useEffect`. That kills stale tools — but a component-scoped library can't see the router or the server, so tool availability follows *mount order*, not *the URL*, and #2 and #3 remain.

## 3. Why Catalyst can close the gap

The three failures in Section 2 all come from the same root: a WebMCP integration needs to know things only the **router** and the **server** know, and a component-scoped library sits below both. Catalyst owns both layers.

**Catalyst owns the router and the data-fetching contract.** Routes are plain objects, and each page component carries its own fetchers as statics — this is already the framework's convention:

```js
// routes/index.js — wiring
{ path: "product/:id", component: ProductPage }

// ProductPage.js — behavior lives on the component
ProductPage.serverFetcher = async ({ params }) => getProduct(params.id)
ProductPage.clientFetcher = async ({ params }) =>
  fetch(`/api/product/${params.id}`).then((r) => r.json())
```

`RouterDataProvider` computes the matched-route set and re-runs the fetchers **on every path change** (`useEffect` keyed on `match.pathname` / `match.params`). `fetchRouteData` reads `serverFetcher` / `clientFetcher` off the lazily-loaded component module and calls them with a fixed shape — `{ route, location, params, searchParams, navigate }`. That means, for any route, Catalyst already has:

| Fact WebMCP needs | Catalyst already has it, here |
|---|---|
| tool `name` + required params | the route's path pattern (`product/:id`) |
| the `execute` body | that page's `serverFetcher` / `clientFetcher`, signature `(params, searchParams) → data` |
| *when* a tool should appear / disappear | the matched-route set, recomputed on navigation |
| navigation as part of `execute` | `navigate` is already passed into every fetcher call |

**Catalyst owns the server.** SSR is Catalyst's Express handler, so it can emit the `Permissions-Policy: tools` header and inline a declarative tool manifest into the server-rendered HTML — closing the pre-hydration gap that a client-only library can't touch.

**Catalyst owns the hydration boundary.** The framework already exposes `hydrationReady`; imperative tool registration can be gated on it, giving the agent a defined "the page is live now" signal.

None of this is available to `@mcp-b/react-webmcp` or `webmcp-react` — not because those libraries are wrong, but because the router table, the fetcher contract, the SSR response, and the hydration signal are all framework-level facts.

## 4. Proposal: three layers, matching WebMCP's own split

WebMCP already distinguishes **declarative** tools (synthesized from markup, no JS) from **imperative** ones (`registerTool` with a callback). Catalyst's integration mirrors that split, plus one framework-owned layer.

<!-- All API names below (`ProductPage.tool`, `useTool`, `navigate`,
`get_current_route`, the `searchParams` key) are placeholders — final naming depends on implementation. -->

### 4a. Declarative — route-derived read tools

A page opts in by adding one static next to its fetcher:

```js
// ProductPage.js
ProductPage.serverFetcher = async ({ params }) => getProduct(params.id)

ProductPage.tool = {
  description: "Open a product page by id and return its details.",
  // `id` is derived from the route path `product/:id` — not re-declared here
  searchParams: {
    variant: { type: "string", description: "colour / size variant to preselect" },
  },
  annotations: { readOnlyHint: true },
}
```

Catalyst derives the rest:

- **`name`** from the path pattern — `product/:id` → `product`
- **`inputSchema`** from the route's `:params` (required) + any annotated `searchParams` (optional)
- **`execute`** = `navigate(fillPath("product/:id", input))` then `await` that route's fetcher, returning its data
- **lifetime** = one `AbortController` per matched route; entering the route registers, leaving it aborts — driven by the same matched-route set `RouterDataProvider` already tracks

This is the zero-glue path: the agent gets a typed "go to this product" tool, and because `execute` goes through `navigate`, **the user sees the page change** — WebMCP's core promise, upheld by construction.

### 4b. Imperative — `useTool` for actions

Reads derive cleanly; mutations don't. For "add to cart", "apply coupon", "submit review", a component declares a tool directly:

```js
useTool({
  name: "add_to_cart",
  description: "Add the current product to the cart.",
  inputSchema: {
    type: "object",
    properties: { quantity: { type: "number", minimum: 1 } },
  },
  execute: async ({ quantity = 1 }) => {
    await cart.add(productId, quantity)
    return `Added ${quantity} to cart.`
  },
})
```

`useTool` handles what the raw API leaves to you:

- **lifetime** = component mount → unmount (`AbortController` created and aborted by the hook)
- **registration** deferred until `hydrationReady`, so SSR'd pages never expose a tool whose `execute` isn't wired yet
- **namespacing** by the current route, so two pages can both have an `add_to_cart` without collision
- **errors** thrown in `execute` are mapped through Catalyst's existing error registry (the 72-code `CatalystError` set) into a structured tool result, instead of each app inventing its own error text

### 4c. Framework-level — the router as a tool

Catalyst registers a small fixed set itself, once per app:

- **`navigate`** — `{ path: <enum of the app's route patterns> }`, so the agent can move around without a per-page tool
- **`get_current_route`** — returns the active path, params, and which tools are live

The route table is compiled to an `enum`, so the agent gets a closed, valid set of destinations rather than a free-text path.

### 4d. Authoring support: `catalyst-mcp`

Catalyst already ships an MCP server (`catalyst-mcp`) that runs in the developer's editor — today it answers framework questions, explains error codes, checks config, and drives migration task plans from a knowledge base synced off `catalyst-core@main`.

WebMCP tool authoring is a natural extension of it. Because the MCP already has the route table, the `serverFetcher` / `clientFetcher` contract, and the framework's conventions in its knowledge base, it can:

- **scaffold** a `ProductPage.tool` static or a `useTool` call from a route path and its fetcher signature
- **lint** a hand-written tool — missing `annotations.readOnlyHint` on a read, an `execute` that fetches without navigating, a schema that contradicts the route's `:params`
- **explain** WebMCP-layer errors through the same `explain_error` path as the rest of the framework

The runtime tools (4a–4c) and the authoring tools (4d) are the same conventions seen from two ends: `catalyst-mcp` writes them, the browser agent calls them.

### Server side

For all three runtime layers, Catalyst's SSR handler emits `Permissions-Policy: tools` and inlines a manifest of the declarative (4a) tools into the HTML, so an agent arriving on a deep link sees the read tools **before** hydration; the imperative ones (4b) light up the moment `hydrationReady` fires.

## 5. What this unlocks

All examples use the storefront from Section 2: `/`, `/category/:slug`, `/product/:id`.

---

**"Show me the running shoes under ₹3000"** — a parameterised read

- *Raw WebMCP:* hand-write a `filter_products` tool — its `name`, an `inputSchema` for category and price, and an `execute` that runs the filter logic *and* keeps the URL in sync itself. The category/price shape now exists in three places: the route, the fetcher, and the tool.
- *With Catalyst:* `CategoryPage.tool = { annotations: { readOnlyHint: true } }`. The `slug` param and the price/sort `searchParams` derive from the route; `execute` navigates and runs the page's own fetcher. One definition.

---

**Agent goes category → product → back**

- *Raw WebMCP:* `filter_products` from the category page stays registered on the product page unless that component explicitly cleaned it up. The agent's tool list is stale.
- *With Catalyst:* leaving `/category/:slug` aborts that route's controller. The live tool set always matches the current URL.

---

**Agent opens a shared link to `/product/shoe-123`**

- *Raw WebMCP:* between server HTML and hydration, `document.modelContext` is empty — "add to cart" has nothing to call, and whether it works depends on timing.
- *With Catalyst:* SSR inlines the read-tool manifest and sets `Permissions-Policy: tools`; `add_to_cart` registers on `hydrationReady`. A defined ready signal, no gap.

---

**"Add two of these to my cart, then check out"** — an action

- *Raw WebMCP:* a custom `registerTool` in the component, a manual `AbortController`, and manual translation of a failed `cart.add` into tool-result text.
- *With Catalyst:* `useTool({ name: "add_to_cart", … })` — mount/unmount lifetime, route-namespaced, and a thrown `CatalystError` becomes a structured result automatically.

---

**"What can I do here?" / "take me to the offers page"**

- *Raw WebMCP:* no route concept — the dev builds a bespoke navigation tool and hand-maintains the list of valid paths.
- *With Catalyst:* `navigate` and `get_current_route` ship with the framework; destinations are an `enum` compiled from the route table.

---

**Adding agent support to a 40-route app**

- *Raw WebMCP:* 40 × (write the tool + wire its lifetime + keep the schema in sync + handle SSR). In practice this doesn't happen — maybe the top three pages get tools.
- *With Catalyst:* read tools are one static per page, actions are one hook per interaction. Coverage scales with the routes you already have.

---

**In one line:**

- **Before:** every parameterised, navigable tool is bespoke glue that re-implements the router and drifts from it; stale tools on every client nav; a dead zone during hydration. Only a handful of pages ever get agent tools.
- **With Catalyst:** a read tool is a static next to your fetcher, an action is a hook, lifetime tracks the URL, and SSR + hydration are the framework's job. Agent-readiness becomes a property of the whole app.

## 6. Open questions

This is a direction, not a finished design. Points that need maintainer input before any implementation:

1. **Ship location.** A `catalyst-core/webmcp` subpath export, or a separate `@catalyst/webmcp` package (like `@catalyst/cloud-ai`)? Story 4 freezes the root at 8 exports, so it is *not* a root export either way — but subpath vs. sibling package changes the dependency and release story.

2. **Building on a moving spec.** The API entry point, registration model, and `execute` return shape have all changed in 2026. Do we wait for the origin trial to conclude, or build behind a flag against the current Chrome shape and absorb the churn?

3. **Where the declarative tool is declared.** The draft puts `ProductPage.tool` as a static on the component, next to `serverFetcher` / `clientFetcher` — consistent with the existing convention. Alternative: a `tool` key on the route object. Static keeps behavior with the component; route key keeps all routing metadata in one file.

4. **`execute` for a declarative read = navigate + refetch.** Is "the tool causes a real navigation" always desired, or do we need a non-navigating "just fetch and return" mode for agents that want data without moving the user?

5. **Auth and side-effecting tools.** WebMCP runs in the user's session, so a tool inherits their cookies. Do action tools (`add_to_cart`, `submit_review`) need an explicit per-tool confirmation hook, beyond whatever the browser agent already prompts for?

6. **Declarative `<form>` support.** WebMCP synthesizes tools from plain `<form>` elements. Catalyst apps rarely use raw forms — is form-synthesis worth supporting, or do we stay entirely on the route/hook model?

7. **`catalyst-mcp` scope.** Should WebMCP scaffolding and linting (4d) be a first-class part of the MCP for 1.0-era tooling, or a later add-on once the runtime API stabilises? It depends on knowledge-base entries that don't exist yet.

## Non-goals

- **Headless or fully autonomous agents.** WebMCP is human-in-the-loop; so is this. Not a scraping or RPA layer.
- **A 1.0.0 feature.** Out of scope for the release; this discussion is about the version after.
- **Native / universal-app support.** Deliberately dropped for now — WebMCP targets a browser agent, and what that means inside a WebView is a separate question for later.


