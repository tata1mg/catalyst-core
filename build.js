const swc = require("@swc/core");
const { build: viteBuild } = require("vite");

const clientEntriesSet = new Set();
const serverEntriesSet = new Set();

// TODO: refetch
// TODO: route change

// Plugin that looks for client components and adds them in a set
const rscAnalyzePlugin = () => {
  return {
    name: "rsc-analyze-plugin",
    transform(code, id) {
      if (/\.js/.test(id)) {
        const ast = swc.parseSync(code);
        for (const item of ast.body) {
          if (
            item.type === "ExpressionStatement" &&
            item.expression.type === "StringLiteral"
          ) {
            if (item.expression.value === "use client") {
              clientEntriesSet.add(id);
            } else if (item.expression.value === "use server") {
              serverEntriesSet.add(id);
            }
          }
        }
      }
    },
  };
};

// Plugin that transforms client component to only have their reference for server build
// TODO: will need to add checks for use client + use server in a single file
const transformClientComponents = () => {
  return {
    name: "rsc-transform-client-plugin",
    transform(_, id) {
      if (clientEntriesSet.has(id)) {
        // TODO: handle normal imports too here
        let newCode = `import { registerClientReference } from "react-server-dom-webpack/server.edge";\n`;
        newCode += `export default registerClientReference(() => { throw new Error("Cannot call client component on server") }, "${id}", "default");`;
        return newCode;
      }
    },
  };
};

const transformServerDirective = (id, ast, code) => {
  const exportNames = new Set();

  for (const node of ast.body) {
    switch (node.type) {
      case "ExportDeclaration":
        // export function testFunction() {}
        if (node.declaration.type === "FunctionDeclaration") {
          const name = node.declaration.identifier.value;
          exportNames.add(name);
        }
        // export const testFunction() {}
        else if (node.declaration.type === "VariableDeclaration") {
          for (const declaration of node.declaration.declarations) {
            if (declaration.id.type === "Identifier") {
              const name = declaration.id.value;
              exportNames.add(name);
            }
          }
        }
        break;

      // export { ... }
      case "ExportNamedDeclaration":
        for (const specifier of node.specifiers) {
          if (specifier.type === "ExportSpecifier") {
            const name = specifier.orig.value;
            // export { testFunction as somethingElse }
            if (specifier.exported?.type === "Identifier") {
              const exportedName = specifier.exported.value;
              exportNames.add(exportedName);
            }
            // export { testFunction }
            else if (specifier.orig.type === "Identifier") {
              exportNames.add(name);
            }
          }
        }
        break;

      // export default function testFunction() {}
      case "ExportDefaultDeclaration":
        if (node.decl.type === "FunctionExpression") {
          const identifier = node.decl.identifier;
          if (identifier) {
            exportNames.add("default");
          }
        }
        break;

      // export default { testFunction }
      case "ExportDefaultExpression":
        if (node.expression.type === "Identifier") {
          exportNames.add("default");
        }
    }
  }

  let newCode =
    'import { createServerReference } from "react-server-dom-webpack/client";\n' +
    'import { callServer } from "../utils";\n';

  exportNames.forEach((exported) => {
    newCode += `export ${
      exported === "default " ? exported : `const ${exported} = `
    }createServerReference(${JSON.stringify(
      `${id}#${exported}`
    )}, callServer);\n`;
  });

  return newCode;
};

const transformServerActions = () => {
  return {
    name: "rsc-transform-server-plugin",
    transform(code, id) {
      if (!code.includes("use server")) {
        return code;
      }

      let hasUseServerDirective = false;
      let hasUseClientDirective = false;

      const ast = swc.parseSync(code);

      for (const node of ast.body) {
        if (
          node.type === "ExpressionStatement" &&
          node.expression.type === "StringLiteral"
        ) {
          if (node.expression.value === "use client") {
            hasUseClientDirective = true;
          } else if (node.expression.value === "use server") {
            hasUseServerDirective = true;
          }
        }
      }

      if (hasUseClientDirective && hasUseServerDirective) {
        throw new Error(
          "Cannot use both 'use client' and 'use server' directives in the same file"
        );
      }

      let transformedCode = code;

      // TODO: handle non server directive actions
      if (hasUseServerDirective) {
        transformedCode = transformServerDirective(id, ast, code);
      }

      return transformedCode;
    },
  };
};

const buildInit = async () => {
  // Only adds client components in a set, does not produce an output
  await viteBuild({
    plugins: [rscAnalyzePlugin()],
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
    ssr: {
      noExternal: true,
    },
    build: {
      ssr: true,
      rollupOptions: {
        input: "src/router/routes.js",
      },
      write: false,
    },
    esbuild: {
      loader: "jsx",
      include: /src\/.*\.js$/,
      exclude: [],
    },
  });

  // TODO: same name entries would cause issues - maybe add hashes in this?
  const clientEntries = Object.fromEntries(
    Array.from(clientEntriesSet).map((entry) => {
      return [`rsc-${entry.split("/").pop()}`, entry];
    })
  );

  const serverEntries = Object.fromEntries(
    Array.from(serverEntriesSet).map((entry) => {
      return [`rsa-${entry.split("/").pop()}`, entry];
    })
  );

  // builds client components and server actions chunks for server
  await viteBuild({
    plugins: [],
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
    build: {
      ssr: true,
      rollupOptions: {
        input: {
          ...clientEntries,
          ...serverEntries,
        },
        output: {
          format: "cjs",
          entryFileNames: "[name]",
        },
      },
      outDir: "build/ssrChunks",
    },
    esbuild: {
      loader: "jsx",
      include: /src\/.*\.js$/,
      exclude: [],
    },
  });

  // builds the web server
  await viteBuild({
    plugins: [transformClientComponents()],
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
    // this builds the RSDW with react-server conditions and externalize react-dom, so imports from both can work on the same file
    ssr: {
      noExternal: true,
      external: ["react-dom"],
      resolve: {
        conditions: ["react-server"],
      },
    },
    build: {
      ssr: true,
      rollupOptions: {
        input: {
          server: "src/server.js",
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
      outDir: "build/server",
    },
    esbuild: {
      loader: "jsx",
      include: /src\/.*\.js$/,
      exclude: [],
    },
  });

  // builds the client entry point
  await viteBuild({
    plugins: [transformServerActions()],
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
    css: {
      modules: {
        localsConvention: "camelCase",
      },
    },
    build: {
      minify: false,
      rollupOptions: {
        input: {
          client: "src/client.js",
          ...clientEntries,
        },
        preserveEntrySignatures: "exports-only",
        output: {
          hoistTransitiveImports: false,
          entryFileNames: (chunk) => {
            if (chunk.name === "client") {
              return "[name].js";
            }
            return "[name]";
          },
        },
      },
      outDir: "build/client",
    },
    esbuild: {
      loader: "jsx",
      include: /src\/.*\.js$/,
      exclude: [],
    },
  });
};

buildInit();
