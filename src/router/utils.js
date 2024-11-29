import React, { useEffect, useState, Suspense } from "react";

import {
  RouterDataProvider,
  useLocation,
  createBrowserRouter,
  useNavigate,
} from "@tata1mg/router";

import App from "../App";
import { callServer } from "../utils";
import { routes } from "./routes";
import { createFromFetch } from "react-server-dom-webpack/client";

export const useNavigateCustom = () => {
  if (typeof window === "undefined") {
    return () => {};
  }
  return useNavigate();
};

export const clientRouter = () => {
  return createBrowserRouter(clientRoutes());
};

// TODO: use "use" here
export const RouteWrapper = ({ children, fallback }) => {
  const location = useLocation();
  const [rscContent, setRscContent] = useState(null);

  useEffect(() => {
    const content = createFromFetch(
      fetch("/rsc?location=" + location.pathname),
      {
        callServer,
      }
    );
    setRscContent(content);
  }, [location.pathname]);

  return rscContent
};

const clientRoutes = () => {
  const getPreparedRoutes = (routes) => {
    return routes.map((route) => {
      const routeToRender = {
        ...route,
        element: <RouteWrapper />,
      };
      return routeToRender;
    });
  };

  return [
    {
      element: (
        <RouterDataProvider initialState={{}}>
          <App />
        </RouterDataProvider>
      ),
      children: getPreparedRoutes(routes),
    },
  ];
};

const serverRoutes = () => {
  const getPreparedRoutes = (routes) => {
    return routes.map((route) => {
      const Component = route.component;
      const routeToRender = {
        ...route,
        element: <Component />,
      };
      return routeToRender;
    });
  };

  return [
    {
      element: (
        <RouterDataProvider initialState={{}}>
          <App />
        </RouterDataProvider>
      ),
      children: getPreparedRoutes(routes),
    },
  ];
};
