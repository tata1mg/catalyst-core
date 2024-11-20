import React, { use } from "react";
import { hydrateRoot } from "react-dom/client";

import {
  registerWebpackPolyfills,
  importRSDWClient,
  callServer,
} from "./utils";

// import { clientRouter } from "./router/utils";
// import { RouterDataProvider } from "@tata1mg/router";

registerWebpackPolyfills();

const hydrate = async () => {
  // Doing this because we need to call registerWebpackPolyfills before importing the RSDW client package
  const { createFromFetch } = await importRSDWClient();

  const content = createFromFetch(
    fetch("/rsc?location=" + window.location.pathname),
    {
      callServer,
    }
  );

  const Application = () => {
    return use(content);
  };

  //   const router = clientRouter(createFromFetch);

  //   const Application = () => {
  //     return <RouterProvider router={router} />;
  //   };

  const container = document.getElementById("app");
  hydrateRoot(container, <Application />);
};

hydrate();
