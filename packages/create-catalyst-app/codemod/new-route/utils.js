const fs = require("fs")
const path = require("path")
const pc = require("picocolors")
const { execSync } = require("child_process")

// validates router path
function validatePath(path) {
    const pathPattern = /^\/[a-zA-Z0-9-_]+(?:\/:[a-zA-Z0-9-_]+)?(?:\?[a-zA-Z0-9-_=]*)?$/

    if (!path.startsWith("/")) {
        return "The path must start with a forward slash (`/`)."
    }
    if (!pathPattern.test(path)) {
        if (!/^[\/a-zA-Z0-9-_]+/.test(path)) {
            s
            return "Only letters, digits, hyphens, and underscores are allowed after the initial slash."
        }
        if (/\/[^:][a-zA-Z0-9-_]+/.test(path)) {
            return "Parameters must start with a slash and a colon, followed by valid characters."
        }
        if (/\?[^a-zA-Z0-9-_=]*$/.test(path)) {
            return "Query strings must start with a question mark and contain valid characters."
        }
        return "The path is incorrectly formatted."
    }
    return true
}

// validates component name
function validateComponentName(name) {
    return (
        /^[A-Z][a-zA-Z0-9]*$/.test(name) ||
        "Component name should start with an uppercase letter and may contain alphanumeric characters"
    )
}

// discard changes if anything breaks
function discardChanges({ componentName, containersDir }) {
    if (fs.existsSync(`${containersDir}/${componentName}`)) {
        fs.rmSync(`${containersDir}/${componentName}`, { recursive: true, force: true })
    }
}

// creates directory using given input
function createDirectory({ componentName, containersDir }) {
    try {
        // directory check
        if (fs.existsSync(`${containersDir}/${componentName}`)) {
            throw new Error("directory with similar name already exist")
        }

        fs.mkdirSync(`${containersDir}/${componentName}`)
        console.log(`\n${pc.cyan(componentName)} directory created at ${pc.gray(containersDir)}`)

        return true
    } catch (e) {
        console.log(pc.red(`\nError: ${e}`))
    }
}

// adds route object inside src/js/route/index.js file
function createNewRoute({ componentName, routePath, routeTransformerPath }) {
    const command = `jscodeshift --silent -t ${routeTransformerPath} --routePath ${routePath} --componentName ${componentName} src/js/routes/index.js`
    execSync(command, { stdio: "inherit" })
}

// adds newly created reducer into src/js/store/index.js file
function createReducerEntryInStore({ componentName, routePath, reducerTransformerPath, reducerName }) {
    const command = `jscodeshift --silent -t ${reducerTransformerPath} --reducerName ${reducerName} --routePath ${routePath} --componentName ${componentName} src/js/store/index.js`
    execSync(command, { stdio: "inherit" })
}

// converts string to camel case
function toCamelCase(str) {
    return str.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (match, chr) => chr.toUpperCase())
}

function checkIfRoutePathExist({ routePath, componentName }) {
    const routeIndexPath = "src/js/routes/index.js"
    const data = fs.readFileSync(routeIndexPath, "utf8")
    // Check if the file content includes routePath
    if (data.includes(routePath)) {
        throw new Error(`${routePath} path already exist in src/js/routes/index.js`)
    }

    if (data.includes(`@containers/${componentName}/${componentName}`)) {
        throw new Error(`${componentName} component path already exist in src/js/routes/index.js`)
    }
}

module.exports = {
    validatePath,
    validateComponentName,
    discardChanges,
    createReducerEntryInStore,
    createNewRoute,
    createDirectory,
    toCamelCase,
    checkIfRoutePathExist,
}
