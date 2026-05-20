const pc = require("picocolors")

module.exports = function (fileInfo, api, options) {
    const jscodeshift = api.jscodeshift
    const root = jscodeshift(fileInfo.source)

    const { routePath, componentName } = options

    // Create a new route object using a template expression
    const newObject = jscodeshift.template.expression`
    {
        path: ${JSON.stringify(routePath)},
        end: true,
        component: ${componentName}
    }
    `

    // Insert the node at the top of the file
    root.find(jscodeshift.Program)
        .get("body", 0)
        .insertBefore(`import ${componentName} from '@containers/${componentName}/${componentName}'`)

    root.find(jscodeshift.VariableDeclarator, { id: { name: "routes" } }).forEach((path) => {
        // Ensure we are modifying the top-level array expression
        if (path.value.init.type === "ArrayExpression") {
            path.value.init.elements.push(newObject)
        }
    })

    console.log(pc.green("\nNew route added successfully."))
    return root.toSource()
}
