// Module hook for handler tests: the app template the handler imports is a small fixture app.
const FIXTURES = new URL("../fixtures/template/", import.meta.url)
const TEMPLATE = {
    "@catalyst/template/server/document": "document.mjs",
    "@catalyst/template/server/index.js": "hooks.mjs",
    "@catalyst/template/src/js/containers/App/index": "App.mjs",
    "@catalyst/template/src/js/routes/utils": "routes.mjs",
    "@catalyst/template/src/js/store/index.js": "store.mjs",
}

export async function resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(TEMPLATE, specifier)) {
        return { url: new URL(TEMPLATE[specifier], FIXTURES).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
}
