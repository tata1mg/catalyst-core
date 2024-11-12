import React from "react";

const fetcher = () => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("Resolved");
    }, 1000);
  });
};

const Fetcher = async () => {
  const res = await fetcher();
  return <div>Fetcher: {res}</div>;
};

export default Fetcher;
