import React from "react";

import AsyncComponent from "../components/AsyncComponent";
import ClientComponent from "../components/ClientComponent";

const Page1 = () => {
  return (
    <div>
      <div>Page 1</div>
      <div>--------------------------</div>
      <div>Async Component</div>
      <AsyncComponent />
      <div>--------------------------</div>
      <div>Client Component</div>
        <ClientComponent />
    </div>
  );
};

export default Page1;
