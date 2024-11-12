import React, { use, useEffect } from "react";
import { createFromFetch } from "react-server-dom-webpack/client";
import { callServer } from "./utils";

export const routes = [
  {
    path: "/",
    component: Page1,
  },
  {
    path: "/test",
    component: Page2,
  },
];

const Page1 = () => {
  return <div>Page1</div>;
};

const Page2 = () => {
  return <div>Page2</div>;
};

export const ClientRouter = () => {
  const [rscPromise, setRscPromise] = useState(null);

  useEffect(() => {
    setRscPromise(
      createFromFetch(fetch(`/rsc?location=${window.location}`), {
        callServer,
      })
    );
  }, [window.location]);

  return <div>{use(rscPromise)}</div>;
};

export const ServerRouter = ({ location }) => {
  const match = routes.map((route) => route.path === location);
  const Component = match.Component;
  return <Component />;
};
