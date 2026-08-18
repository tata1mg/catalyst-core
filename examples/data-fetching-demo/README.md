# Suspense-based data fetching demo

A minimal Catalyst app demonstrating RFC 0001's route `loader` API — one isomorphic
data-fetching function per route, consumed via React 19's `use()` inside Suspense,
instead of paired `serverFetcher`/`clientFetcher` functions.

## What to look at

- `src/js/routes/quoteRoute.js` — the loader itself: `quote` is awaited (critical, blocks
  the shell so it's in the initial HTML), `relatedQuotes` is returned as a raw, un-awaited
  promise (deferred, streams in after).
- `server/api/index.js` — the two `defineApi` routes the loader calls through
  `catalyst-core/api`'s isomorphic `api.get(...)` (in-process on the server, a real
  `fetch` in the browser). `getRelatedQuotes` has an artificial 600ms delay so the
  deferred behavior is actually visible, not just internally correct.
- `src/js/pages/Quote/Quote.js` — reads the loader's result with `useRouteData()`;
  `relatedQuotes` is read with `use()` inside its own `<Suspense>` boundary.
- `src/js/containers/Home/Home.js` — links to the quote page with `<PrefetchLink
  prefetch="intent">`, warming both the route's chunk and its loader data on hover.

## Running it

This example needs a local build of `catalyst-core` (not the published npm package) to
pick up the loader engine:

```bash
npm install
npm run sync-core
npm run start
```

Then open `http://localhost:3005` (or whatever port `npm run start` reports), and:

1. Load the home page — hover "See a quote →" and watch the network tab; the quote and
   related-quotes requests fire before you click.
2. Click through to `/quote` — the quote itself is in the initial HTML (view-source to
   confirm); "You might also like" shows a loading state briefly, then the related
   quotes appear once the artificial 600ms delay resolves.
3. Reload directly on `/quote` (a full SSR page load) — same critical/deferred split,
   this time via the server-rendered response and the streamed deferred chunk instead
   of a client-side navigation.

## Getting Started (scaffold defaults)

For a production build, change NODE_ENV to "production" in config/config.json, then run:

```bash
npm run build
```

To serve the production build, execute:

```bash
npm run serve
```

## Documentation

Explore the complete documentation at [https://catalyst.1mg.com](https://catalyst.1mg.com).
