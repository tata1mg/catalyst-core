import React from "react";

import AsyncComponent from "../components/AsyncComponent";
import ClientComponent from "../components/ClientComponent";
// import { useNavigate } from "@tata1mg/router";

const Page1 = () => {
  //   const navigate = useNavigate();
  return (
    <div>
      <div>Page 1</div>
      {/* <div onClick={() => navigate("/test")}>Go to Page 2</div> */}
      <div>--------------------------</div>
      <div>Async Component</div>
      <AsyncComponent />
      <div>--------------------------</div>
      <div>Client Component</div>
      <React.Suspense fallback="client component fallback">
        <ClientComponent />
      </React.Suspense>
    </div>
  );
};

export default Page1;
