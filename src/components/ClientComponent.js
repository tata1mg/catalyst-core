"use client";
import React, { useState } from "react";

import { serverAction } from "./serverAction";
import { useNavigateCustom } from "../router/utils";
import css from "./ClientComponent.module.css";

const Counter = () => {
  const navigate = useNavigateCustom();
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
      <div>------------------------</div>
      <div onClick={() => navigate("/test")}>Go to Page 2</div>
    </div>
  );
};

export default Counter;
