import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import {
    devServerPorts,
    ensureDevServer,
    getDeviceReachableHost,
    getLocalIPAddress,
    isServerAnswering,
    migrateLanAddresses,
    planLanAddressMigration,
    readHmrPort,
} from "../../src/native/setupServer.js"
import { readLocalState, writeLocalState } from "../../src/native/localState.js"

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-setup-server-"))
    temps.push(dir)
    return dir
}
afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const v4 = (address: string, internal = false) => ({ family: "IPv4", address, internal })

describe("getLocalIPAddress", () => {
    it("prefers en0 and Wi-Fi/Ethernet over tunnels and bridges", () => {
        expect(getLocalIPAddress({ utun3: [v4("100.64.0.2")], en0: [v4("192.168.1.9")] } as any)).toBe(
            "192.168.1.9"
        )
        expect(getLocalIPAddress({ docker0: [v4("172.17.0.1")], wlp2s0: [v4("10.0.0.7")] } as any)).toBe(
            "10.0.0.7"
        )
    })

    it("is null with only loopback", () => {
        expect(getLocalIPAddress({ lo: [v4("127.0.0.1", true)] } as any)).toBeNull()
    })
})

describe("getDeviceReachableHost", () => {
    it("uses the Bonjour name first", () => {
        expect(
            getDeviceReachableHost({ localHostName: () => "Janes-MacBook-Pro\n", interfaces: {} as any })
        ).toEqual({
            host: "Janes-MacBook-Pro.local",
            source: "bonjour",
        })
    })

    it("falls back to the LAN IP, then null", () => {
        const fails = () => {
            throw new Error("no scutil")
        }
        expect(
            getDeviceReachableHost({ localHostName: fails, interfaces: { en0: [v4("192.168.1.9")] } as any })
        ).toEqual({
            host: "192.168.1.9",
            source: "lan",
        })
        expect(getDeviceReachableHost({ localHostName: () => "", interfaces: {} as any })).toBeNull()
    })
})

describe("devServerPorts", () => {
    it("lists the server port, the HMR port and every localhost port in config", () => {
        const config = {
            NODE_SERVER_PORT: 3005,
            API_URL: "http://localhost:8080/api",
            PUBLIC_STATIC_ASSET_URL: "http://localhost:3005",
            WEBVIEW_CONFIG: { apiBaseUrl: "http://127.0.0.1:9000" },
            OTHER: ["https://example.com:8443"],
        }
        expect(devServerPorts(config)).toEqual([3005, 8080, 9000, 24678])
        expect(devServerPorts({}, { hmrPort: 5000 })).toEqual([3005, 5000])
    })

    it("reads the HMR port from buildConfig.js", async () => {
        const cwd = tempDir()
        expect(await readHmrPort({ cwd })).toBe(24678)
        fs.writeFileSync(
            path.join(cwd, "buildConfig.js"),
            "module.exports = { devServer: { hmr: { port: 24999 } } }\n"
        )
        expect(await readHmrPort({ cwd })).toBe(24999)
    })
})

