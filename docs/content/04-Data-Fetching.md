---
title: Data Fetching
slug: data-fetching
id: data-fetching
---

# Data Fetching

The API examples below target Catalyst `0.3.x` and import route data hooks from `catalyst-core`.
Legacy `0.2.x` applications use the same concepts through `@tata1mg/router`.

Catalyst provides two fetcher functions for loading data:

| Fetcher | When it runs |
|---------|--------------|
| `serverFetcher` | On initial page load (SSR) |
| `clientFetcher` | On client-side navigation |

A newer, Suspense-based `loader` API exists alongside these — see [Loaders](#loaders-suspense-based)
below. It's purely additive: existing `serverFetcher`/`clientFetcher` routes keep working exactly as
documented here, and you can migrate route-by-route whenever it makes sense, or not at all.

---

## Basic Usage

Attach fetcher functions to your page component:

```javascript
const HomePage = () => {
  const { data, isFetching, error } = useCurrentRouteData();

  if (isFetching) return <Loading />;
  if (error) return <Error message={error.message} />;

  return <div>{data.title}</div>;
};

HomePage.serverFetcher = async ({ params }) => {
  const response = await fetch("https://api.example.com/data");
  return response.json();
};

HomePage.clientFetcher = async ({ params }) => {
  const response = await fetch("https://api.example.com/data");
  return response.json();
};

export default HomePage;
```

---

## Fetcher Parameters

Both fetchers receive the same parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `route` | `object` | Route object from routes array |
| `location` | `Location` | Current URL location |
| `params` | `object` | Dynamic route parameters |
| `searchParams` | `URLSearchParams` | Query string parameters |
| `navigate` | `function` | Navigation function for redirects |

Second argument contains `fetcherArgs` from `RouterDataProvider`:

```javascript
HomePage.serverFetcher = async ({ params, searchParams }, { store }) => {
  const page = searchParams.get("page") || 1;
  return store.dispatch(fetchProducts(params.category, page));
};
```

---

## Accessing Data

### `useCurrentRouteData`

Returns data for the current route:

```javascript
import { useCurrentRouteData } from "catalyst-core";

const ProductPage = () => {
  const { data, error, isFetching, isFetched, refetch, clear } = useCurrentRouteData();

  return (
    <div>
      {isFetching && <Spinner />}
      {error && <Error message={error.message} />}
      {data && <ProductDetails product={data} />}
    </div>
  );
};
```

| Property | Type | Description |
|----------|------|-------------|
| `data` | `any` | Data returned by fetcher |
| `error` | `Error` | Error thrown by fetcher |
| `isFetching` | `boolean` | Fetch in progress |
| `isFetched` | `boolean` | Fetch completed |
| `refetch` | `function` | Re-run `clientFetcher` |
| `clear` | `function` | Clear cached data |

### `useRouterData`

Returns data for all routes in the current tree:

```javascript
import { useRouterData } from "catalyst-core";

const Layout = () => {
  const routerData = useRouterData();
  // { "/dashboard": { data, error, ... }, "/dashboard/settings": { data, error, ... } }
};
```

---

## Revalidation

### Refetch

Re-run the `clientFetcher` with optional arguments:

```javascript
const ProductList = () => {
  const { data, refetch } = useCurrentRouteData();
  const [page, setPage] = useState(1);

  useEffect(() => {
    refetch({ page });
  }, [page]);

  return <div>...</div>;
};

ProductList.clientFetcher = async ({ params }, { store }, { page = 1 }) => {
  const response = await fetch(`/api/products?page=${page}`);
  return response.json();
};
```

### Clear

Remove cached data for the current route:

```javascript
const { clear } = useCurrentRouteData();

useEffect(() => {
  return () => clear();
}, []);
```

---

## Server Fetcher Security

Code in `serverFetcher` is excluded from the client bundle. You can safely use:

- Environment variables with secrets
- Database connections
- Internal API calls

```javascript
HomePage.serverFetcher = async ({ params }) => {
  // Safe: not exposed to client
  const apiKey = process.env.INTERNAL_API_KEY;
  const response = await fetch("https://internal-api.example.com/data", {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  return response.json();
};
```

---

## Loaders (Suspense-based)

A `loader` replaces a route's paired `serverFetcher`/`clientFetcher` with one isomorphic function,
consumed via React 19's `use()` inside Suspense instead of `isFetching`/`error` state checks. It's
declared on the route config, not on the page component — this lets it start before the route's own
code-split chunk has finished downloading, instead of after.

```javascript
// routes/index.js
import { api } from "catalyst-core/api";

{
  path: "/breed/:breed",
  component: split(() => import("../pages/BreedDetails/BreedDetails")),
  loader: async ({ params }) => ({
    breedImages: await api.get(`/api/breed/${params.breed}/images`),      // critical
    relatedBreeds: api.get(`/api/breeds/related/${params.breed}`),        // deferred
  }),
}
```

```javascript
// pages/BreedDetails/BreedDetails.js
import { useRouteData } from "catalyst-core";
import { Suspense, use } from "react";

const RelatedBreeds = ({ promise }) => {
  const related = use(promise); // suspends until the deferred chunk streams in
  return <ul>{related.message.map((name) => <li key={name}>{name}</li>)}</ul>;
};

const BreedDetails = () => {
  const { breedImages, relatedBreeds } = useRouteData();

  return (
    <div>
      <BreedGallery images={breedImages.message} />
      <Suspense fallback={<Spinner />}>
        <RelatedBreeds promise={relatedBreeds} />
      </Suspense>
    </div>
  );
};
```

### Critical vs. deferred

Decided by shape, not configuration. A property your loader `await`s before returning is a plain,
already-resolved value — critical, and it blocks the shell so meta tags and SEO stay correct. A
property returned as a raw, un-awaited `Promise` is deferred — it streams into the response after the
shell, and reading it with `use()` needs a `<Suspense>` boundary (the route's own `split()` fallback, or
a nested one for finer-grained loading states, as above).

### `useRouteData`

```javascript
import { useRouteData } from "catalyst-core";

useRouteData();          // nearest matched route's loader result
useRouteData("parent");  // a specific ancestor's, by its route id (`route.id || route.path`)
```

A route with no `loader` returns `undefined` from `useRouteData()` without suspending. There's no
`<Await>` — a deferred field is read with `use()` directly.

### Calling your own API routes: `defineApi`

Loaders are meant to call `catalyst-core/api`'s isomorphic `api.get/post/put/patch/delete` — the same
call site works during SSR (an in-process call to the handler, no HTTP round trip) and in the browser
(a real `fetch`). Define the route once:

```javascript
// server/api/index.js
import { defineApi } from "catalyst-core/api";

export const getBreedImages = defineApi({
  method: "GET",
  path: "/api/breed/:breed/images",
  handler: async ({ params }) => getDogImages(params.breed),
});

export default [getBreedImages];
```

A handler that needs something a loopback call can't safely provide (setting cookies/headers after the
page has started streaming, for example) should throw — see the API reference page for the full error
contract (`ApiError`) and loopback semantics.

