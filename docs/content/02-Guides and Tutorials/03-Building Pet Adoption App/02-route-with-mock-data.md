---
title: Creating Your First Page
slug: route-with-mock-data
id: route-with-mock-data
sidebar_position: 2
---

# Creating Your First Page

Let's create a home page that displays a list of pets using mock data.

---

## Create the Home Component

Create `src/js/pages/Home/Home.js`:

```jsx title="src/js/pages/Home/Home.js"
import React from "react";

const Home = () => {
  const pets = [
    { id: 1, name: "Max", breed: "Labrador", age: 3 },
    { id: 2, name: "Bella", breed: "Beagle", age: 2 },
    { id: 3, name: "Charlie", breed: "Poodle", age: 4 },
  ];

  return (
    <div style={{ padding: "20px" }}>
      <h1>Available Pets</h1>
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        {pets.map((pet) => (
          <div
            key={pet.id}
            style={{
              border: "1px solid #ccc",
              padding: "15px",
              borderRadius: "8px",
              width: "200px",
            }}
          >
            <h2>{pet.name}</h2>
            <p>{pet.breed}</p>
            <p>Age: {pet.age} years</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Home;
```

---

## Register the Route

Update `src/js/routes/index.js`:

```jsx title="src/js/routes/index.js"
import Home from "../pages/Home/Home";

const routes = [
  {
    path: "/",
    index: true,
    component: Home,
  },
];

export default routes;
```

---

## View the Result

Refresh your browser at **http://localhost:3005**. You should see three pet cards displayed.

Next, we'll replace this mock data with real API data using `serverFetcher`.