describe("ensureDevServer", () => {
    const config = { NODE_SERVER_PORT: 3005 }

    it("does nothing when the server answers", async () => {
        let started = false
        const result = await ensureDevServer({
            config,
            probe: async () => true,
            start: (() => {
                started = true
            }) as any,
        })
        expect(result).toEqual({ started: false, url: "http://localhost:3005", port: 3005 })
        expect(started).toBe(false)
    })

    it("starts catalyst start and waits until it answers", async () => {
        let calls = 0
        let startedWith: any
        const result = await ensureDevServer({
            config,
            intervalMs: 1,
            probe: async () => ++calls > 3,
            start: ((options: any) => {
                startedWith = options
                return { child: null, logFile: "/tmp/x.log" }
            }) as any,
        })
        expect(result).toMatchObject({ started: true, url: "http://localhost:3005", logFile: "/tmp/x.log" })
        expect(startedWith.overrides).toEqual({})
    })

    it("binds all interfaces and serves assets on a device host", async () => {
        let startedWith: any
        let probes = 0
        await ensureDevServer({
            host: "jane-mac.local",
            config,
            intervalMs: 1,
            probe: async ({ host }: any) => host === "jane-mac.local" && ++probes > 1,
            start: ((options: any) => {
                startedWith = options
                return { child: null, logFile: "/tmp/x.log" }
            }) as any,
        })
        expect(startedWith.overrides).toEqual({
            NODE_SERVER_HOSTNAME: "0.0.0.0",
            PUBLIC_STATIC_ASSET_URL: "http://jane-mac.local:3005",
            // Vite 6 answers 403 to a .local Host header unless it is allowed.
            CATALYST_DEV_ALLOWED_HOSTS: "jane-mac.local",
        })
    })

    it("does not add an allowed host for a LAN IP (Vite accepts IPs)", async () => {
        let startedWith: any
        let probes = 0
        await ensureDevServer({
            host: "192.168.1.20",
            config,
            intervalMs: 1,
            probe: async ({ host }: any) => host === "192.168.1.20" && ++probes > 1,
            start: ((options: any) => {
                startedWith = options
                return { child: null, logFile: "/tmp/x.log" }
            }) as any,
        })
        expect(startedWith.overrides).toEqual({
            NODE_SERVER_HOSTNAME: "0.0.0.0",
            PUBLIC_STATIC_ASSET_URL: "http://192.168.1.20:3005",
        })
    })

    it("refuses a server that only answers on localhost when a device needs it (NATIVE-006)", async () => {
        const error = await ensureDevServer({
            host: "jane-mac.local",
            config,
            probe: async ({ host }: any) => host === "localhost",
            start: (() => {
                throw new Error("must not start")
            }) as any,
        }).catch((e) => e)
        expect(error.code).toBe("NATIVE-006")
    })

    it("records the host a started server is for", async () => {
        const cwd = tempDir()
        let probes = 0
        await ensureDevServer({
            host: "jane-mac.local",
            cwd,
            config,
            intervalMs: 1,
            probe: async ({ host }: any) => host === "jane-mac.local" && ++probes > 1,
            start: (() => ({ child: { pid: 4242, on: () => {} }, logFile: "/tmp/x.log" })) as any,
        })
        expect(readLocalState({ cwd }).devServer).toEqual({ host: "jane-mac.local", port: 3005, pid: 4242 })
    })

    it("refuses to reuse a server it started for another target (NATIVE-006)", async () => {
        const cwd = tempDir()
        writeLocalState({ devServer: { host: "jane-mac.local", port: 3005, pid: 4242 } }, { cwd })
        const run = (host: string, alive: boolean) =>
            ensureDevServer({
                host,
                cwd,
                config,
                probe: async () => true,
                isAlive: () => alive,
                start: (() => {
                    throw new Error("must not start")
                }) as any,
            })

        // The simulator after an iPhone build: the running server serves
        // assets on jane-mac.local, not localhost.
        const error = await run("localhost", true).catch((e) => e)
        expect(error.code).toBe("NATIVE-006")
        expect(error.message).toContain("started for jane-mac.local")
        expect(error.hint).toContain("kill 4242")

        // The same target reuses it, and a recorded process that is gone is ignored.
        expect(await run("jane-mac.local", true)).toMatchObject({ started: false })
        expect(await run("localhost", false)).toMatchObject({ started: false })
    })

    it("reuses a server the user started on localhost for a localhost target", async () => {
        const cwd = tempDir()
        const result = await ensureDevServer({
            cwd,
            config,
            probe: async () => true,
            isAlive: () => true,
            start: (() => {
                throw new Error("must not start")
            }) as any,
        })
        expect(result).toEqual({ started: false, url: "http://localhost:3005", port: 3005 })
    })

    it("times out with NATIVE-006", async () => {
        const error = await ensureDevServer({
            config,
            timeoutMs: 20,
            intervalMs: 5,
            probe: async () => false,
            start: (() => ({ child: null, logFile: "/tmp/x.log" })) as any,
        }).catch((e) => e)
        expect(error.code).toBe("NATIVE-006")
        expect(error.message).toContain("/tmp/x.log")
    })

    it("probes a real HTTP server", async () => {
        const server = http.createServer((_req, res) => {
            res.statusCode = 500
            res.end()
        })
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
        const { port } = server.address() as any
        try {
            expect(await isServerAnswering({ host: "127.0.0.1", port })).toBe(true)
        } finally {
            await new Promise((resolve) => server.close(resolve))
        }
        expect(await isServerAnswering({ host: "127.0.0.1", port, timeoutMs: 200 })).toBe(false)
    })
})

