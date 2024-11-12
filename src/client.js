import React, { use } from "react";
import { hydrateRoot } from "react-dom/client";

import {
  registerWebpackPolyfills,
  importRSDWClient,
  callServer,
} from "./utils";

registerWebpackPolyfills();

const hydrate = async () => {
  // Doing this because we need to call registerWebpackPolyfills before importing the RSDW client package
  const { createFromFetch } = await importRSDWClient();

  const content = createFromFetch(fetch("/rsc"), {
    callServer,
  });

  const Application = () => {
    return use(content);
  };

  const container = document.getElementById("app");
  hydrateRoot(container, <Application />);
};

hydrate();
