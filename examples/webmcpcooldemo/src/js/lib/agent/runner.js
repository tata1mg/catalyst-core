/**
 * runner.js — executes a plan against the LIVE WebMCP registry.
 *
 * The interesting bit: WebMCP action tools are route-scoped. If the agent
 * wants `add_sticker` but you're on the Studio, that tool simply doesn't
 * exist yet. The runner notices, calls the framework `navigate` tool, then
 * waits for the target route to register its tools before continuing —
 * the same dance a real browser agent does.
 */
import { inspect, invokeTool } from "catalyst-core/webmcp"
import { waitForTool } from "../webmcp/wire.js"

// Where the agent has "seen" each action tool before. A real agent would learn
// this by calling get_current_route on each page; we hard-code the memory.
export const TOOL_HOME = {
    sculpt_shape: "/",
    paint: "/",
    set_spin: "/",
    set_finish: "/",
    burst: "/",
    set_headline: "/",
    set_dimension: "/",
    toggle_dimension: "/",
    get_scene: "/",
    add_sticker: "/stickers",
    clear_stickers: "/stickers",
    set_backdrop: "/stickers",
    list_stickers: "/stickers",
    remove_sticker: "/stickers",
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isLive = (name) => inspect().tools.some((t) => t.name === name)

/**
 * @param {Array<{tool, args}>} steps
 * @param {(event) => void} onEvent  receives {type:"step", index, step, status, result?, error?}
 */
export async function runPlan(steps, onEvent) {
    const queue = steps.slice()
    let i = 0
    while (queue.length) {
        const step = queue.shift()

        // Route-scoped tool not live here → hop to its home route first.
        if (!isLive(step.tool) && TOOL_HOME[step.tool]) {
            const hop = { tool: "navigate", args: { path: TOOL_HOME[step.tool] }, auto: true }
            const idx = i++
            onEvent({ type: "step", index: idx, step: hop, status: "running" })
            try {
                const result = await invokeTool("navigate", hop.args)
                await waitForTool(step.tool)
                onEvent({ type: "step", index: idx, step: hop, status: "ok", result })
            } catch (err) {
                onEvent({ type: "step", index: idx, step: hop, status: "error", error: errInfo(err) })
                return
            }
            await sleep(250)
        }

        const idx = i++
        onEvent({ type: "step", index: idx, step, status: "running" })
        await sleep(220) // let the UI breathe so humans can follow along
        try {
            const result = await invokeTool(step.tool, step.args || {})
            onEvent({ type: "step", index: idx, step, status: "ok", result })
            if (step.tool === "navigate") await sleep(350)
        } catch (err) {
            onEvent({ type: "step", index: idx, step, status: "error", error: errInfo(err) })
            return
        }
        await sleep(260)
    }
}

function errInfo(err) {
    return { code: err && err.code, message: (err && err.message) || String(err) }
}
