// react-router-dom (v6), not react-router (v7) — see the note in
// server/renderer/handler.jsx. @tata1mg/router, the router library apps like useai
// actually use, is still built against v6; re-exporting v7's hooks/components here would
// give app code (e.g. router/ServerRouter.js's useRoutes()) a different, incompatible
// Context instance than the one @tata1mg/router's <StaticRouter>/<Router> populates.
export * from "react-router-dom"
export * from "./web-router/components/RouterDataProvider.jsx"
export * from "./web-router/components/MetaTag.jsx"
export { split, hydrationReady } from "./web-router/components/Split.jsx"
export { split as default } from "./web-router/components/Split.jsx"
export * from "./web-router/hooks.jsx"
export * from "./web-router/utils/metaDataUtils.jsx"
export * from "./server/renderer/document/index.jsx"
