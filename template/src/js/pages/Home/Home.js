import React from "react";
import { Link, useCurrentRouteData } from "@tata1mg/router";

const Home = () => {
  const { data, error, isFetching } = useCurrentRouteData();

  if (isFetching) return <div className="container">Loading breeds...</div>;
  if (error)
    return (
      <div className="container">Error loading breeds: {error.message}</div>
    );

  const dogs = data?.message || [];
  const breeds = Object.keys(dogs);

  return (
    <div className="container">
      <h1>Available Dog Breeds</h1>
      <div className="breed-list">
        {breeds.slice(0, 12).map((breed) => (
          <div key={breed} className="breed-card">
            <h2 className="breed-name">{breed}</h2>
            <p>Click to see available dogs</p>
            <Link to={`/breed/${breed}`} className="btn" data-testid={breed}>
              View Dogs
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
};

Home.clientFetcher = async () => {
  try {
    const response = await fetch("https://dog.ceo/api/breeds/list/all");
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching dog breeds:", error);
    throw error;
  }
};

Home.serverFetcher = async () => {
  try {
    const response = await fetch("https://dog.ceo/api/breeds/list/all");
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching dog breeds:", error);
    throw error;
  }
};

Home.setMetaData = () => {
  return [<title>Home</title>];
};

export default Home;
