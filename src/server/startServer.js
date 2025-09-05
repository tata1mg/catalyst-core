import fs from "fs"
import path from "path"
import util from "node:util"
import chokidar from "chokidar"
import { cyan, yellow, green } from "picocolors"

import { preServerInit, onServerError } from "@catalyst/template/server/index.js"
import { safeCall } from "@catalyst/server/utils/validator.js"

const env = process.env.NODE_ENV || "development"

// function defined by user which needs to run before server starts
safeCall(preServerInit)

process.on("uncaughtException", (err, origin) => {
    console.log(process.stderr.fd)
    console.log(`Caught exception: ${err}\n` + `Exception origin: ${origin}`)
})

process.on("SIGINT", function (data) {
    console.log("SIGINT")
    console.log(data)
    process.exit(0)
})

process.on("uncaughtExceptionMonitor", (err, origin) => {
    console.log(err, origin)
})

process.on("message", function (msg) {
    if (msg == "shutdown") {
        console.log("Closing all connections...")
        setTimeout(function () {
            console.log("Finished closing connections")
            process.exit(0)
        }, 1500)
    }
})

// if (env === "development") {
// Add better stack tracing for promises in dev mode
process.on("unhandledRejection", (err) => console.log("unhandledRejection in Catalyst", err))
// }

const port = process.env.NODE_SERVER_PORT ?? 3005
const host = process.env.NODE_SERVER_HOSTNAME ?? "localhost"

let statsPath = path.join(
    __dirname,
    `../../`,
    ".catalyst-dev",
    "/server",
    "/renderer",
    "handler.development.js"
)

if (env === "production") {
    statsPath = path.join(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public/loadable-stats.json`)
}

const watcher = chokidar.watch(statsPath, { persistent: true })

let serverInstance = null
const restartServer = () => {
    const server = require("./expressServer.js").default
    const { APPLICATION, NODE_SERVER_HOSTNAME, NODE_SERVER_PORT } = process.env

    serverInstance = server.listen({ port, host })

    console.log("Server Restarted!")
    console.log(`You can now view ${APPLICATION} in the browser.`)
    console.log(util.format("Local:", cyan(`http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}`)))
}

const startServer = () => {
    const server = require("./expressServer.js").default

    serverInstance = server.listen({ port, host }, (error) => {
        const { APPLICATION, NODE_SERVER_HOSTNAME, NODE_SERVER_PORT } = process.env

        if (error) {
            console.log("An error occured while starting the Application server : ", error)
            // function defined by user which needs to run if server fails
            safeCall(onServerError)
            return
        }

        if (env === "development") console.log(green("Compiled successfully!"))

        console.log(`\nYou can now view ${APPLICATION} in the browser.\n`)
        console.log(
            util.format("\tLocal:".padEnd(8), cyan(`http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}`))
        )

        if (env === "development") {
            console.log("\nNote that the development build is not optimized.")
            console.log("To create a production build, use " + cyan("npm run build"))
        }

        console.log("\nFind out more about deployment here:")
        console.log(
            yellow(
                "\n https://catalyst.1mg.com/public_docs/content/Deployment%20and%20Production/deployment\n"
            )
        )
    })
}

if (fs.existsSync(statsPath)) {
    // if loadable-stats.json exist this block will start the server in development environment. This happens in dev environment when loadable stats already exists and developer is  making changes to the files. lodable-stats.json will be updated after every change.
    watcher.on("change", () => {
        watcher.close()
        if (serverInstance) {
            serverInstance.close(() => startServer())
        } else {
            startServer()
        }
    })
    // this block will start the server when your files have been compiled for production and lodable-stats.json exists.
    watcher.on("add", () => {
        if (env === "production") {
            watcher.close()
            startServer()
        }
    })
} else {
    // this block will start the server in development environment for the first time when loadable-stats.json does not exists.
    watcher.on("add", () => {
        watcher.close()
        if (serverInstance) {
            serverInstance.close(() => startServer())
        } else {
            startServer()
        }
    })
}
if (fs.existsSync(statsPath)) {
    if (env === "development") {
        restartServer()
    }
}
