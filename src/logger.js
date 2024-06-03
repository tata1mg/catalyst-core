const winston = require("winston")
const DailyRotateFile = require("winston-daily-rotate-file")
const pc = require("picocolors")
const { createLogger, format, transports } = winston

/**
 * @description Logger library with rotational strategy. Creates a logs folder in root.
 *              With debug, error and info log directories with their respective log files.
 *
 * @format Logstash with timestamp
 * @param config { @enableDebugLogs: Bool // default: true }
 * @returns loggerInstance
 *
 */
const configureLogger = (config = {}) => {
    const { enableDebugLogs = true, enableFileLogging = true, enableConsoleLogging = true } = config

    const consoleTransport = new transports.Console({ level: "debug" })

    const fileTransport = (type = "info") => {
        return new DailyRotateFile({
            filename: `${process.env.src_path}/logs/${type}/%DATE%.${type}.log`,
            datePattern: "YYYY-MM-DD",
            maxFiles: "3d", // Logs will be removed after 2days,
            loglevel: type,
            level: type,
        })
    }

    const infoLogger = createLogger({
        format: format.combine(format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), format.json()),
        defaultMeta: { loglevel: "info" },
    })

    const debugLogger = createLogger({
        format: format.combine(format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), format.json()),
        defaultMeta: { loglevel: "debug" },
    })

    const errorLogger = createLogger({
        format: format.combine(format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), format.json()),
        defaultMeta: { loglevel: "error" },
    })

    if (enableConsoleLogging && JSON.parse(enableConsoleLogging)) {
        infoLogger.add(consoleTransport)
        debugLogger.add(consoleTransport)
        errorLogger.add(consoleTransport)
    }

    if (enableFileLogging && JSON.parse(enableFileLogging)) {
        infoLogger.add(fileTransport("info"))
        debugLogger.add(fileTransport("debug"))
        errorLogger.add(fileTransport("error"))
    }

    const Logger = {
        debug: () => {},
        error: (msg) => {
            console.log(pc.red(pc.bold("ERROR: " + JSON.stringify(msg))))
            errorLogger.error(msg)
        },
        info: (msg) => {
            console.log(pc.green(pc.bold("INFO: " + JSON.stringify(msg))))
            infoLogger.info(msg)
        },
    }

    if (enableDebugLogs && JSON.parse(enableDebugLogs)) {
        Logger.debug = (msg) => {
            console.log(pc.yellow(pc.bold("DEBUG: " + JSON.stringify(msg))))
            debugLogger.debug(msg)
        }
    }

    if (global) global.logger = Logger
    return Logger
}

module.exports = { configureLogger }
