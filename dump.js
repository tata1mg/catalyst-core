// Plugin that transforms server actions to only have their reference for client build
// TODO: handle individual server actions instead of just directives
// const transfromServerActions = () => {
//   return {
//     name: "rsc-transform-server-plugin",
//     transform(_, id) {
//       if (serverEntriesSet.has(id)) {
//         let newCode = `import { registerServerReference } from "react-server-dom-webpack/server.edge";\n`;
//         newCode += `export default registerServerReference('noice', 'not noice')`;
//         return newCode;
//       }
//     },
//   };
// };

let jsx = React.use(
  createFromNodeStream(
    nodeStream,
    new Proxy(
      {},
      {
        get(_, key) {
          return new Proxy(
            {},
            {
              get(_, id) {
                console.log("111 proxy: ", key, id);
              },
            }
          );
        },
      }
    )
  )
);

// Creates manifest files to track client components
const clientManifestPlugin = () => {
  const clientManifest = {};
  const ssrManifest = {};
  return {
    name: "client-manifest-plugin",
    generateBundle(_, bundle) {
      for (const [fileName, chunkInfo] of Object.entries(bundle)) {
        if (
          chunkInfo.type === "chunk" &&
          clientEntriesSet.has(chunkInfo.facadeModuleId)
        ) {
          clientManifest[chunkInfo.facadeModuleId] = {
            id: fileName,
            name: "*",
            chunks: [fileName],
          };

          ssrManifest[fileName] = {
            specifier: chunkInfo.facadeModuleId,
            name: "*",
          };
        }
      }

      this.emitFile({
        type: "asset",
        fileName: "react-client-manifest.json",
        source: JSON.stringify(clientManifest, null, 2),
      });

      this.emitFile({
        type: "asset",
        fileName: "react-ssr-manifest.json",
        source: JSON.stringify(ssrManifest, null, 2),
      });
    },
  };
};

await viteBuild({
  plugins: [],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    minify: false,
    rollupOptions: {
      input: {
        ...clientEntries,
      },
      external: ["react"],
      // somehow, removing this creates a chunk without the actual component code
      preserveEntrySignatures: "exports-only",
      output: {
        entryFileNames: "[name]",
        globals: {
          react: "react",
        },
      },
    },
    outDir: "build/clientComponents",
  },
  esbuild: {
    loader: "jsx",
    include: /src\/.*\.js$/,
    exclude: [],
  },
});

// TODO: optimize to only apply for react-server-dom-webpack package
const webpackPolyFillPlugin = () => {
  return {
    name: "webpack-polyfill-plugin",
    transform(code, id) {
      if (id.includes("src/client.js")) {
        code += `
              globalThis.module_cache = new Map();
      
              globalThis.__webpack_require__ = (id) => {
                  return globalThis.module_cache.get(id);
              };
      
              globalThis.__webpack_chunk_load__ = (id) => {
                  return import(id).then((module) => {
                  if (module.default) {
                      return globalThis.module_cache.set(id, module.default);
                  }
                  return globalThis.module_cache.set(id, module);
                  });
              };
            `;
        return code;
      }
    },
  };
};
