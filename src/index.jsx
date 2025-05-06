import * as ReactRouter from "react-router-dom"
import * as RouterDataProvider from "./web-router/components/RouterDataProvider.jsx"
import * as MetaTag from "./web-router/components/MetaTag.jsx"
import * as Hooks from "./web-router/hooks.jsx"
import * as MetaDataUtils from "./web-router/utils/metaDataUtils.jsx"

export default {
    ...ReactRouter,
    ...RouterDataProvider,
    ...MetaTag,
    ...Hooks,
    ...MetaDataUtils,
}
