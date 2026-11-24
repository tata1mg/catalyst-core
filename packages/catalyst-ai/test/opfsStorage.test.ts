// createOpfsStorage against an in-memory fake of the origin-private file system (sync access handles, as in a worker).
import { afterEach, describe, expect, it, vi } from "vitest"
import { createOpfsStorage } from "../src/resumableFetch.js"

function fakeOpfs({ syncHandles = true } = {}) {
    const files = new Map<string, Uint8Array>()
    const closed: string[] = []
    const dir = {
        async getFileHandle(name: string, { create }: { create?: boolean } = {}) {
            if (!files.has(name)) {
                if (!create) throw Object.assign(new Error("missing"), { name: "NotFoundError" })
                files.set(name, new Uint8Array(0))
            }
            return {
                ...(syncHandles && {
                    async createSyncAccessHandle() {
                        return {
                            getSize: () => files.get(name)!.length,
                            read(buf: Uint8Array, { at }: { at: number }) {
                                const src = files.get(name)!.subarray(at, at + buf.length)
                                buf.set(src)
                                return src.length
                            },
                            write(bytes: Uint8Array, { at }: { at: number }) {
                                const cur = files.get(name)!
                                const next = new Uint8Array(Math.max(cur.length, at + bytes.length))
                                next.set(cur)
                                next.set(bytes, at)
                                files.set(name, next)
                            },
                            truncate(n: number) { files.set(name, files.get(name)!.slice(0, n)) },
                            flush: vi.fn(),
                            close() { closed.push(name) },
                        }
                    },
                }),
            }
        },
        async removeEntry(name: string) {
            if (!files.delete(name)) throw Object.assign(new Error("missing"), { name: "NotFoundError" })
        },
    }
    const root = { getDirectoryHandle: async () => dir }
    return { files, closed, storage: { getDirectory: async () => root } }
}

afterEach(() => vi.unstubAllGlobals())

describe("createOpfsStorage availability", () => {
    it("is null without navigator.storage, without getDirectory, or when the directory cannot be opened", async () => {
        vi.stubGlobal("navigator", undefined)
        expect(await createOpfsStorage()).toBeNull()
        vi.stubGlobal("navigator", {})
        expect(await createOpfsStorage()).toBeNull()
        vi.stubGlobal("navigator", { storage: {} })
        expect(await createOpfsStorage()).toBeNull()
        vi.stubGlobal("navigator", { storage: { getDirectory: async () => { throw new Error("denied") } } })
        expect(await createOpfsStorage()).toBeNull()
    })

    it("is null where sync access handles do not exist (main thread)", async () => {
        vi.stubGlobal("navigator", { storage: fakeOpfs({ syncHandles: false }).storage })
        expect(await createOpfsStorage()).toBeNull()
    })
})

describe("createOpfsStorage files", () => {
    async function open() {
        const fake = fakeOpfs()
        vi.stubGlobal("navigator", { storage: fake.storage })
        const s = (await createOpfsStorage())!
        return { ...fake, s }
    }

    it("reports no meta and size 0 for a key that was never written", async () => {
        const { s } = await open()
        expect(await s.getMeta("k")).toBeNull()
        expect(await s.size("k")).toBe(0)
    })

    it("appends chunks, reports the size and reads ranges back", async () => {
        const { s } = await open()
        await s.append("k", new Uint8Array([1, 2, 3]))
        await s.append("k", new Uint8Array([4, 5]))
        expect(await s.size("k")).toBe(5)
        expect(Array.from(await s.read("k", 1, 3))).toEqual([2, 3, 4])
        expect(Array.from(await s.read("k", 3, 10))).toEqual([4, 5]) // short read is trimmed
    })

    it("round-trips meta, overwriting a longer previous value, and ignores corrupt meta", async () => {
        const { s, files } = await open()
        await s.setMeta("k", { etag: "a-very-long-etag-value", total: 10 })
        await s.setMeta("k", { etag: "b", total: 1 })
        expect(await s.getMeta("k")).toEqual({ etag: "b", total: 1 })
        files.set("k.json", new TextEncoder().encode("{not json"))
        // open handles cache the old file object, so reopen through a fresh storage
        vi.stubGlobal("navigator", { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => ({ getFileHandle: async (n: string) => ({ createSyncAccessHandle: async () => ({ getSize: () => files.get(n)!.length, read: (b: Uint8Array) => { b.set(files.get(n)!); return files.get(n)!.length }, write() {}, truncate() {}, flush() {}, close() {} }) }) }) }) } })
        const again = (await createOpfsStorage())!
        expect(await again.getMeta("k")).toBeNull()
    })

    it("flushes after enough unflushed bytes", async () => {
        const { s } = await open()
        await s.append("k", new Uint8Array(8 * 1024 * 1024))
        await s.append("k", new Uint8Array(4)) // goes through the counter reset path
        expect(await s.size("k")).toBe(8 * 1024 * 1024 + 4)
    })

    it("remove() closes handles, deletes both files and tolerates files that are already gone", async () => {
        const { s, files, closed } = await open()
        await s.append("k", new Uint8Array([1]))
        await s.setMeta("k", { a: 1 })
        await s.remove("k")
        expect(files.has("k.part")).toBe(false)
        expect(files.has("k.json")).toBe(false)
        expect(closed).toEqual(expect.arrayContaining(["k.part", "k.json"]))
        await expect(s.remove("k")).resolves.toBeUndefined() // NotFoundError is swallowed
    })

    it("rethrows a real removal failure", async () => {
        const fake = fakeOpfs()
        const root = await fake.storage.getDirectory()
        const dir: any = await root.getDirectoryHandle()
        dir.removeEntry = async () => { throw Object.assign(new Error("locked"), { name: "NoModificationAllowedError" }) }
        vi.stubGlobal("navigator", { storage: fake.storage })
        const s = (await createOpfsStorage())!
        await expect(s.remove("k")).rejects.toThrow("locked")
    })

    it("rethrows non-NotFound errors when opening a file", async () => {
        const fake = fakeOpfs()
        const root = await fake.storage.getDirectory()
        const dir: any = await root.getDirectoryHandle()
        const real = dir.getFileHandle.bind(dir)
        dir.getFileHandle = async (name: string, o: any) => {
            if (name === "boom.part") throw Object.assign(new Error("io"), { name: "InvalidStateError" })
            return real(name, o)
        }
        vi.stubGlobal("navigator", { storage: fake.storage })
        const s = (await createOpfsStorage())!
        await expect(s.size("boom")).rejects.toThrow("io")
    })
})
