"use strict"

const fs = require("fs")
const path = require("path")
const https = require("https")
const http = require("http")
const crypto = require("crypto")
const { URL } = require("url")

const { seedKnowledgeBase } = require("../lib/seed")
const knowledge = require("./knowledge")

const KB_GITHUB_URL =
    "https://raw.githubusercontent.com/tata1mg/catalyst-core/main/packages/catalyst-core/mcp_v2/knowledge-base.json"
const GITHUB_RAW_HOST = "raw.githubusercontent.com"
const KB_PATH = path.join(__dirname, "..", "knowledge-base.json")
const KB_MAX_BYTES = 4 * 1024 * 1024
const MAX_REDIRECTS = 5
const SOCKET_TIMEOUT_MS = 15_000

let _db

function init(db) {
    _db = db
}

function fetchUrl(url, opts = {}) {
    const { allowedHost = GITHUB_RAW_HOST, maxBytes = KB_MAX_BYTES, redirectsLeft = MAX_REDIRECTS } = opts
    return new Promise((resolve, reject) => {
        let parsed
        try {
            parsed = new URL(url)
        } catch {
            return reject(new Error(`Invalid URL: ${url}`))
        }
        if (parsed.hostname !== allowedHost) {
            return reject(new Error(`Refusing off-host fetch: ${parsed.hostname}`))
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return reject(new Error(`Unsupported protocol: ${parsed.protocol}`))
        }
        const mod = parsed.protocol === "https:" ? https : http
        const req = mod.get(
            url,
            { headers: { "User-Agent": "catalyst-mcp/2.0 sync_knowledge_base" } },
            (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume()
                    if (redirectsLeft <= 0) return reject(new Error("Too many redirects"))
                    let next
                    try {
                        next = new URL(res.headers.location, url).toString()
                    } catch {
                        return reject(new Error(`Invalid redirect target: ${res.headers.location}`))
                    }
                    return fetchUrl(next, {
                        allowedHost,
                        maxBytes,
                        redirectsLeft: redirectsLeft - 1,
                    }).then(resolve, reject)
                }
                if (res.statusCode !== 200) {
                    res.resume()
                    return reject(new Error(`HTTP ${res.statusCode}`))
                }
                let bytes = 0
                const chunks = []
                res.on("data", (chunk) => {
                    bytes += chunk.length
                    if (bytes > maxBytes) {
                        req.destroy(new Error(`Response exceeded ${maxBytes} bytes`))
                        return
                    }
                    chunks.push(chunk)
                })
                res.on("end", () => {
                    if (bytes > maxBytes) return
                    resolve(Buffer.concat(chunks).toString("utf8"))
                })
                res.on("error", reject)
            }
        )
        req.setTimeout(SOCKET_TIMEOUT_MS, () => {
            req.destroy(new Error(`Socket idle timeout after ${SOCKET_TIMEOUT_MS}ms`))
        })
        req.on("error", reject)
    })
}

function contentHash(text) {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
}

async function syncKnowledgeBaseFromGithub({ force = false } = {}) {
    let remoteText
    try {
        remoteText = await fetchUrl(KB_GITHUB_URL, {
            allowedHost: GITHUB_RAW_HOST,
            maxBytes: KB_MAX_BYTES,
        })
    } catch (e) {
        return { kb_changed: false, kb_url: KB_GITHUB_URL, error: `kb_fetch_failed: ${e.message}` }
    }

    let parsed
    try {
        parsed = JSON.parse(remoteText)
    } catch (e) {
        return { kb_changed: false, kb_url: KB_GITHUB_URL, error: `kb_invalid_json: ${e.message}` }
    }
    if (!Array.isArray(parsed)) {
        return {
            kb_changed: false,
            kb_url: KB_GITHUB_URL,
            error: "kb_invalid_format: expected JSON array at the top level",
        }
    }

    const remoteHash = contentHash(remoteText)
    let localHash = null
    if (fs.existsSync(KB_PATH)) {
        try {
            localHash = contentHash(fs.readFileSync(KB_PATH, "utf8"))
        } catch {
            localHash = null
        }
    }

    if (!force && localHash === remoteHash) {
        return {
            kb_changed: false,
            kb_url: KB_GITHUB_URL,
            kb_hash: remoteHash,
            message: "knowledge-base.json already in sync with main branch.",
        }
    }

    const tmpPath = `${KB_PATH}.tmp.${process.pid}`
    try {
        fs.writeFileSync(tmpPath, remoteText)
        fs.renameSync(tmpPath, KB_PATH)
    } catch (e) {
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
        } catch {
            // ignore cleanup failure
        }
        return { kb_changed: false, kb_url: KB_GITHUB_URL, error: `kb_write_failed: ${e.message}` }
    }

    let counts
    try {
        counts = seedKnowledgeBase(_db, KB_PATH)
        // Rebuild fk_fts so rowids match the freshly-inserted framework_knowledge ids.
        _db.exec(`DROP TABLE IF EXISTS fk_fts`)
        knowledge.init(_db)
    } catch (e) {
        return {
            kb_changed: true,
            kb_url: KB_GITHUB_URL,
            kb_hash: remoteHash,
            error: `kb_reseed_failed: ${e.message}`,
            message: "knowledge-base.json written to disk but DB re-seed failed.",
        }
    }

    return {
        kb_changed: true,
        kb_url: KB_GITHUB_URL,
        kb_hash: remoteHash,
        kb_knowledge_count: counts.knowledgeCount,
        kb_error_count: counts.errorCount,
        message: "knowledge-base.json updated from main branch and re-seeded into context.db.",
    }
}

async function handle_sync_knowledge_base({ force = false } = {}) {
    const knowledge_base = await syncKnowledgeBaseFromGithub({ force })
    return {
        synced_at: new Date().toISOString(),
        force,
        knowledge_base,
        error: knowledge_base.error || null,
        message:
            knowledge_base.message ||
            (knowledge_base.error
                ? `knowledge-base.json sync failed: ${knowledge_base.error}`
                : "knowledge-base.json sync complete."),
    }
}

module.exports = { init, handle_sync_knowledge_base }
