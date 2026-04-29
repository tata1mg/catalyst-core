const pc = require("picocolors")

module.exports = function (fileInfo, api, options) {
    const jscodeshift = api.jscodeshift
    const root = jscodeshift(fileInfo.source)

    const { componentName, reducerName } = options

    // Insert the node at the top of the file
    root.find(jscodeshift.Program)
        .get("body", 0)
        .insertBefore(`import { ${reducerName}Reducer } from '@containers/${componentName}/reducer.js'`)

    root.find(jscodeshift.CallExpression, {
        callee: {
            name: "combineReducers",
        },
    }).forEach((path) => {
        const args = path.value.arguments
        if (args.length > 0 && args[0].type === "ObjectExpression") {
            args[0].properties.push(
                jscodeshift.property(
                    "init",
                    jscodeshift.identifier(`${reducerName}Reducer`),
                    jscodeshift.identifier(`${reducerName}Reducer`)
                )
            )
            args[0].properties.forEach((property) => {
                if (property.key.name === property.value.name) {
                    property.shorthand = true
                }
            })
        }
    })

    console.log(`\nReducer added in ${pc.gray("src/js/store/index.js")}`)
    return root.toSource()
}
