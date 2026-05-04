"use strict"

const fs = require("fs")
const path = require("path")
const https = require("https")
const http = require("http")
const crypto = require("crypto")
const { URL } = require("url")

const { seedKnowledgeBase } = require("../lib/seed")
const knowledge = require("./knowledge")

const SITEMAP_URL = "https://catalyst.1mg.com/public_docs/sitemap.xml"
const SITEMAP_HOST = "catalyst.1mg.com"
const KB_GITHUB_URL =
    "https://raw.githubusercontent.com/tata1mg/catalyst-core/main/mcp_v2/knowledge-base.json"
const GITHUB_RAW_HOST = "raw.githubusercontent.com"
const KB_PATH = path.join(__dirname, "..", "knowledge-base.json")
const MAX_BYTES = 512 * 1024
const KB_MAX_BYTES = 4 * 1024 * 1024
const MAX_REDIRECTS = 5
const SOCKET_TIMEOUT_MS = 15_000
const CONTENT_TRUNCATE = 2000
const MAX_ERRORS_RETURNED = 20

let _db

function init(db) {
    _db = db
}

function fetchUrl(url, opts = {}) {
    const {
        allowedHost = SITEMAP_HOST,
        maxBytes = MAX_BYTES,
        redirectsLeft = MAX_REDIRECTS,
    } = opts
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
            { headers: { "User-Agent": "catalyst-mcp/2.0 sync_catalyst_docs" } },
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

function decodeXmlEntities(s) {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
}

function parseSitemapUrls(xml) {
    const matches = xml.match(/<loc>([\s\S]*?)<\/loc>/g) || []
    return matches
        .map((m) => decodeXmlEntities(m.replace(/<\/?loc>/g, "").trim()))
        .filter(Boolean)
}

function stripHtml(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function contentHash(text) {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
}

function extractTitle(html, url) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (m && m[1].trim()) return decodeXmlEntities(m[1].trim()).slice(0, 200)
    return url.split("/").filter(Boolean).pop() || url
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
        // Rebuild fk_fts so rowids match the freshly-inserted framework_knowledge ids
        // (sitemap rows already in framework_knowledge are repopulated by knowledge.init).
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

async function handle_sync_catalyst_docs({ force = false } = {}) {
    const knowledge_base = await syncKnowledgeBaseFromGithub({ force })

    let xml
    try {
        xml = await fetchUrl(SITEMAP_URL)
    } catch (e) {
        return {
            error: "sitemap_fetch_failed",
            sitemap_url: SITEMAP_URL,
            knowledge_base,
            message: `Could not fetch sitemap: ${e.message}`,
        }
    }

    const urls = parseSitemapUrls(xml)
    if (urls.length === 0) {
        return {
            error: "empty_sitemap",
            sitemap_url: SITEMAP_URL,
            knowledge_base,
            message: "Sitemap parsed but contained no <loc> entries.",
        }
    }

    const getCurr = _db.prepare(
        `SELECT id, content_hash FROM doc_snapshots WHERE url = ? AND slot = 'curr'`
    )
    const deletePrev = _db.prepare(`DELETE FROM doc_snapshots WHERE url = ? AND slot = 'prev'`)
    const promoteCurr = _db.prepare(
        `UPDATE doc_snapshots SET slot = 'prev' WHERE url = ? AND slot = 'curr'`
    )
    const insertCurr = _db.prepare(
        `INSERT INTO doc_snapshots (url, content_hash, slot) VALUES (?, ?, 'curr')`
    )
    const getLinked = _db.prepare(`SELECT knowledge_id FROM linkage_map WHERE url = ?`)
    const insertKnowledge = _db.prepare(`
        INSERT INTO framework_knowledge (section, title, content, layer, source, tags, url)
        VALUES ('sitemap', ?, ?, 'Component', 'sitemap', '[]', ?)
    `)
    const updateKnowledge = _db.prepare(`
        UPDATE framework_knowledge
        SET title = ?, content = ?, last_updated = datetime('now')
        WHERE id = ?
    `)
    const insertLink = _db.prepare(`INSERT INTO linkage_map (url, knowledge_id) VALUES (?, ?)`)
    const insertFts = _db.prepare(
        `INSERT INTO fk_fts(rowid, title, content, tags, section) VALUES (?, ?, ?, '', 'sitemap')`
    )
    const updateFts = _db.prepare(`UPDATE fk_fts SET title = ?, content = ? WHERE rowid = ?`)

    let fetched = 0
    let changed = 0
    let unchanged = 0
    let failed = 0
    const errors = []

    for (const url of urls) {
        let html
        try {
            html = await fetchUrl(url)
        } catch (e) {
            failed++
            if (errors.length < MAX_ERRORS_RETURNED) errors.push({ url, error: e.message })
            continue
        }
        fetched++

        const text = stripHtml(html)
        const hash = contentHash(text)
        const prior = getCurr.get(url)

        if (!force && prior && prior.content_hash === hash) {
            unchanged++
            continue
        }

        const title = extractTitle(html, url)
        const content = text.slice(0, CONTENT_TRUNCATE)

        const upsert = _db.transaction(() => {
            deletePrev.run(url)
            if (prior) promoteCurr.run(url)
            insertCurr.run(url, hash)

            const linked = getLinked.all(url)
            if (linked.length > 0) {
                for (const link of linked) {
                    updateKnowledge.run(title, content, link.knowledge_id)
                    updateFts.run(title, content, link.knowledge_id)
                }
            } else {
                const result = insertKnowledge.run(title, content, url)
                const newId = Number(result.lastInsertRowid)
                insertLink.run(url, newId)
                insertFts.run(newId, title, content)
            }
        })

        try {
            upsert()
            changed++
        } catch (e) {
            failed++
            if (errors.length < MAX_ERRORS_RETURNED) {
                errors.push({ url, error: `db_upsert_failed: ${e.message}` })
            }
        }
    }

    return {
        synced_at: new Date().toISOString(),
        sitemap_url: SITEMAP_URL,
        force,
        total_urls: urls.length,
        fetched,
        changed,
        unchanged,
        failed,
        errors,
        knowledge_base,
        message:
            failed === 0
                ? `Synced ${changed} changed, ${unchanged} unchanged of ${urls.length} URLs.`
                : `Synced ${changed} changed, ${unchanged} unchanged, ${failed} failed of ${urls.length} URLs.`,
    }
}

module.exports = { init, handle_sync_catalyst_docs }