### Prefetching

```jsx
import { PrefetchLink } from "catalyst-core";

<PrefetchLink to="/breed/labrador" component={BreedDetails} loader={breedDetailsLoader} prefetch="intent">
  Labrador
</PrefetchLink>
```

`prefetch="intent"` (the default) warms the route's chunk and loader data on hover/focus; `"viewport"`
does the same once the link scrolls into view; `"none"` behaves like a plain `Link`.

### Caching

Loader results are cached client-side (keyed by route id + params + search) with a bounded LRU and an
optional `staleTime`, replacing the `disableCaching` boolean:

```javascript
// inside a loader
context.store; // still available, same as serverFetcher/clientFetcher's second argument
```

### Server-only code

A loader is expected to call `api.*` for anything that touches a database or a secret — the handler
behind `defineApi` never ships to the client bundle, the same guarantee `serverFetcher` describes above.
If a loader genuinely needs to run server-only code directly (not through `defineApi`), colocate it in a
`*.server.js` file: any import ending in that suffix is stubbed out of the client build automatically,
throwing a clear error if something accidentally tries to call it from the browser.

### What doesn't change

Existing `serverFetcher`/`clientFetcher` routes, `useCurrentRouteData`, and `useRouterData` all keep
working exactly as documented above. A `loader` is opt-in, per route — there's no global switch, and no
migration deadline.
