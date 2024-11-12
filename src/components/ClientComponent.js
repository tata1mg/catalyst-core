"use client";
import React, { useState } from "react";

import css from "./ClientComponent.module.css";
import { serverAction } from "./serverAction";

const Counter = () => {
  const [count, setCount] = useState(0);
  const [data, setData] = useState(null);

  return (
    <div className={css.test}>
      {count}
      <button onClick={() => setCount(count + 1)}>Click me</button>
      <div>--------------------------</div>
      <div>Server Action</div>
      <button
        onClick={() => {
          serverAction().then((response) => {
            setData(response);
          });
        }}
      >
        Click Me
      </button>
      <div>Action response: {data}</div>
    </div>
  );
};

export default Counter;