describe("LAN address migration", () => {
    // This machine is 192.168.1.20; LOCAL_IP still holds the address an
    // earlier setup wrote before DHCP moved the machine.
    const HERE = new Set(["127.0.0.1", "::1", "192.168.1.20", "jane-mac"])
    const saved = {
        NODE_SERVER_HOSTNAME: "192.168.1.20",
        NODE_SERVER_PORT: 3005,
        PUBLIC_STATIC_ASSET_URL: "http://192.168.1.20:3005",
        API_URL: "https://api.acme.com",
        CDN: "http://8.8.8.8/x",
        OLD_API: "http://10.0.0.4:8080/api",
        DB_HOST: "172.18.0.5",
        BIND: "0.0.0.0",
        LOOPBACK: "http://127.0.0.1:9000",
        WEBVIEW_CONFIG: {
            LOCAL_IP: "10.0.0.4",
            port: "3005",
            accessControl: { allowedUrls: ["http://192.168.1.20:3005/*", "https://acme.com/*"] },
        },
    }

    it("puts localhost back for this machine's addresses and the saved LOCAL_IP only", () => {
        const { config, changes } = planLanAddressMigration(saved, { localHosts: HERE })
        expect(config).toMatchObject({
            NODE_SERVER_HOSTNAME: "localhost",
            PUBLIC_STATIC_ASSET_URL: "http://localhost:3005",
            API_URL: "https://api.acme.com",
            CDN: "http://8.8.8.8/x",
            OLD_API: "http://localhost:8080/api",
            WEBVIEW_CONFIG: {
                LOCAL_IP: "localhost",
                accessControl: { allowedUrls: ["http://localhost:3005/*", "https://acme.com/*"] },
            },
        })
        expect(changes.map((change) => change.path)).toEqual([
            "NODE_SERVER_HOSTNAME",
            "PUBLIC_STATIC_ASSET_URL",
            "OLD_API",
            "WEBVIEW_CONFIG.LOCAL_IP",
            "WEBVIEW_CONFIG.accessControl.allowedUrls[0]",
        ])
        expect(saved.NODE_SERVER_HOSTNAME).toBe("192.168.1.20")
    })

    it("leaves a Docker bind address, a container IP and loopback alone", () => {
        const docker = {
            NODE_SERVER_HOSTNAME: "0.0.0.0",
            DB_HOST: "172.18.0.5",
            REDIS_URL: "http://172.18.0.6:6379",
            LOOPBACK: "http://127.0.0.1:9000",
            WEBVIEW_CONFIG: { LOCAL_IP: "localhost" },
        }
        expect(planLanAddressMigration(docker, { localHosts: HERE }).changes).toEqual([])
        // Even when 0.0.0.0 or a loopback address is reported as this machine's.
        const odd = new Set(["0.0.0.0", "127.0.0.1"])
        expect(planLanAddressMigration(docker, { localHosts: odd }).changes).toEqual([])
        // And a LOCAL_IP of 0.0.0.0 or 127.x is not a saved LAN address.
        const bound = { BIND: "0.0.0.0", WEBVIEW_CONFIG: { LOCAL_IP: "0.0.0.0" } }
        expect(planLanAddressMigration(bound, { localHosts: new Set() }).changes).toEqual([])
    })

    it("leaves WEBVIEW_CONFIG.url alone, and everything when allowPrivateHost is set", () => {
        const withUrl = { WEBVIEW_CONFIG: { url: "http://10.0.0.4:3005", LOCAL_IP: "10.0.0.4" } }
        expect(
            planLanAddressMigration(withUrl, { localHosts: new Set() }).changes.map((c: any) => c.path)
        ).toEqual(["WEBVIEW_CONFIG.LOCAL_IP"])
        const internal = { ...saved, WEBVIEW_CONFIG: { ...saved.WEBVIEW_CONFIG, allowPrivateHost: true } }
        expect(planLanAddressMigration(internal, { localHosts: HERE }).changes).toEqual([])
    })

    function appWith(config: object) {
        const cwd = tempDir()
        const file = path.join(cwd, "config", "config.json")
        fs.mkdirSync(path.dirname(file))
        fs.writeFileSync(file, JSON.stringify(config, null, 4) + "\n")
        return { cwd, file }
    }

    it("rewrites config.json once, keeping its indentation, and says what changed", () => {
        const { cwd, file } = appWith(saved)
        const logs: string[] = []
        const first = migrateLanAddresses({
            cwd,
            env: {},
            localHosts: HERE,
            log: (message: string) => logs.push(message),
        })
        expect(first.ran).toBe(true)
        expect(first.changes).toHaveLength(5)
        const text = fs.readFileSync(file, "utf8")
        expect(text).toMatch(/^\{\n {4}"NODE_SERVER_HOSTNAME": "localhost"/)
        expect(text.endsWith("}\n")).toBe(true)
        expect(JSON.parse(text).DB_HOST).toBe("172.18.0.5")
        expect(logs.join("\n")).toContain("NODE_SERVER_HOSTNAME: 192.168.1.20 -> localhost")
        expect(readLocalState({ cwd }).migrations.lanAddresses).toBeTruthy()

        // A private address added later is the user's own: left alone.
        fs.writeFileSync(file, JSON.stringify({ API_URL: "http://192.168.1.20:8080" }, null, 4))
        expect(migrateLanAddresses({ cwd, env: {}, localHosts: HERE })).toEqual({ ran: false, changes: [] })
        expect(JSON.parse(fs.readFileSync(file, "utf8")).API_URL).toBe("http://192.168.1.20:8080")
    })

    it("never runs for a release or in CI", () => {
        const releaseConfig = {
            ...saved,
            WEBVIEW_CONFIG: { ...saved.WEBVIEW_CONFIG, android: { buildType: "release" } },
        }
        const cases: Array<[object, Record<string, unknown>]> = [
            [saved, { release: true, env: {} }],
            [saved, { env: { CI: "true" } }],
            [releaseConfig, { platform: "android", env: {} }],
        ]
        for (const [config, options] of cases) {
            const { cwd, file } = appWith(config)
            const before = fs.readFileSync(file, "utf8")
            expect(migrateLanAddresses({ cwd, localHosts: HERE, ...options })).toEqual({
                ran: false,
                changes: [],
            })
            expect(fs.readFileSync(file, "utf8")).toBe(before)
            // Not recorded either: the next debug build on this machine still runs it.
            expect(readLocalState({ cwd }).migrations).toBeUndefined()
        }
    })

    it("never throws on a broken config", () => {
        const cwd = tempDir()
        const logs: string[] = []
        expect(migrateLanAddresses({ cwd, env: {}, log: (message: string) => logs.push(message) })).toEqual({
            ran: false,
            changes: [],
        })
        expect(logs[0]).toContain("Could not check")
    })

    it("leaves an unchanged config untouched", () => {
        const cwd = tempDir()
        const file = path.join(cwd, "config", "config.json")
        fs.mkdirSync(path.dirname(file))
        const text = '{"NODE_SERVER_HOSTNAME":"localhost"}'
        fs.writeFileSync(file, text)
        expect(migrateLanAddresses({ cwd, env: {} }).changes).toEqual([])
        expect(fs.readFileSync(file, "utf8")).toBe(text)
    })
})
