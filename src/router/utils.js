import React, { Suspense } from "react";
import {
  RouterDataProvider,
  useRoutes,
  useLocation,
  createBrowserRouter,
} from "@tata1mg/router";

import App from "../App";
import { callServer } from "../utils";
import { routes } from "./routes";

export const ServerRouter = () => {
  return useRoutes(serverRoutes());
};

export const clientRouter = () => {
  return createBrowserRouter(clientRoutes());
};

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
    // TODO: is location dependency needed?
  }, [location.pathname]);

  return <Suspense fallback={fallback}>{use(rscContent)}</Suspense>;
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
        <RouterDataProvider>
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
        <RouterDataProvider>
          <App />
        </RouterDataProvider>
      ),
      children: getPreparedRoutes(routes),
    },
  ];
};
