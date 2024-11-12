export const registerWebpackPolyfills = () => {
  globalThis.module_cache = new Map();

  globalThis.__webpack_require__ = (id) => {
    return globalThis.module_cache.get(id);
  };

  globalThis.__webpack_chunk_load__ = async (id) => {
    return import(id).then((module) => {
      if (module.default) {
        return globalThis.module_cache.set(id, module.default);
      }
      return globalThis.module_cache.set(id, module);
    });
  };
};

export const importRSDWClient = async () => {
  return import("react-server-dom-webpack/client");
};

export const callServer = async (rsaId, args) => {
  const { createFromFetch, encodeReply } = await importRSDWClient();
  return createFromFetch(
    fetch("/", {
      method: "POST",
      headers: { "rsa-id": rsaId },
      body: await encodeReply(args),
    }).then((response) => {
      return response;
    })
  );
};
