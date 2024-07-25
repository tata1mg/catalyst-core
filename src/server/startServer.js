import fs from "fs"
import path from "path"
import util from "node:util"
import chokidar from "chokidar"
import { cyan, yellow, green } from "picocolors"

import { preServerInit } from "@catalyst/template/server/index.js"
import { validatePreInitServer } from "@catalyst/server/utils/validator.js"

const env = process.env.NODE_ENV || "development"

// function defined by user which needs to run before server starts
if (validatePreInitServer(preServerInit)) preServerInit()

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

if (env === "development") {
    // Add better stack tracing for promises in dev mode
    process.on("unhandledRejection", (r) => console.debug(r))
}

const port = process.env.NODE_SERVER_PORT ?? 3005
const host = process.env.NODE_SERVER_HOSTNAME ?? "localhost"

let statsPath = path.join(__dirname, "../../", "chunk-groups.json")

if (env === "production") {
    statsPath = path.join(process.env.src_path, `${process.env.BUILD_OUTPUT_PATH}/public/chunk-groups.json`)
}

const watcher = chokidar.watch(statsPath, { persistent: true })

let serverInstance = null
const restartServer = () => {
    const server = require("./expressServer.js").default

    serverInstance = server.listen({ port, host })
}

const startServer = () => {
    const server = require("./expressServer.js").default

    serverInstance = server.listen({ port, host }, (error) => {
        const { APPLICATION, NODE_SERVER_HOSTNAME, NODE_SERVER_PORT } = process.env

        if (error) console.log("An error occured while starting the Application server : ", error)

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
        console.log(yellow("\n https://catalyst.1mg.com/public_docs/content/deployment\n"))
    })
}

if (fs.existsSync(statsPath)) {
    // if chunk-groups.json exist this block will start the server in development environment. This happens in dev environment when chunk stats already exists and developer is  making changes to the files. chunk-groups.json will be updated after every change.
    watcher.on("change", () => {
        watcher.close()
        if (serverInstance) {
            serverInstance.close(() => startServer())
        } else {
            startServer()
        }
    })
    // this block will start the server when your files have been compiled for production and chunk-groups.json exists.
    watcher.on("add", () => {
        if (env === "production") {
            watcher.close()
            startServer()
        }
    })
} else {
    // this block will start the server in development environment for the first time when chunk-groups.json does not exists.
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
