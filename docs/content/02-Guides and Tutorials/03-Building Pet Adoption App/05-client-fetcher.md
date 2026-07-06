---
title: Client-Side Data Fetching
slug: client-fetcher
id: client-fetcher
sidebar_position: 5
---

# Client-Side Data Fetching

Add `clientFetcher` to enable smooth client-side navigation.

---

## Why clientFetcher?

- `serverFetcher` runs during SSR (first page load, hard refresh)
- `clientFetcher` runs during client-side navigation (clicking links)

Without `clientFetcher`, navigation triggers a full page reload to run `serverFetcher`.

---

## Add clientFetcher to BreedDetails

Update `src/js/pages/BreedDetails/BreedDetails.js`:

```jsx title="src/js/pages/BreedDetails/BreedDetails.js"
import React from "react";
import { useCurrentRouteData, useParams, Link } from "@tata1mg/router";

const BreedDetails = () => {
  const { breed } = useParams();
  const { data, error, isFetching } = useCurrentRouteData();

  if (isFetching) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  const images = data?.message || [];

  return (
    <div style={{ padding: "20px" }}>
      <Link to="/" style={{ color: "#4CAF50" }}>
        ← Back to Breeds
      </Link>
      <h1 style={{ textTransform: "capitalize" }}>{breed} Dogs</h1>
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        {images.slice(0, 8).map((url, index) => (
          <img
            key={index}
            src={url}
            alt={`${breed} ${index + 1}`}
            style={{ width: "250px", height: "250px", objectFit: "cover", borderRadius: "8px" }}
          />
        ))}
      </div>
    </div>
  );
};

// Server-side fetcher
BreedDetails.serverFetcher = async ({ params }) => {
  const response = await fetch(`https://dog.ceo/api/breed/${params.breed}/images`);
  return response.json();
};

// Client-side fetcher
BreedDetails.clientFetcher = async ({ params }) => {
  const response = await fetch(`https://dog.ceo/api/breed/${params.breed}/images`);
  return response.json();
};

export default BreedDetails;
```

---

## Add clientFetcher to Home

Update `src/js/pages/Home/Home.js` to add `clientFetcher`:

```jsx
// Add after serverFetcher
Home.clientFetcher = async () => {
  const response = await fetch("https://dog.ceo/api/breeds/list/all");
  return response.json();
};
```

---

## Test Navigation

Click on breed cards and use the back link. Navigation is now smooth without full page reloads.

---

## When to Use Each Fetcher

| Scenario | Fetcher Used |
|----------|--------------|
| Direct URL visit | `serverFetcher` |
| Page refresh | `serverFetcher` |
| Click `<Link>` | `clientFetcher` |
| `useNavigate()` | `clientFetcher` |

Next, we'll add styling to make the app look better.
