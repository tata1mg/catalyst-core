declare module "*.scss" {
    const classes: { [key: string]: string }
    export default classes
}

// Injected by webpack DefinePlugin in base.babel.js at build time.
// Reflects which @catalyst/* packages are present in node_modules.
declare const __CATALYST_PACKAGES__: {
    readonly cloudAI: boolean
    readonly webAILocal: boolean
    readonly nativeAILocal: boolean
}
