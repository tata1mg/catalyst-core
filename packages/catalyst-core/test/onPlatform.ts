/**
 * Makes process.platform read as `platform` until the returned function is
 * called, so both sides of a platform branch are tested on every machine.
 */
export function stubPlatform(platform: NodeJS.Platform) {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!
    Object.defineProperty(process, "platform", { ...original, value: platform })
    return () => {
        Object.defineProperty(process, "platform", original)
    }
}

/** Runs `run` with process.platform reading as `platform`. */
export function onPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
    const restore = stubPlatform(platform)
    try {
        return run()
    } finally {
        restore()
    }
}
