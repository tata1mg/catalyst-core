---
title: Server-Side Data Fetching
slug: server-fetcher
id: server-fetcher
sidebar_position: 3
---

# Server-Side Data Fetching

Let's fetch real data from the [Dog API](https://dog.ceo/dog-api/) using `serverFetcher`.

---

## What is serverFetcher?

`serverFetcher` is a function that runs on the server during SSR. It fetches data before the page renders, ensuring content is available in the initial HTML.

---

## Update the Home Component

Replace `src/js/pages/Home/Home.js`:

```jsx title="src/js/pages/Home/Home.js"
import React from "react";
import { useCurrentRouteData } from "@tata1mg/router";

const Home = () => {
  const { data, error, isFetching } = useCurrentRouteData();

  if (isFetching) return <div>Loading breeds...</div>;
  if (error) return <div>Error: {error.message}</div>;

  const breeds = Object.keys(data?.message || {});

  return (
    <div style={{ padding: "20px" }}>
      <h1>Dog Breeds</h1>
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        {breeds.slice(0, 12).map((breed) => (
          <div
            key={breed}
            style={{
              border: "1px solid #ccc",
              padding: "15px",
              borderRadius: "8px",
              width: "200px",
              textTransform: "capitalize",
            }}
          >
            <h2>{breed}</h2>
            <p>Click to see dogs</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// Server-side data fetching
Home.serverFetcher = async () => {
  const response = await fetch("https://dog.ceo/api/breeds/list/all");
  const data = await response.json();
  return data;
};

export default Home;
```

---

## How It Works

1. **Server receives request** — Catalyst matches the route to the `Home` component
2. **serverFetcher executes** — Fetches breed data from the Dog API
3. **Component renders** — `useCurrentRouteData()` provides the fetched data
4. **HTML sent to client** — Page includes pre-rendered content with data

---

## View the Result

Refresh your browser. You should see 12 dog breeds loaded from the API.

View the page source (Ctrl+U / Cmd+U) — the breed names are in the HTML, confirming SSR is working.

Next, we'll create a detail page and add navigation.
