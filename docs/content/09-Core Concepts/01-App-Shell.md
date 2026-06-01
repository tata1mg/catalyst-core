---
title: SSR Flow
slug: ssr-flow
id: ssr-flow
---

# SSR Flow

Catalyst follows a predictable server-rendered flow: match the route, resolve route data, stream HTML, and then hydrate the same tree on the client. Understanding this lifecycle makes routing, data loading, and metadata behavior much easier to reason about.

```text
Request -> Route Match -> serverFetcher -> HTML Render -> Response
                                               |
                                               v
                                     Client Hydration -> Navigation -> clientFetcher
```

## End-To-End Flow

1. The Node server receives the request.
2. Catalyst matches the URL against the route definitions.
3. Route-level data is prepared for SSR.
4. React renders the app shell and matched route on the server.
5. HTML is streamed to the browser.
6. The client hydrates the same tree and takes over navigation.
7. Later route transitions fetch route data client-side without a full reload.

## Role Of The App Shell

The app shell is the persistent layout around the active route. It typically owns:

- global providers
- top-level layout
- shared navigation
- the outlet where the matched route renders

Because the shell stays mounted across route transitions, only the route content swaps during client navigation.

## Data Behavior Across SSR And Navigation

- `serverFetcher` prepares the initial route payload during SSR.
- `RouterDataProvider` carries that route data into hydration.
- `clientFetcher` runs on later client-side transitions and manual refresh flows.
- `useCurrentRouteData` reads the current route state from that provider context.

## What This Means For Teams

- If a page needs complete first-render content, put that logic in `serverFetcher`.
- Keep shell-level UI independent from route-specific data where possible.
- Do not rebuild the initial page request in `useEffect`; that duplicates the SSR pipeline.

## Related Docs

- [Defining Routes](/content/03-Routing/01-Defining-Routes.md)
- [RouterDataProvider](/content/03-Routing/03-Router-Data-Provider.md)
- [Data Fetching](/content/data-fetching)
