---
title: Navigation and Detail Page
slug: navigation
id: navigation
sidebar_position: 4
---

# Navigation and Detail Page

Let's create a breed detail page and add client-side navigation.

---

## Create the Detail Page

Create `src/js/pages/BreedDetails/BreedDetails.js`:

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

BreedDetails.serverFetcher = async ({ params }) => {
  const response = await fetch(`https://dog.ceo/api/breed/${params.breed}/images`);
  return response.json();
};

export default BreedDetails;
```

---

## Add the Route

Update `src/js/routes/index.js`:

```jsx title="src/js/routes/index.js"
import Home from "../pages/Home/Home";
import BreedDetails from "../pages/BreedDetails/BreedDetails";

const routes = [
  {
    path: "/",
    index: true,
    component: Home,
  },
  {
    path: "/breed/:breed",
    component: BreedDetails,
  },
];

export default routes;
```

---

## Add Links to Home Page

Update `src/js/pages/Home/Home.js` to include navigation links:

```jsx title="src/js/pages/Home/Home.js"
import React from "react";
import { useCurrentRouteData, Link } from "@tata1mg/router";

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
            }}
          >
            <h2 style={{ textTransform: "capitalize" }}>{breed}</h2>
            <Link
              to={`/breed/${breed}`}
              style={{
                display: "inline-block",
                padding: "8px 16px",
                background: "#4CAF50",
                color: "white",
                textDecoration: "none",
                borderRadius: "4px",
              }}
            >
              View Dogs
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
};

Home.serverFetcher = async () => {
  const response = await fetch("https://dog.ceo/api/breeds/list/all");
  return response.json();
};

export default Home;
```

---

## Test Navigation

Click on a breed card. Notice the page does a **full reload** instead of a smooth transition.

This is because we're missing a `clientFetcher`. We'll fix this in the next step.
