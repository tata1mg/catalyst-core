const fs = require("fs")
const path = require("path")
const pc = require("picocolors")
const prompts = require("prompts")
const { program } = require("commander")

const {
    createNewComponent,
    createRTKReducerFile,
    createReduxActionFile,
    createReduxReducerFile,
} = require("./template")
const {
    validateComponentName,
    validatePath,
    discardChanges,
    createDirectory,
    createReducerEntryInStore,
    createNewRoute,
    toCamelCase,
    checkIfRoutePathExist,
} = require("./utils")

// Configure commander to accept CLI options
program
    .option("-p, --path <path>", "Path for the new route")
    .option("-c, --component <component>", "Component name for the new route")
    .parse(process.argv)

async function main() {
    let { routePath, templateType, componentName } = program

    // If all options are not provided, prompt the user for input
    if (!routePath || !componentName || !templateType) {
        const response = await prompts([
            {
                type: "select",
                name: "templateType",
                message: "Choose state management template being used:",
                choices: [
                    { title: "Redux", value: "redux" },
                    { title: "Redux Toolkit (RTK)", value: "rtk" },
                    { title: "None", value: "none" },
                ],
            },
            {
                type: routePath ? null : "text",
                name: "routePath",
                message: "Enter the route path",
                validate: validatePath,
            },
            {
                type: componentName ? null : "text",
                name: "componentName",
                message: "Enter the component name for new route",
                validate: validateComponentName,
            },
        ])

        routePath = routePath || response.routePath
        templateType = templateType || response.templateType
        componentName = componentName || response.componentName
    }

    // Code transformations
    if (componentName && routePath && templateType) {
        const reducerName = toCamelCase(componentName)
        const containersDir = "src/js/containers"
        const routeTransformerPath = path.join(__dirname, "./", "transformers/createRoute.js")
        const reducerTransformerPath = path.join(__dirname, "./", "transformers/createReducer.js")

        const funcArgs = {
            containersDir,
            componentName,
            routePath,
            reducerName,
            templateType,
            reducerTransformerPath,
            routeTransformerPath,
        }

        // create directory
        if (createDirectory(funcArgs)) {
            try {
                checkIfRoutePathExist(funcArgs)

                if (templateType === "none") {
                    createNewComponent(funcArgs)
                }

                if (templateType === "redux") {
                    createNewComponent(funcArgs)
                    createReduxActionFile(funcArgs)
                    createReduxReducerFile(funcArgs)
                    createReducerEntryInStore(funcArgs)
                }

                if (templateType === "rtk") {
                    createNewComponent(funcArgs)
                    createRTKReducerFile(funcArgs)
                    createReducerEntryInStore(funcArgs)
                }

                createNewRoute(funcArgs)
            } catch (e) {
                discardChanges(funcArgs)
                console.log(pc.red(`\n${e}`))
            }
        }
    }
}

main()
