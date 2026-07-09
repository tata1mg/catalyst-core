"use strict"

const fs = require("fs")

/**
 * Re-seed framework_knowledge (source='static') and known_errors from knowledge-base.json.
 * Caller is responsible for rebuilding fk_fts afterwards (via knowledge.init).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} kbPath - absolute path to knowledge-base.json
 * @param {?{ dir: string, pkg: { name?: string }, version: string }} projectInfo
 *        When provided, also upserts the project_context row. Pass null at runtime sync
 *        when project_context is already populated.
 * @returns {{ knowledgeCount: number, errorCount: number }}
 */
function seedKnowledgeBase(db, kbPath, projectInfo = null) {
    const kb = JSON.parse(fs.readFileSync(kbPath, "utf8"))
    if (!Array.isArray(kb)) throw new Error("knowledge-base.json must be a JSON array")

    const deleteKnowledge = db.prepare(`DELETE FROM framework_knowledge WHERE source = 'static'`)
    const deleteErrors = db.prepare(`DELETE FROM known_errors`)

    const insertKnowledge = db.prepare(`
        INSERT INTO framework_knowledge (section, title, content, layer, source, tags, github_files)
        VALUES (@section, @title, @content, @layer, @source, @tags, @github_files)
    `)

    const insertError = db.prepare(`
        INSERT INTO known_errors (symptom, cause, fix, layer, tags)
        VALUES (@symptom, @cause, @fix, @layer, @tags)
    `)

    let knowledgeCount = 0
    let errorCount = 0

    const seedAll = db.transaction(() => {
        deleteKnowledge.run()
        deleteErrors.run()
        for (const entry of kb) {
            if (entry.section === "known_errors") {
                // known_errors entries encode symptom/cause/fix in content as:
                // "Symptom: ... Cause: ... Fix: ..."
                const content = entry.content || ""
                const symptomMatch = content.match(/Symptom:\s*([^.]+\.?)/i)
                const causeMatch = content.match(/Cause:\s*([^.]+\.?)/i)
                const fixMatch = content.match(/Fix:\s*([\s\S]+)/i)
                insertError.run({
                    symptom: symptomMatch ? symptomMatch[1].trim() : entry.title,
                    cause: causeMatch ? causeMatch[1].trim() : "",
                    fix: fixMatch ? fixMatch[1].trim() : "",
                    layer: entry.layer,
                    tags: JSON.stringify(entry.tags || []),
                })
                errorCount++
            } else {
                insertKnowledge.run({
                    section: entry.section,
                    title: entry.title,
                    content: entry.content,
                    layer: entry.layer,
                    source: "static",
                    tags: JSON.stringify(entry.tags || []),
                    github_files: entry.github_files ? JSON.stringify(entry.github_files) : null,
                })
                knowledgeCount++
            }
        }
    })

    seedAll()

    if (projectInfo) {
        db.prepare(
            `
            INSERT OR REPLACE INTO project_context (id, repo_path, package_name, catalyst_version, detected_at)
            VALUES (1, @repo_path, @package_name, @catalyst_version, datetime('now'))
        `
        ).run({
            repo_path: projectInfo.dir,
            package_name: projectInfo.pkg.name || "unknown",
            catalyst_version: projectInfo.version,
        })
    }

    return { knowledgeCount, errorCount }
}

module.exports = { seedKnowledgeBase }
