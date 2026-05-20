---
title: Data Fetching
slug: data-fetching
id: data-fetching
---

# Data Fetching

Catalyst data fetching is route-driven. Treat `serverFetcher`, `clientFetcher`, and `useCurrentRouteData` as the default model, and reach for manual `useEffect` fetching only when the request is genuinely local UI state rather than route data.

## Default Pattern

- Use `serverFetcher` for the first render and SSR response.
- Use `clientFetcher` for client-side transitions and manual re-fetch flows.
- Read the result through `useCurrentRouteData`.

```javascript
function ProductPage() {
  const { data, isFetching, error, refetch } = useCurrentRouteData();
  return <div>...</div>;
}

ProductPage.serverFetcher = async ({ params }, { store }) => {
  return fetchProduct(params.id);
};

ProductPage.clientFetcher = async ({ params }, { store }, customArgs) => {
  return fetchProduct(params.id, customArgs);
};
```

## Why This Pattern Wins

- aligns with route lifecycle
- keeps SSR and client navigation consistent
- avoids duplicated loading logic between server and browser
- gives you `refetch` and `clear` without inventing another state layer

## Avoid These Mistakes

- doing the initial page request in `useEffect`
- mixing route data and local component state without a clear boundary
- forgetting that `useCurrentRouteData` only works inside the `RouterDataProvider` tree
- treating `clientFetcher` as a replacement for every client-side interaction

## Practical Guidance

- Keep the initial route payload in `serverFetcher` whenever SEO, first paint, or route completeness matters.
- Use `refetch(customArgs)` for user-driven updates such as paging or filters when the route stays mounted.
- Clear route data only when the lifecycle really requires it.
- Pass shared dependencies like a Redux store through `fetcherArgs` instead of importing global mutable state directly.

## Universal App Consideration

On native builds, request transport can vary between localhost server, native bridge, and fallback routing. Keep your API hosts aligned with `WEBVIEW_CONFIG.accessControl.allowedUrls` so route data can take the fast path when available.

## Related Docs

- [Data Fetching](/content/data-fetching)
- [RouterDataProvider](/content/Routing/routing/router-data-provider)
