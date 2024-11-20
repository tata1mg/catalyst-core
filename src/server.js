import React from "react";
import express from "express";
import { Readable } from "node:stream";
// import { StaticRouter } from "react-router-dom";
import { renderToPipeableStream } from "react-dom/server";
import { createFromReadableStream } from "react-server-dom-webpack/client.edge";

import {
  decodeReply,
  renderToReadableStream,
} from "react-server-dom-webpack/server.edge";

// import { ServerRouter } from "./router/utils";
import { registerWebpackPolyfills } from "./utils";
import { routes } from "./router/routes";

registerWebpackPolyfills();

const app = express();

app.use(express.static("build/client"));
app.use(express.static("build/client/assets"));

// TODO: handle form data
const createRsaStream = async ({ rsaId, body }) => {
  const [fileName, actionName] = rsaId.split("#");
  const args = await decodeReply(body);

  const fileContent = await import(
    `../ssrChunks/rsa-${fileName.split("/").pop()}`
  );
  const action = fileContent[actionName];

  const data = await action.apply(null, args);
  return renderToReadableStream(data);
};

app.get("/favicon.ico", (_, res) => {
  res.send("Favicon request");
});

app.post("/", async (req, res) => {
  const rsaId = req.headers["rsa-id"];
  if (rsaId) {
    const rsaStream = await createRsaStream({ rsaId, body: req.body });
    Readable.fromWeb(rsaStream).pipe(res);
  }
});

app.get("/rsc", async (req, res) => {
  const location = req.query.location;
  const match = routes.find((route) => route.path === location);
  const Component = match.component;

  const rscStream = renderToReadableStream(
    // <StaticRouter context={{}} location={req.originalUrl}>
    <Component />,
    // </StaticRouter>,
    getClientConfig(true)
  );
  Readable.fromWeb(rscStream).pipe(res);
});

app.get("/", async (req, res) => {
  try {
    const location = req.originalUrl;
    const match = routes.find((route) => route.path === location);
    const Component = match.component;

    const rscStream = renderToReadableStream(
      //   <StaticRouter context={{}} location={req.originalUrl}>
      <Component />,
      //   </StaticRouter>,
      getClientConfig()
    );

    const jsx = createFromReadableStream(rscStream, getSSRConfig());

    const Document = () => {
      return (
        <html>
          <body>
            <React.Suspense>
              <div id="app">{jsx}</div>
            </React.Suspense>
            <script type="module" src="client.js"></script>
          </body>
        </html>
      );
    };

    const stream = renderToPipeableStream(<Document />, {
      onAllReady() {
        stream.pipe(res);
      },
      onError(err) {
        console.log("111 err: ", err);
      },
    });
  } catch (err) {
    console.log("SSR Server Error: ", err);
  }
});

app.listen(3005, () => {
  console.log(`Server running on port 3005`);
});

app.on("error", (error) => {
  console.log("Server error: ", error);
});

const getClientConfig = (isClient) => {
  return new Proxy(
    {},
    {
      get(_, key) {
        const [filePath] = key.split("#");
        const fileName = filePath.split("/").pop();
        let id = `../ssrChunks/rsc-${fileName}`;
        if (isClient) {
          id = `/rsc-${fileName}`;
        }
        return {
          id: id,
          name: "*",
          chunks: [id],
        };
      },
    }
  );
};

const getSSRConfig = () => {
  return {
    ssrManifest: {
      moduleMap: new Proxy(
        {},
        {
          get(_, chunkName) {
            return new Proxy(
              {},
              {
                get(_, name) {
                  return {
                    id: chunkName,
                    chunks: [chunkName],
                    name,
                  };
                },
              }
            );
          },
        }
      ),
      moduleLoading: null,
    },
  };
};
