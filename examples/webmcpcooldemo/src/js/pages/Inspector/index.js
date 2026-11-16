import React, { useState } from "react"
import { invokeTool } from "catalyst-core/webmcp"
import { useWire } from "@lib/webmcp/wire.js"
import css from "./Inspector.scss"

export default function Inspector() {
    const { tools, isNative } = useWire()
    const [selectedTool, setSelectedTool] = useState(null)
    const [argsJson, setArgsJson] = useState("{}")
    const [executing, setExecuting] = useState(false)
    const [executionHistory, setExecutionHistory] = useState([])

    const currentTool = tools.find((t) => t.name === selectedTool) || tools[0] || null

    const handleSelectTool = (tool) => {
        setSelectedTool(tool.name)
        // Generate sensible sample JSON args from schema
        if (tool.inputSchema && tool.inputSchema.properties) {
            const sample = {}
            for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
                if (prop.enum && prop.enum.length) {
                    sample[key] = prop.enum[0]
                } else if (prop.type === "number" || prop.type === "integer") {
                    sample[key] = prop.minimum !== undefined ? prop.minimum : 1
                } else if (prop.type === "boolean") {
                    sample[key] = true
                } else if (prop.type === "string") {
                    sample[key] = key === "color" ? "#c6ff3d" : key === "text" ? "HELLO WORLD" : "test"
                }
            }
            setArgsJson(JSON.stringify(sample, null, 2))
        } else {
            setArgsJson("{}")
        }
    }

    const handleRunTool = async () => {
        if (!currentTool || executing) return
        let parsed = {}
        try {
            parsed = JSON.parse(argsJson)
        } catch (e) {
            alert("Invalid JSON arguments: " + e.message)
            return
        }

        setExecuting(true)
        const start = performance.now()
        let record = {
            id: Date.now(),
            toolName: currentTool.name,
            args: parsed,
            timestamp: new Date().toLocaleTimeString(),
        }

        try {
            const res = await invokeTool(currentTool.name, parsed)
            const duration = Math.round(performance.now() - start)
            record = {
                ...record,
                ok: true,
                duration,
                result: res,
            }
        } catch (err) {
            const duration = Math.round(performance.now() - start)
            record = {
                ...record,
                ok: false,
                duration,
                error: {
                    code: err.code || "EXECUTION_ERROR",
                    message: err.message || String(err),
                },
            }
        } finally {
            setExecuting(false)
            setExecutionHistory((h) => [record, ...h])
        }
    }

    return (
        <div className={css.inspectorWrap}>
            {/* Header info */}
            <div className={css.pageHead}>
                <div className={css.headMain}>
                    <span className="chip" data-tone={isNative ? "acid" : "hot"}>
                        <span className="dot" />
                        {isNative ? "Native document.modelContext" : "WebMCP Shim Active"}
                    </span>
                    <h1>WebMCP Tool Registry & Live Explorer</h1>
                    <p>
                        This inspector displays the exact capability contract exposed to AI agents via Catalyst&apos;s WebMCP integration.
                        Test tool executions with custom JSON arguments directly in the browser.
                    </p>
                </div>

                <div className={css.statTiles}>
                    <div className={css.statTile}>
                        <span className={css.statNum}>{tools.length}</span>
                        <span className={css.statLabel}>Live Tools</span>
                    </div>
                    <div className={css.statTile}>
                        <span className={css.statNum}>
                            {tools.filter((t) => t.routePath).length}
                        </span>
                        <span className={css.statLabel}>Route Scoped</span>
                    </div>
                    <div className={css.statTile}>
                        <span className={css.statNum}>
                            {tools.filter((t) => !t.routePath).length}
                        </span>
                        <span className={css.statLabel}>Global Framework</span>
                    </div>
                </div>
            </div>

            {/* Split layout: Tool listing & Interactive playground */}
            <div className={css.grid}>
                {/* Tools List */}
                <aside className={css.toolsList}>
                    <div className={css.listHeader}>
                        <h3>Discovered Tools ({tools.length})</h3>
                        <span className={css.hint}>Click to inspect & invoke</span>
                    </div>

                    <div className={css.cards}>
                        {tools.map((t) => {
                            const isSelected = currentTool && currentTool.name === t.name
                            const isFramework = !t.routePath
                            return (
                                <button
                                    key={t.name}
                                    className={`${css.toolCard} ${isSelected ? css.cardActive : ""}`}
                                    onClick={() => handleSelectTool(t)}
                                >
                                    <div className={css.cardTop}>
                                        <code className={css.toolName}>{t.name}</code>
                                        <span
                                            className={`${css.scopeBadge} ${isFramework ? css.scopeGlobal : css.scopeRoute}`}
                                        >
                                            {isFramework ? "Global" : t.routePath}
                                        </span>
                                    </div>
                                    <p className={css.cardDesc}>{t.description || "No description provided."}</p>
                                    <div className={css.cardFoot}>
                                        {t.annotations?.readOnlyHint && (
                                            <span className={css.readOnlyTag}>read-only</span>
                                        )}
                                        {t.inputSchema?.properties && (
                                            <span className="mono">
                                                {Object.keys(t.inputSchema.properties).length} arg(s)
                                            </span>
                                        )}
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                </aside>

                {/* Main Interactive Tool Tester */}
                <main className={css.testerPanel}>
                    {currentTool ? (
                        <>
                            <div className={css.testerHead}>
                                <div className={css.testerTitleRow}>
                                    <code className={css.bigName}>{currentTool.name}</code>
                                    <span className="chip" data-tone="cyan">
                                        Scope: {currentTool.routePath || "App-Wide"}
                                    </span>
                                </div>
                                <p className={css.testerDesc}>{currentTool.description}</p>
                            </div>

                            {/* Schema View */}
                            <div className={css.section}>
                                <label className={css.sectionLabel}>Input Schema Definition</label>
                                <pre className={css.codeBlock}>
                                    {JSON.stringify(currentTool.inputSchema || {}, null, 2)}
                                </pre>
                            </div>

                            {/* Argument JSON Editor */}
                            <div className={css.section}>
                                <label className={css.sectionLabel}>Execution Arguments (JSON)</label>
                                <textarea
                                    className={css.argEditor}
                                    value={argsJson}
                                    onChange={(e) => setArgsJson(e.target.value)}
                                    rows={5}
                                    spellCheck={false}
                                />
                                <div className={css.invokeRow}>
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleRunTool}
                                        disabled={executing}
                                    >
                                        {executing ? "Invoking Tool…" : `Invoke "${currentTool.name}" 🚀`}
                                    </button>
                                </div>
                            </div>

                            {/* Invocation Results Stream */}
                            <div className={css.section}>
                                <label className={css.sectionLabel}>
                                    Execution Log ({executionHistory.length})
                                </label>
                                {executionHistory.length === 0 ? (
                                    <div className={css.emptyLog}>
                                        No executions yet. Click &quot;Invoke&quot; above or run a command with the Agent.
                                    </div>
                                ) : (
                                    <div className={css.logList}>
                                        {executionHistory.map((item) => (
                                            <div
                                                key={item.id}
                                                className={`${css.logItem} ${item.ok ? css.logOk : css.logError}`}
                                            >
                                                <div className={css.logHeader}>
                                                    <span className={css.logStatusBadge}>
                                                        {item.ok ? "SUCCESS ✓" : `ERROR: ${item.error?.code}`}
                                                    </span>
                                                    <span className="mono">{item.toolName}</span>
                                                    <span className={css.logTime}>{item.duration}ms • {item.timestamp}</span>
                                                </div>
                                                <pre className={css.logPayload}>
                                                    {item.ok
                                                        ? JSON.stringify(item.result, null, 2)
                                                        : item.error?.message}
                                                </pre>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className={css.noToolSelected}>
                            Select a tool from the list to view its schema and run it.
                        </div>
                    )}
                </main>
            </div>
        </div>
    )
}

Inspector.setMetaData = () => [
    <title key="title">WebMCP Registry Inspector & Tool Explorer</title>,
    <meta
        key="desc"
        name="description"
        content="Interactive WebMCP tool discovery inspector and tester for AI agent integration."
    />,
]
