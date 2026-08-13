import pc from "picocolors"
import winston from "winston"
import DailyRotateFile from "winston-daily-rotate-file"

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
/**
 * Render a log argument as text.
 *
 * JSON.stringify was wrong in two ways that mattered: an Error serializes to
 * "{}" (message and stack are non-enumerable), so error logs said nothing at
 * all, and a circular reference made the logger itself throw -- turning a
 * logged problem into a crash.
 */
function formatLogMessage(msg) {
    if (typeof msg === "string") return msg
    if (msg instanceof Error) return msg.stack || `${msg.name}: ${msg.message}`

    try {
        const seen = new WeakSet()
        const text = JSON.stringify(msg, (key, value) => {
            if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`
            if (typeof value === "bigint") return value.toString()
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) return "[Circular]"
                seen.add(value)
            }
            return value
        })
        // stringify returns undefined for functions and symbols.
        return text === undefined ? String(msg) : text
    } catch (error) {
        return String(msg)
    }
}

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

    // Winston serializes with format.json(), which renders an Error as {} for
    // the same reason JSON.stringify does. Pass the formatted text so the file
    // logs say what the console says.
    const Logger = {
        debug: () => {},
        error: (msg) => {
            const text = formatLogMessage(msg)
            console.log(pc.red(pc.bold("ERROR: " + text)))
            errorLogger.error(text)
        },
        info: (msg) => {
            const text = formatLogMessage(msg)
            console.log(pc.green(pc.bold("INFO: " + text)))
            infoLogger.info(text)
        },
    }

    if (enableDebugLogs && JSON.parse(enableDebugLogs)) {
        Logger.debug = (msg) => {
            const text = formatLogMessage(msg)
            console.log(pc.yellow(pc.bold("DEBUG: " + text)))
            debugLogger.debug(text)
        }
    }

    if (global) global.logger = Logger
    return Logger
}

export { configureLogger }
