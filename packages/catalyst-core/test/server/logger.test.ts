import { Writable } from "node:stream"
import winston from "winston"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

// The rotating file transport, replaced by one that records its options and
// what it was given, so enabling file logging touches no disk.
const rotated = vi.hoisted(() => ({
    options: [] as Record<string, unknown>[],
    records: [] as Record<string, unknown>[],
}))
vi.mock("winston-daily-rotate-file", async () => {
    const { default: winston } = await import("winston")
    // winston re-exports winston-transport at runtime; its typings do not.
    const { Transport } = winston as unknown as {
        Transport: new (options?: object) => object
    }
    class FakeRotate extends Transport {
        constructor(options: Record<string, unknown>) {
            super(options)
            rotated.options.push(options)
        }
        log(info: Record<string, unknown>, done: () => void) {
            rotated.records.push(info)
            done()
        }
    }
    return { default: FakeRotate }
})

// What the file logs receive: every winston logger the app logger creates
// gets an extra in-memory transport, so the test reads the same serialized
// JSON lines a DailyRotateFile would write.
let written: Record<string, unknown>[]
let loggers: winston.Logger[]
let consoleLines: string[]

beforeEach(() => {
    written = []
    loggers = []
    consoleLines = []
    rotated.options.length = 0
    rotated.records.length = 0
    const createLogger = winston.createLogger
    vi.spyOn(winston, "createLogger").mockImplementation((options) => {
        const logger = createLogger(options)
        const stream = new Writable({
            write(chunk, _encoding, done) {
                written.push(JSON.parse(String(chunk)))
                done()
            },
        })
        logger.add(new winston.transports.Stream({ stream }))
        loggers.push(logger)
        return logger
    })
    vi.spyOn(console, "log").mockImplementation((line: string) => {
        consoleLines.push(String(line).replace(/\u001b\[[0-9;]*m/g, ""))
    })
})

afterEach(() => {
    vi.restoreAllMocks()
})

type AppLogger = Record<"info" | "error" | "debug", (msg: unknown) => void>

async function appLogger(config: Record<string, unknown> = {}): Promise<AppLogger> {
    vi.resetModules()
    const { configureLogger } = await import("../../src/logger.js")
    return configureLogger({ enableFileLogging: false, enableConsoleLogging: false, ...config } as never)
}

it("keeps a plain object's fields queryable in the file log", async () => {
    const logger = await appLogger()
    const payload = { message: "upstream failed", url: "/api/orders" }
    logger.error(payload)

    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toMatchObject({ message: "upstream failed", url: "/api/orders", level: "error" })
    // The caller's object is not written on.
    expect(payload).toEqual({ message: "upstream failed", url: "/api/orders" })
})

it("logs a circular object, and an Error inside it as its stack", async () => {
    const logger = await appLogger()
    const payload: Record<string, unknown> = { message: "bad", cause: new Error("root cause") }
    payload.self = payload
    logger.info(payload)

    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toMatchObject({ message: "bad", self: "[Circular]", level: "info" })
    expect(written[0].cause).toMatch(/^Error: root cause\n\s+at /)
})

it("logs strings and Errors as text", async () => {
    const logger = await appLogger()
    logger.info("plain words")
    logger.error(new Error("boom"))

    await vi.waitFor(() => expect(written).toHaveLength(2))
    expect(written[0].message).toBe("plain words")
    expect(written[1].message).toMatch(/^Error: boom\n\s+at /)
})

it("echoes each level to the terminal with its label", async () => {
    const logger = await appLogger()
    logger.info("ready")
    logger.error("failed")
    logger.debug("details")
    expect(consoleLines).toEqual(["INFO: ready", "ERROR: failed", "DEBUG: details"])

    await vi.waitFor(() => expect(written).toHaveLength(2))
    expect(written.map((record) => record.level)).toEqual(["info", "error"])
})

it("makes debug a no-op when debug logs are off", async () => {
    for (const enableDebugLogs of [false, "false"]) {
        consoleLines.length = 0
        const logger = await appLogger({ enableDebugLogs })
        logger.debug("hidden")
        expect(consoleLines).toEqual([])
    }
})

it("adds the console transport and a rotating file per level when enabled", async () => {
    const srcPath = process.env.src_path
    process.env.src_path = "/app"
    // The console transport is real but kept quiet.
    const consoleLog = vi
        .spyOn(winston.transports.Console.prototype, "log")
        .mockImplementation(((_info: unknown, done: () => void) => done()) as never)
    try {
        const logger = await appLogger({ enableFileLogging: "true", enableConsoleLogging: true })
        logger.info({ message: "booted", port: 3005 })

        expect(rotated.options.map((options) => options.filename)).toEqual([
            "/app/logs/info/%DATE%.info.log",
            "/app/logs/debug/%DATE%.debug.log",
            "/app/logs/error/%DATE%.error.log",
        ])
        expect(rotated.options.map((options) => options.level)).toEqual(["info", "debug", "error"])
        for (const created of loggers) {
            expect(
                created.transports.some((transport) => transport instanceof winston.transports.Console)
            ).toBe(true)
        }
        await vi.waitFor(() => expect(rotated.records).toHaveLength(1))
        expect(rotated.records[0]).toMatchObject({ message: "booted", port: 3005, level: "info" })
        expect(consoleLog).toHaveBeenCalled()
    } finally {
        if (srcPath === undefined) delete process.env.src_path
        else process.env.src_path = srcPath
    }
})

it("renders values JSON cannot, instead of dropping or throwing on them", async () => {
    const logger = await appLogger()
    const bare = new Error("no stack")
    bare.stack = ""
    logger.info({ count: BigInt("9007199254740993") })
    logger.info(bare)
    logger.info(function namedHandler() {})
    logger.info({
        toJSON() {
            throw new Error("cannot serialise")
        },
    })
    logger.info([1, "two"])
    logger.info(42)

    expect(consoleLines).toEqual([
        'INFO: {"count":"9007199254740993"}',
        "INFO: Error: no stack",
        expect.stringMatching(/^INFO: function namedHandler\(\) \{\s*\}$/),
        "INFO: [object Object]",
        'INFO: [1,"two"]',
        "INFO: 42",
    ])
    await vi.waitFor(() => expect(written).toHaveLength(6))
    // Only a plain object becomes a structured record; the rest stay text.
    expect(JSON.stringify(written[0])).toContain('"count":"9007199254740993"')
    expect(written[3].message).toBe("[object Object]")
    expect(written[4].message).toBe('[1,"two"]')
    expect(written[5].message).toBe("42")
})
