---
title: Data Fetching
slug: data-fetching
id: data-fetching
---

# Data Fetching

Catalyst provides two fetcher functions for loading data:

| Fetcher | When it runs |
|---------|--------------|
| `serverFetcher` | On initial page load (SSR) |
| `clientFetcher` | On client-side navigation |

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
import { useCurrentRouteData } from "@tata1mg/router";

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
import { useRouterData } from "@tata1mg/router";

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
