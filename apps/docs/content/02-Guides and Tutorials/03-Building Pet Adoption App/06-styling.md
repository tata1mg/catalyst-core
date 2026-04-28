---
title: Styling
slug: styling
id: styling
sidebar_position: 6
---

# Styling

Add CSS styles to make the application look polished.

---

## Create a Stylesheet

Create `src/static/css/base/pet-styles.css`:

```css
body {
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 0;
  background-color: #f5f5f5;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.breed-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px;
}

.breed-card {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s ease;
  padding: 15px;
}

.breed-card:hover {
  transform: translateY(-5px);
}

.breed-name {
  text-transform: capitalize;
  margin: 0 0 10px;
  color: #333;
}

.dog-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.dog-card {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.dog-image {
  width: 100%;
  height: 250px;
  object-fit: cover;
}

.dog-info {
  padding: 15px;
}

.btn {
  display: inline-block;
  padding: 8px 16px;
  background: #4CAF50;
  color: white;
  text-decoration: none;
  border-radius: 4px;
  margin-top: 10px;
}

.back-link {
  display: inline-block;
  margin-bottom: 20px;
  text-decoration: none;
  color: #4CAF50;
}
```

---

## Register the Stylesheet

Import the CSS in `client/styles.js`:

```javascript title="client/styles.js"
import "@css/base/pet-styles.css";
```

---

## Update Home Component

Apply the new classes to `src/js/pages/Home/Home.js`:

```jsx title="src/js/pages/Home/Home.js"
import React from "react";
import { useCurrentRouteData, Link } from "@tata1mg/router";

const Home = () => {
  const { data, error, isFetching } = useCurrentRouteData();

  if (isFetching) return <div className="container">Loading breeds...</div>;
  if (error) return <div className="container">Error: {error.message}</div>;

  const breeds = Object.keys(data?.message || {});

  return (
    <div className="container">
      <h1>Dog Breeds</h1>
      <div className="breed-list">
        {breeds.slice(0, 12).map((breed) => (
          <div key={breed} className="breed-card">
            <h2 className="breed-name">{breed}</h2>
            <Link to={`/breed/${breed}`} className="btn">
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

Home.clientFetcher = async () => {
  const response = await fetch("https://dog.ceo/api/breeds/list/all");
  return response.json();
};

export default Home;
```

---

## Update BreedDetails Component

Apply classes to `src/js/pages/BreedDetails/BreedDetails.js`:

```jsx title="src/js/pages/BreedDetails/BreedDetails.js"
import React from "react";
import { useCurrentRouteData, useParams, Link } from "@tata1mg/router";

const BreedDetails = () => {
  const { breed } = useParams();
  const { data, error, isFetching } = useCurrentRouteData();

  if (isFetching) return <div className="container">Loading...</div>;
  if (error) return <div className="container">Error: {error.message}</div>;

  const images = data?.message || [];

  return (
    <div className="container">
      <Link to="/" className="back-link">← Back to Breeds</Link>
      <h1 className="breed-name">{breed} Dogs</h1>
      <div className="dog-list">
        {images.slice(0, 8).map((url, index) => (
          <div key={index} className="dog-card">
            <img src={url} alt={`${breed} ${index + 1}`} className="dog-image" />
          </div>
        ))}
      </div>
    </div>
  );
};

BreedDetails.serverFetcher = async ({ params }) => {
  const response = await fetch(`https://dog.ceo/api/breed/${params.breed}/images`);
  return response.json();
};

BreedDetails.clientFetcher = async ({ params }) => {
  const response = await fetch(`https://dog.ceo/api/breed/${params.breed}/images`);
  return response.json();
};

export default BreedDetails;
```

Refresh your browser to see the styled application.

Next, we'll add a layout with header and footer.