import { spawnSync } from "child_process"
import { EventEmitter } from "events"
import fs from "fs"
import http from "http"
import net from "net"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import {
    askReleaseConfig,
    devServerPorts,
    ensureDevServer,
    getDeviceReachableHost,
    getLocalIPAddress,
    isProcessAlive,
    isServerAnswering,
    migrateLanAddresses,
    planLanAddressMigration,
    readHmrPort,
    readLocalHostName,
    startDevServerProcess,
    writeConfigKeys,
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
            host: "janes-macbook-pro.local",
            source: "bonjour",
        })
    })

    it("lowercases the Bonjour name, since WebKit sends the Host header lowercased", () => {
        expect(
            getDeviceReachableHost({ localHostName: () => "G206F1WHVF", interfaces: {} as any })?.host
        ).toBe("g206f1whvf.local")
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

describe("readLocalHostName", () => {
    it("asks scutil on macOS only", () => {
        const calls: any[] = []
        const exec = ((...args: any[]) => {
            calls.push(args)
            return "Janes-Mac\n"
        }) as any
        expect(readLocalHostName({ platform: "linux", exec })).toBe("")
        expect(calls).toHaveLength(0)
        expect(readLocalHostName({ platform: "darwin", exec })).toBe("Janes-Mac\n")
        expect(calls[0][0]).toBe("scutil")
        expect(calls[0][1]).toEqual(["--get", "LocalHostName"])
        expect(calls[0][2]).toMatchObject({ encoding: "utf8", timeout: 5000 })
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

    it("falls back to the default HMR port for a buildConfig.js that does not load or names a bad port", async () => {
        const broken = tempDir()
        fs.writeFileSync(path.join(broken, "buildConfig.js"), "module.exports = {\n")
        expect(await readHmrPort({ cwd: broken })).toBe(24678)
        const outOfRange = tempDir()
        fs.writeFileSync(
            path.join(outOfRange, "webpackConfig.js"),
            "module.exports = { devServer: { hmr: { port: 70000 } } }\n"
        )
        expect(await readHmrPort({ cwd: outOfRange })).toBe(24678)
    })
})

describe("startDevServerProcess", () => {
    it("starts catalyst start detached, logging to an owner-only file under .catalyst/", () => {
        const cwd = tempDir()
        let spawned: any
        let unrefs = 0
        const child = Object.assign(new EventEmitter(), {
            pid: 4242,
            unref: () => void unrefs++,
        })
        const { child: returned, logFile } = startDevServerProcess({
            cwd,
            port: 3005,
            overrides: { NODE_SERVER_HOSTNAME: "0.0.0.0", PORT: 3005 },
            spawnProcess: ((command: string, args: string[], options: any) => {
                spawned = { command, args, options }
                return child
            }) as any,
        })
        expect(returned).toBe(child)
        expect(logFile).toBe(path.join(cwd, ".catalyst", "dev-server-3005.log"))
        expect(logFile.startsWith(os.tmpdir() + path.sep + "catalyst-dev-server")).toBe(false)
        expect(fs.statSync(logFile).mode & 0o777).toBe(0o600)
        expect(fs.readFileSync(path.join(cwd, ".catalyst", ".gitignore"), "utf8")).toBe("*\n")
        expect(spawned.command).toBe(process.execPath)
        expect(path.basename(spawned.args[0])).toBe("catalyst.js")
        expect(spawned.args.slice(1)).toEqual(["start", "NODE_SERVER_HOSTNAME=0.0.0.0", "PORT=3005"])
        expect(spawned.options).toMatchObject({ cwd, detached: true })
        expect(spawned.options.env.PWD).toBe(cwd)
        expect(spawned.options.stdio[0]).toBe("ignore")
        expect(unrefs).toBe(1)
        // A spawn failure after the fact is swallowed, not an unhandled error.
        expect(() => child.emit("error", new Error("ENOENT"))).not.toThrow()

        // Without a port the file says so.
        const second = startDevServerProcess({
            cwd,
            spawnProcess: (() => Object.assign(new EventEmitter(), { unref() {} })) as any,
        })
        expect(path.basename(second.logFile)).toBe("dev-server-default.log")
    })
})

describe("isProcessAlive", () => {
    it("is true for a running process and false once it has exited", () => {
        expect(isProcessAlive(process.pid)).toBe(true)
        const done = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
            encoding: "utf8",
        })
        expect(isProcessAlive(Number(done.stdout))).toBe(false)
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

    it("fails with NATIVE-006 when catalyst start exits before the server answers", async () => {
        const exitWith = (code: number | null) => {
            const child = new EventEmitter()
            setTimeout(() => child.emit("exit", code), 5)
            return child
        }
        for (const [code, shown] of [
            [1, "exited (1)"],
            [null, "exited (signal)"],
        ] as const) {
            const error = await ensureDevServer({
                config,
                intervalMs: 2,
                probe: async () => false,
                start: (() => ({
                    child: exitWith(code),
                    logFile: "/app/.catalyst/dev-server-3005.log",
                })) as any,
            }).catch((e) => e)
            expect(error.code).toBe("NATIVE-006")
            expect(error.message).toContain(shown)
            expect(error.message).toContain("/app/.catalyst/dev-server-3005.log")
        }
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

    it("gives up on a server that accepts but never answers", async () => {
        const sockets: net.Socket[] = []
        const server = net.createServer((socket) => void sockets.push(socket))
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
        const { port } = server.address() as any
        try {
            expect(await isServerAnswering({ host: "127.0.0.1", port, timeoutMs: 50 })).toBe(false)
        } finally {
            for (const socket of sockets) socket.destroy()
            await new Promise((resolve) => server.close(resolve))
        }
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

    it("puts localhost back for this machine's current addresses only", () => {
        const { config, changes } = planLanAddressMigration(saved, { localHosts: HERE })
        expect(config).toMatchObject({
            NODE_SERVER_HOSTNAME: "localhost",
            PUBLIC_STATIC_ASSET_URL: "http://localhost:3005",
            API_URL: "https://api.acme.com",
            CDN: "http://8.8.8.8/x",
            // A private address that is not this machine (a VPN or LAN staging server) is the app's own.
            OLD_API: "http://10.0.0.4:8080/api",
            WEBVIEW_CONFIG: {
                LOCAL_IP: "10.0.0.4",
                accessControl: { allowedUrls: ["http://localhost:3005/*", "https://acme.com/*"] },
            },
        })
        expect(changes.map((change) => change.path)).toEqual([
            "NODE_SERVER_HOSTNAME",
            "PUBLIC_STATIC_ASSET_URL",
            "WEBVIEW_CONFIG.accessControl.allowedUrls[0]",
        ])
        expect(saved.NODE_SERVER_HOSTNAME).toBe("192.168.1.20")
        // A LOCAL_IP that is this machine's address goes back to localhost.
        const mine = { WEBVIEW_CONFIG: { LOCAL_IP: "192.168.1.20" } }
        const migrated: any = planLanAddressMigration(mine, { localHosts: HERE }).config
        expect(migrated.WEBVIEW_CONFIG.LOCAL_IP).toBe("localhost")
    })

    it("puts localhost back for a private LOCAL_IP that NODE_SERVER_HOSTNAME also holds", () => {
        // Written on another network: not an address this machine has now.
        for (const ip of ["10.0.0.4", "172.20.1.9", "192.168.0.7", "169.254.3.4"]) {
            const leftover = {
                NODE_SERVER_HOSTNAME: ip,
                PUBLIC_STATIC_ASSET_URL: `http://${ip}:3005`,
                API_URL: "https://api.acme.com",
                WEBVIEW_CONFIG: { LOCAL_IP: ip, port: "3005" },
            }
            const { config, changes } = planLanAddressMigration(leftover, { localHosts: HERE })
            expect(config).toMatchObject({
                NODE_SERVER_HOSTNAME: "localhost",
                PUBLIC_STATIC_ASSET_URL: "http://localhost:3005",
                API_URL: "https://api.acme.com",
                WEBVIEW_CONFIG: { LOCAL_IP: "localhost" },
            })
            expect(changes.map((change) => change.path)).toEqual([
                "NODE_SERVER_HOSTNAME",
                "PUBLIC_STATIC_ASSET_URL",
                "WEBVIEW_CONFIG.LOCAL_IP",
            ])
            // Even when this machine reports no address at all.
            expect(planLanAddressMigration(leftover, { localHosts: new Set() }).changes).toHaveLength(3)
        }
    })

    it("leaves a public, VPN or staging LOCAL_IP alone, and a private one NODE_SERVER_HOSTNAME does not hold", () => {
        const cases = [
            // A public address or a hostname is a real server.
            { NODE_SERVER_HOSTNAME: "8.8.8.8", WEBVIEW_CONFIG: { LOCAL_IP: "8.8.8.8" } },
            { NODE_SERVER_HOSTNAME: "staging.acme.vpn", WEBVIEW_CONFIG: { LOCAL_IP: "staging.acme.vpn" } },
            // Outside 172.16/12, and the CGNAT range some VPNs use.
            { NODE_SERVER_HOSTNAME: "172.32.0.1", WEBVIEW_CONFIG: { LOCAL_IP: "172.32.0.1" } },
            { NODE_SERVER_HOSTNAME: "100.64.0.1", WEBVIEW_CONFIG: { LOCAL_IP: "100.64.0.1" } },
            // A LAN staging server the dev server does not bind.
            { NODE_SERVER_HOSTNAME: "localhost", WEBVIEW_CONFIG: { LOCAL_IP: "10.0.0.4" } },
            { NODE_SERVER_HOSTNAME: "10.0.0.5", WEBVIEW_CONFIG: { LOCAL_IP: "10.0.0.4" } },
            { NODE_SERVER_HOSTNAME: "10.0.0.4", WEBVIEW_CONFIG: { LOCAL_IP: 10 } },
            {
                NODE_SERVER_HOSTNAME: "10.0.0.4",
                WEBVIEW_CONFIG: { LOCAL_IP: "10.0.0.4", allowPrivateHost: true },
            },
        ]
        for (const config of cases) {
            expect(planLanAddressMigration(config, { localHosts: HERE }).changes).toEqual([])
        }
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
            planLanAddressMigration(withUrl, { localHosts: new Set(["10.0.0.4"]) }).changes.map(
                (c: any) => c.path
            )
        ).toEqual(["WEBVIEW_CONFIG.LOCAL_IP"])
        expect(planLanAddressMigration(withUrl, { localHosts: new Set() }).changes).toEqual([])
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
        const types: Array<string | undefined> = []
        const first = migrateLanAddresses({
            cwd,
            env: {},
            localHosts: HERE,
            log: (message: string, type?: string) => {
                logs.push(message)
                types.push(type)
            },
        })
        expect(first.ran).toBe(true)
        expect(first.changes).toHaveLength(3)
        const text = fs.readFileSync(file, "utf8")
        expect(text).toMatch(/^\{\n {4}"NODE_SERVER_HOSTNAME": "localhost"/)
        expect(text.endsWith("}\n")).toBe(true)
        expect(JSON.parse(text).DB_HOST).toBe("172.18.0.5")
        expect(logs.join("\n")).toContain("NODE_SERVER_HOSTNAME: 192.168.1.20 -> localhost")
        // Printed by default, not only with --verbose.
        expect(types).toEqual(["note", "note", "note", "note"])
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

describe("writeConfigKeys", () => {
    function file(text: string) {
        const dir = tempDir()
        const target = path.join(dir, "config.json")
        fs.writeFileSync(target, text)
        return target
    }

    it("sets nested keys, creating objects as needed, and keeps the indent and trailing newline", () => {
        const target = file('{\n\t"WEBVIEW_CONFIG": {\n\t\t"appId": "com.example.app"\n\t}\n}\n')
        const logs: Array<[string, string?]> = []
        const changes = writeConfigKeys(
            target,
            {
                "WEBVIEW_CONFIG.url": "https://shop.acme.com",
                "WEBVIEW_CONFIG.ios.developmentTeam": "ABCDE12345",
            },
            { log: (message: string, type?: string) => logs.push([message, type]) }
        )
        expect(changes).toEqual([
            { path: "WEBVIEW_CONFIG.url", from: undefined, to: "https://shop.acme.com" },
            { path: "WEBVIEW_CONFIG.ios.developmentTeam", from: undefined, to: "ABCDE12345" },
        ])
        const text = fs.readFileSync(target, "utf8")
        expect(text).toBe(
            '{\n\t"WEBVIEW_CONFIG": {\n\t\t"appId": "com.example.app",\n\t\t"url": "https://shop.acme.com",\n' +
                '\t\t"ios": {\n\t\t\t"developmentTeam": "ABCDE12345"\n\t\t}\n\t}\n}\n'
        )
        expect(logs.map(([message]) => message)).toEqual([
            `Saved WEBVIEW_CONFIG.url = https://shop.acme.com to ${target}`,
            `Saved WEBVIEW_CONFIG.ios.developmentTeam = ABCDE12345 to ${target}`,
        ])
        expect(logs.every(([, type]) => type === "note")).toBe(true)
    })

    it("re-reads the file right before writing, so a key saved in the meantime is kept", () => {
        const target = file(JSON.stringify({ WEBVIEW_CONFIG: {} }, null, 2))
        // Another build (android and ios in parallel) saved its answer after this one started.
        fs.writeFileSync(target, JSON.stringify({ WEBVIEW_CONFIG: { appId: "com.acme.shop" } }, null, 2))
        writeConfigKeys(target, { "WEBVIEW_CONFIG.url": "https://shop.acme.com" })
        const text = fs.readFileSync(target, "utf8")
        expect(JSON.parse(text)).toEqual({
            WEBVIEW_CONFIG: { appId: "com.acme.shop", url: "https://shop.acme.com" },
        })
        expect(text.startsWith('{\n  "WEBVIEW_CONFIG"')).toBe(true)
        expect(text.endsWith("}")).toBe(true)
    })

    it("writes array items by index and leaves the file alone when nothing changes", () => {
        const text = JSON.stringify({ list: ["a", "b"], name: "x" }, null, 4)
        const target = file(text)
        expect(writeConfigKeys(target, { name: "x", "list[1]": "b" })).toEqual([])
        expect(fs.readFileSync(target, "utf8")).toBe(text)
        expect(writeConfigKeys(target, { "list[1]": "c" })).toEqual([{ path: "list[1]", from: "b", to: "c" }])
        expect(JSON.parse(fs.readFileSync(target, "utf8")).list).toEqual(["a", "c"])
    })

    it("refuses a prototype key and a file that is not a JSON object", () => {
        const target = file("{}")
        expect(() => writeConfigKeys(target, { "__proto__.polluted": true })).toThrow(/Not a config key/)
        expect(({} as any).polluted).toBeUndefined()
        expect(() => writeConfigKeys(file("[]"), { a: 1 })).toThrow(/JSON object/)
    })
})

describe("askReleaseConfig", () => {
    // The template's config: a placeholder appId and LOCAL_IP localhost, no url.
    const template = {
        NODE_SERVER_PORT: 3005,
        WEBVIEW_CONFIG: {
            appId: "com.example.app",
            LOCAL_IP: "localhost",
            port: "3005",
            android: { buildType: "debug" },
            ios: { buildType: "debug" },
        },
    }

    function app(config: object) {
        const cwd = tempDir()
        const configPath = path.join(cwd, "config", "config.json")
        fs.mkdirSync(path.dirname(configPath))
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4) + "\n")
        return { cwd, configPath, read: () => JSON.parse(fs.readFileSync(configPath, "utf8")) }
    }

    /** A prompt that answers from a list and records each question. */
    function answering(...answers: string[]) {
        const questions: string[] = []
        const prompt = async (question: string) => {
            questions.push(question)
            if (!answers.length) throw new Error(`unexpected question: ${question}`)
            return answers.shift()
        }
        return { prompt, questions }
    }

    const run = (platform: "android" | "ios", cwd: string, options: Record<string, any> = {}) => {
        const logs: Array<[string, string?]> = []
        const promise = askReleaseConfig(platform, {
            release: true,
            cwd,
            env: {},
            localHosts: new Set(["192.168.1.20", "jane-mac"]),
            isTTY: true,
            log: (message: string, type?: string) => logs.push([message, type]),
            ...options,
        })
        return { promise, logs }
    }

    it("asks for the website and the app id once, re-asking on bad answers, and saves them", async () => {
        const { cwd, read } = app(template)
        const { prompt, questions } = answering(
            "http://shop.acme.com", // plain HTTP
            "https://192.168.1.20", // a LAN address
            "https://jane-mac", // this machine
            "shop.acme.com", // https:// is assumed
            "com.example.app", // placeholder
            "com.acme.my-shop", // a valid iOS id, but not an Android package
            "com.acme.shop"
        )
        const { promise, logs } = run("ios", cwd, { prompt })
        const { changes } = await promise
        expect(changes).toEqual([
            { path: "WEBVIEW_CONFIG.url", from: undefined, to: "https://shop.acme.com" },
            { path: "WEBVIEW_CONFIG.appId", from: "com.example.app", to: "com.acme.shop" },
        ])
        expect(questions).toHaveLength(7)
        expect(read().WEBVIEW_CONFIG).toMatchObject({ url: "https://shop.acme.com", appId: "com.acme.shop" })
        const warnings = logs.filter(([, type]) => type === "warning").map(([message]) => message)
        expect(warnings.join("\n")).toContain("plain HTTP")
        expect(warnings.join("\n")).toContain("192.168.1.20 is a private LAN address")
        expect(warnings.join("\n")).toContain("jane-mac is this machine's own address")
        expect(warnings.join("\n")).toContain("placeholder")
        expect(warnings.join("\n")).toContain('part "my-shop"')
        // The next run (android after ios in `catalyst buildApp`) has nothing to ask.
        const again = run("android", cwd, { prompt: answering().prompt })
        expect((await again.promise).changes).toEqual([])
    })

    it("saves the app id to the platform key when that is the one that wins", async () => {
        const { cwd, read } = app({
            WEBVIEW_CONFIG: {
                url: "https://shop.acme.com",
                appId: "com.acme.shop",
                android: { packageName: "io.yourname.androidproject" },
                ios: { appBundleId: "com.example.ios" },
            },
        })
        await run("android", cwd, { prompt: answering("com.acme.droid").prompt }).promise
        await run("ios", cwd, { prompt: answering("com.acme.iphone").prompt }).promise
        expect(read().WEBVIEW_CONFIG).toMatchObject({
            appId: "com.acme.shop",
            android: { packageName: "com.acme.droid" },
            ios: { appBundleId: "com.acme.iphone" },
        })
    })

    it("accepts a private website only with allowPrivateHost, and then asks nothing", async () => {
        const internal = { WEBVIEW_CONFIG: { ...template.WEBVIEW_CONFIG, appId: "com.acme.shop" } }
        const refused = app(internal)
        const { prompt } = answering("https://10.0.38.192", "https://shop.acme.com")
        const { promise, logs } = run("android", refused.cwd, { prompt })
        await promise
        expect(logs.map(([message]) => message).join("\n")).toContain("allowPrivateHost")
        expect(refused.read().WEBVIEW_CONFIG.url).toBe("https://shop.acme.com")

        const allowed = app({ WEBVIEW_CONFIG: { ...internal.WEBVIEW_CONFIG, allowPrivateHost: true } })
        const before = fs.readFileSync(allowed.configPath, "utf8")
        expect((await run("android", allowed.cwd, { prompt: answering().prompt }).promise).changes).toEqual(
            []
        )
        expect(fs.readFileSync(allowed.configPath, "utf8")).toBe(before)
    })

    it("does not ask for the website when --url was passed", async () => {
        const { cwd, configPath } = app(template)
        const before = fs.readFileSync(configPath, "utf8")
        const { prompt, questions } = answering()
        const error = await run("android", cwd, { prompt, url: "https://localhost" }).promise.catch((e) => e)
        expect(error.code).toBe("NATIVE-001")
        expect(questions).toEqual([])
        expect(fs.readFileSync(configPath, "utf8")).toBe(before)
    })

    it("without a terminal throws the resolver's own error and writes nothing", async () => {
        const { cwd, configPath } = app(template)
        const before = fs.readFileSync(configPath, "utf8")
        const { prompt, questions } = answering()
        const error = await run("ios", cwd, { prompt, isTTY: false }).promise.catch((e) => e)
        expect(error.code).toBe("NATIVE-001")
        expect(error.message).toBe(
            "Release build points at a local or private host: http://localhost:3005/ (localhost is this machine)"
        )
        // CI is never a terminal, whatever the streams say.
        const ci = await askReleaseConfig("android", {
            release: true,
            cwd,
            env: { CI: "true" },
            prompt,
        }).catch((e) => e)
        expect(ci.code).toBe("NATIVE-001")
        expect(questions).toEqual([])
        expect(fs.readFileSync(configPath, "utf8")).toBe(before)
    })

    it("gives up with the original error after repeated bad answers", async () => {
        const { cwd, configPath } = app({ WEBVIEW_CONFIG: { url: "https://shop.acme.com" } })
        const before = fs.readFileSync(configPath, "utf8")
        const { prompt, questions } = answering("", "x", "com.example.a", "1.2", "a..b")
        const error = await run("android", cwd, { prompt }).promise.catch((e) => e)
        expect(error.code).toBe("NATIVE-003")
        expect(questions).toHaveLength(5)
        expect(fs.readFileSync(configPath, "utf8")).toBe(before)
    })

    it("asks nothing for a debug build, and treats buildType release as a release", async () => {
        const { cwd } = app(template)
        const debug = await run("android", cwd, { release: false, prompt: answering().prompt }).promise
        expect(debug.changes).toEqual([])

        const deprecated = app({
            WEBVIEW_CONFIG: {
                ...template.WEBVIEW_CONFIG,
                url: "https://shop.acme.com",
                ios: { buildType: "release" },
            },
        })
        const { prompt } = answering("com.acme.shop")
        await run("ios", deprecated.cwd, { release: false, prompt }).promise
        expect(deprecated.read().WEBVIEW_CONFIG.appId).toBe("com.acme.shop")
    })

    it("rethrows an error no answer fixes, without asking", async () => {
        const { cwd } = app({ WEBVIEW_CONFIG: { url: "https://shop.acme.com", appId: "com.acme.my-shop" } })
        const { prompt, questions } = answering()
        const error = await run("android", cwd, { prompt }).promise.catch((e) => e)
        expect(error.code).toBe("NATIVE-010")
        expect(questions).toEqual([])
    })
})
