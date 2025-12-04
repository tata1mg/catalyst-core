export * from "react-router-dom"
export * from "./web-router/components/RouterDataProvider.jsx"
export * from "./web-router/components/MetaTag.jsx"
export { split } from "./web-router/components/Split.jsx"
export { ChunkExtractor, PPR_ASSET_PHASE } from "./server/renderer/ChunkExtractor.js"
export * from "./web-router/hooks.jsx"
export * from "./web-router/utils/metaDataUtils.jsx"
export * from "./server/renderer/document/index.jsx"

// PPR (Partial Pre-rendering) utilities
export { PPRConfig, serializePostponedState, generatePostponedStateScript } from "./server/renderer/render.js"
export {
    PPR_ASSET_TYPE,
    splitAssetsForPPR,
    generateStaticShellAssets,
    generateDynamicAssets,
} from "./server/renderer/extract.js"
export {
    PPRDataProvider,
    PPRDataContext,
    usePPRRouteData,
    usePPRDataPromises,
    useUnifiedRouteData,
    createPPRDataPromises,
    clearPPRCache,
} from "./web-router/components/PPRDataProvider.jsx"
