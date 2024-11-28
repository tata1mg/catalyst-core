import React, { use } from "react";
import { hydrateRoot } from "react-dom/client";

import {
  registerWebpackPolyfills,
  importRSDWClient,
  callServer,
} from "./utils";

// import { clientRouter } from "./router/utils";
// import { RouterProvider } from "@tata1mg/router";

registerWebpackPolyfills();

const hydrate = async () => {
  const { clientRouter } = await import("./router/utils");
  const { RouterProvider } = await import("@tata1mg/router");

  const router = clientRouter();

  const Application = () => {
    return <RouterProvider router={router} />;
  };

  const container = document.getElementById("app");
  hydrateRoot(container, <Application />);
};

hydrate();
