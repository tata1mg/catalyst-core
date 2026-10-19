/**
 * planner.js — a tiny, deterministic stand-in for an LLM agent.
 *
 * Turns a plain-English command into an ordered list of WebMCP tool calls.
 * It knows NOTHING about the app's internals — only tool names + argument
 * shapes, exactly like a real browser agent reading document.modelContext.
 * That's the point of the demo: the page publishes capabilities, the agent
 * composes them.
 */

export const COLORS = {
    lime: "#c6ff3d",
    acid: "#c6ff3d",
    green: "#3dffb0",
    mint: "#3dffb0",
    pink: "#ff3ea5",
    magenta: "#ff3ea5",
    hot: "#ff3ea5",
    cyan: "#3de0ff",
    aqua: "#3de0ff",
    teal: "#3de0ff",
    violet: "#7b5cff",
    purple: "#7b5cff",
    orange: "#ff7a1a",
    gold: "#ffd23d",
    yellow: "#ffd23d",
    red: "#ff3b3b",
    blue: "#2f6bff",
    white: "#f4f2ee",
    silver: "#d9dce3",
    black: "#1b1b22",
}

const SHAPE_WORDS = [
    [/\b(orb|sphere|ball|planet)\b/, "orb"],
    [/\b(blob|goo|jelly|liquid)\b/, "blob"],
    [/\b(knot|pretzel|twist)\b/, "knot"],
    [/\b(torus|donut|doughnut|ring)\b/, "torus"],
    [/\b(cube|box|block)\b/, "cube"],
    [/\b(crystal|diamond|gem|octahedron)\b/, "crystal"],
]

const FINISH_WORDS = [
    [/\b(chrome|metal|metallic|mirror)\b/, "chrome"],
    [/\b(holo|holographic|iridescent|rainbow)\b/, "holo"],
    [/\b(glass|glassy|transparent)\b/, "glass"],
    [/\b(matte|clay|flat|soft)\b/, "matte"],
    [/\b(wire|wireframe|mesh|lines)\b/, "wire"],
]

export const BLENDS = ["multiply", "screen", "difference", "exclusion", "overlay", "color-dodge"]
export const BACKDROPS = ["aurora", "sunset", "acid", "ocean", "mono"]

const ROUTES = [
    [/\b(studio|home|orb|3d)\b/, "/"],
    [/\b(pass|reveal|vip|card|badge)\b/, "/pass"],
    [/\b(blend|stickers?|lab|knockout)\b/, "/stickers"],
    [/\b(inspector|tools page|devtools|registry)\b/, "/inspector"],
]


const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

/** Pull out quoted strings so their words don't trigger shape/colour intents. */
function extractQuoted(input) {
    const quotes = []
    const stripped = input.replace(/["“”'‘’]([^"“”'‘’]{1,40})["“”'‘’]/g, (_, q) => {
        quotes.push(q.trim())
        return " __Q" + (quotes.length - 1) + "__ "
    })
    return { stripped, quotes }
}

/**
 * @returns {{ steps: Array<{tool:string,args:object,say?:string}>, reply?: string }}
 */
export function plan(raw) {
    const input = String(raw || "").trim()
    if (!input) return { steps: [] }
    const { stripped, quotes } = extractQuoted(input)
    const s = stripped.toLowerCase()
    const found = [] // { at, step }
    const add = (re, step) => {
        const m = s.match(re)
        if (m) found.push({ at: m.index, step })
        return !!m
    }

    // --- meta / discovery -------------------------------------------------
    if (/\b(help|what can you do|capabilit|list tools|which tools|what tools)\b/.test(s)) {
        return { steps: [{ tool: "get_current_route", args: {}, say: "Asking the page what it exposes right now…" }] }
    }
    if (/\b(describe|what is this page|page info|about this page)\b/.test(s)) {
        return { steps: [{ tool: "get_page_info", args: {}, say: "Reading the page's own metadata…" }] }
    }

    // --- surprise ---------------------------------------------------------
    if (/\b(surprise|random|wow me|show off|go wild|demo)\b/.test(s)) {
        const shape = pick(["knot", "blob", "crystal", "torus", "cube"])
        const colorName = pick(["pink", "cyan", "lime", "violet", "orange", "gold"])
        const finish = pick(["chrome", "holo", "glass", "wire"])
        return {
            steps: [
                { tool: "sculpt_shape", args: { shape } },
                { tool: "paint", args: { color: COLORS[colorName] } },
                { tool: "set_finish", args: { finish } },
                { tool: "set_spin", args: { speed: 3.5 } },
                { tool: "burst", args: {} },
                { tool: "set_headline", args: { text: pick(["AGENT MADE", "NO CLICKS", "TOOLS > PIXELS", "HELLO HUMAN"]) } },
            ],
        }
    }

    // --- navigation (only when explicitly asked) --------------------------
    const nav = s.match(/\b(go to|open|show me|take me to|navigate to|switch to|visit)\b(.*)$/)
    if (nav) {
        for (const [re, path] of ROUTES) {
            if (re.test(nav[2])) {
                found.push({ at: nav.index, step: { tool: "navigate", args: { path } } })
                break
            }
        }
    }

    // --- dimension (3D vs 2D) --------------------------------------------
    if (/\b(toggle 3d|toggle 2d|toggle dimension|switch dimension)\b/.test(s)) {
        add(/\b(toggle 3d|toggle 2d|toggle dimension|switch dimension)\b/, { tool: "toggle_dimension", args: {} })
    } else if (/\b(2d|flat mode|flat vector|flat stencil|go 2d|switch to 2d|make it 2d)\b/.test(s)) {
        add(/\b(2d|flat mode|flat vector|flat stencil|go 2d|switch to 2d|make it 2d)\b/, { tool: "set_dimension", args: { mode: "2d" } })
    } else if (/\b(3d mode|webgl mode|go 3d|switch to 3d|back to 3d|make it 3d)\b/.test(s)) {
        add(/\b(3d mode|webgl mode|go 3d|switch to 3d|back to 3d|make it 3d)\b/, { tool: "set_dimension", args: { mode: "3d" } })
    }

    // --- device viewport (desktop vs mobile frame) ------------------------
    if (/\b(mobile view|phone view|mobile frame|show mobile|simulate mobile|switch to mobile|iphone view)\b/.test(s)) {
        add(/\b(mobile view|phone view|mobile frame|show mobile|simulate mobile|switch to mobile|iphone view)\b/, { tool: "set_device_view", args: { view: "mobile" } })
    } else if (/\b(desktop view|desktop frame|show desktop|switch to desktop|full view|exit mobile)\b/.test(s)) {
        add(/\b(desktop view|desktop frame|show desktop|switch to desktop|full view|exit mobile)\b/, { tool: "set_device_view", args: { view: "desktop" } })
    } else if (/\b(toggle mobile|toggle device|toggle viewport)\b/.test(s)) {
        add(/\b(toggle mobile|toggle device|toggle viewport)\b/, { tool: "toggle_device_view", args: {} })
    }

    // --- creation journey & grand reveal ----------------------------------
    if (/\b(start journey|creation journey|genesis|start quest|guide me|journey)\b/.test(s)) {
        add(/\b(start journey|creation journey|genesis|start quest|guide me|journey)\b/, { tool: "start_journey", args: {} })
    }
    if (/\b(grand reveal|reveal pass|the reveal|reveal artifact|reveal)\b/.test(s)) {
        add(/\b(grand reveal|reveal pass|the reveal|reveal artifact|reveal)\b/, { tool: "trigger_grand_reveal", args: {} })
    }
    if (/\b(explode layers?|explode view|exploded view|split layers?)\b/.test(s)) {
        add(/\b(explode layers?|explode view|exploded view|split layers?)\b/, { tool: "toggle_exploded_view", args: { exploded: true } })
    } else if (/\b(collapse layers?|unexplode|reset layers?)\b/.test(s)) {
        add(/\b(collapse layers?|unexplode|reset layers?)\b/, { tool: "toggle_exploded_view", args: { exploded: false } })
    }
    if (/\b(peel corner|peel card|peel sticker|peel)\b/.test(s)) {
        add(/\b(peel corner|peel card|peel sticker|peel)\b/, { tool: "toggle_peel", args: { peeled: true } })
    } else if (/\b(unpeel|reset peel)\b/.test(s)) {
        add(/\b(unpeel|reset peel)\b/, { tool: "toggle_peel", args: { peeled: false } })
    }

    // --- archetypes & auto-synthesis --------------------------------------
    if (/\b(mecha|cyber mecha)\b/.test(s) && !/sticker/.test(s)) {
        add(/\b(mecha|cyber mecha)\b/, { tool: "apply_archetype", args: { archetype: "mecha" } })
    } else if (/\b(deity|celestial|astral)\b/.test(s)) {
        add(/\b(deity|celestial|astral)\b/, { tool: "apply_archetype", args: { archetype: "deity" } })
    } else if (/\b(anomaly|quantum anomaly)\b/.test(s)) {
        add(/\b(anomaly|quantum anomaly)\b/, { tool: "apply_archetype", args: { archetype: "anomaly" } })
    } else if (/\b(phantom|neon phantom)\b/.test(s)) {
        add(/\b(phantom|neon phantom)\b/, { tool: "apply_archetype", args: { archetype: "phantom" } })
    }

    // --- living story & character commands --------------------------------
    if (/\b(tired|rest by fire|camp|campfire|sleep|make camp)\b/.test(s)) {
        return {
            steps: [
                { tool: "world_setTimeOfDay", args: { time: "night", timeString: "21:30 PM" } },
                { tool: "character_chooseState", args: { decision: "tired", action: "rest_by_fire" } },
            ],
            reply: "It's getting late. Settle by the campfire and rest under the stars.",
        }
    }
    if (/\b(play|playful|starlight|chase stars|play with orb|orb toy)\b/.test(s)) {
        return {
            steps: [
                { tool: "world_setTimeOfDay", args: { time: "night", timeString: "21:30 PM" } },
                { tool: "character_chooseState", args: { decision: "playful", action: "chase_starlight" } },
            ],
            reply: "The night is alive! Summoning the Starlight Orb to play under the moon.",
        }
    }
    if (/\b(crossroads|hike trail|walk trail|walk to crossroads)\b/.test(s)) {
        return {
            steps: [
                { tool: "character_move", args: { destination: "crossroads" } },
                { tool: "character_updateEnergy", args: { energyChange: -50, reason: "hiking trail" } },
                { tool: "world_setTimeOfDay", args: { time: "dusk", timeString: "18:45 PM" } },
            ],
            reply: "Heading toward the Crossroads as dusk begins to fall.",
        }
    }
    if (/\b(monolith|ancient monolith|approach monolith)\b/.test(s)) {
        return {
            steps: [
                { tool: "character_move", args: { destination: "monolith" } },
                { tool: "world_interactObject", args: { objectId: "ancient_monolith", interaction: "activate" } },
                { tool: "relic_triggerReveal", args: { cardTitle: "MONOLITH PILGRIM" } },
            ],
            reply: "Approaching the Ancient Monolith to awaken the cosmic relic!",
        }
    }
    if (/\b(night|night time|make it night|stars|moon)\b/.test(s)) {
        add(/\b(night|night time|make it night|stars|moon)\b/, { tool: "world_setTimeOfDay", args: { time: "night", timeString: "21:30 PM" } })
    } else if (/\b(dusk|twilight|sunset)\b/.test(s)) {
        add(/\b(dusk|twilight|sunset)\b/, { tool: "world_setTimeOfDay", args: { time: "dusk", timeString: "18:45 PM" } })
    } else if (/\b(day|day time|sun|morning|midday)\b/.test(s)) {
        add(/\b(day|day time|sun|morning|midday)\b/, { tool: "world_setTimeOfDay", args: { time: "day", timeString: "11:00 AM" } })
    }
    if (/\b(roll character|new character|surprise character|awaken character)\b/.test(s)) {
        add(/\b(roll character|new character|surprise character|awaken character)\b/, { tool: "character_reveal", args: {} })
    }
    if (/\b(talk to elder byte|speak with sage|talk to npc|ask elder byte)\b/.test(s)) {
        add(/\b(talk to elder byte|speak with sage|talk to npc|ask elder byte)\b/, {
            tool: "npc_interact",
            args: { npcName: "Elder Byte", dialogue: "Halt traveler! The stars are rising. You look exhausted... or do you still have the energy to play?" },
        })
    }

    if (/\b(auto mode|auto synthesize|build something crazy|crazy hero|crazy entity|random hero|make a crazy)\b/.test(s)) {
        add(/\b(auto mode|auto synthesize|build something crazy|crazy hero|crazy entity|random hero|make a crazy)\b/, { tool: "auto_synthesize_entity", args: {} })
    }



    // --- stickers (blend lab) --------------------------------------------
    const stickerRe = /\b(sticker|stick|slap|label|tape)\b/
    const wantsSticker = stickerRe.test(s)
    if (wantsSticker) {
        let text = null
        const qi = s.match(/__q(\d+)__/)
        if (qi) text = quotes[Number(qi[1])]
        if (!text) {
            const m = input.match(/(?:saying|that says|reading|with the text|with text|says|:)\s+(.{1,32})$/i)
            if (m) text = m[1].trim()
        }
        if (!text) text = pick(["AGENT WAS HERE", "WEBMCP", "NO SCRAPING", "TOOLS!"])
        const blend = BLENDS.find((b) => s.includes(b)) || "multiply"
        found.push({ at: s.search(stickerRe), step: { tool: "add_sticker", args: { text: text.toUpperCase(), blend } } })
    }
    add(/\b(clear|remove all|wipe|reset|delete all)\b.*\bstickers?\b/, { tool: "clear_stickers", args: {} })
    if (/\b(backdrop|background|bg)\b/.test(s)) {
        const preset = BACKDROPS.find((b) => s.includes(b))
        if (preset) add(/\b(backdrop|background|bg)\b/, { tool: "set_backdrop", args: { preset } })
    }
    add(/\b(list|show|read)\b.*\bstickers\b/, { tool: "list_stickers", args: {} })

    // --- headline (studio) ------------------------------------------------
    if (!wantsSticker) {
        const hm = s.match(/\b(headline|title|write|say|text)\b[^_]*__q(\d+)__/)
        if (hm) {
            found.push({ at: hm.index, step: { tool: "set_headline", args: { text: quotes[Number(hm[2])].toUpperCase() } } })
        } else {
            const hm2 = input.match(/\b(?:headline|title)\s+(?:to\s+)?(.{1,24})$/i)
            if (hm2) found.push({ at: s.search(/\b(headline|title)\b/), step: { tool: "set_headline", args: { text: hm2[1].toUpperCase() } } })
        }
    }

    // --- sculpture (studio) — skipped when the command is about stickers ---
    if (!wantsSticker && !/\b(backdrop|background|bg)\b/.test(s)) {
        for (const [re, shape] of SHAPE_WORDS) if (add(re, { tool: "sculpt_shape", args: { shape } })) break
        for (const [re, finish] of FINISH_WORDS) if (add(re, { tool: "set_finish", args: { finish } })) break

        const hex = s.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/)
        if (hex) found.push({ at: hex.index, step: { tool: "paint", args: { color: hex[0] } } })
        else {
            for (const name of Object.keys(COLORS)) {
                const re = new RegExp(`\\b${name}\\b`)
                if (add(re, { tool: "paint", args: { color: COLORS[name] } })) break
            }
        }
    }

    const spinNum = s.match(/\bspin\w*\s+(?:at\s+|to\s+)?(\d+(?:\.\d+)?)/)
    if (spinNum) found.push({ at: spinNum.index, step: { tool: "set_spin", args: { speed: Number(spinNum[1]) } } })
    else if (/\b(stop|freeze|pause)\b/.test(s) && !/sticker/.test(s)) add(/\b(stop|freeze|pause)\b/, { tool: "set_spin", args: { speed: 0 } })
    else if (/\b(crazy|insane|max|turbo)\b/.test(s)) add(/\b(crazy|insane|max|turbo)\b/, { tool: "set_spin", args: { speed: 6 } })
    else if (/\b(fast|faster|quick)\b/.test(s)) add(/\b(fast|faster|quick)\b/, { tool: "set_spin", args: { speed: 3.5 } })
    else if (/\b(slow|slower|chill|calm)\b/.test(s)) add(/\b(slow|slower|chill|calm)\b/, { tool: "set_spin", args: { speed: 0.4 } })
    else if (/\bspin\b/.test(s)) add(/\bspin\b/, { tool: "set_spin", args: { speed: 2 } })

    add(/\b(burst|explode|boom|bang|pop|confetti|kaboom)\b/, { tool: "burst", args: {} })
    add(/\b(state|status|current shape|what does it look like|scene)\b/, { tool: "get_scene", args: {} })

    found.sort((a, b) => a.at - b.at)
    const steps = found.map((f) => f.step)

    if (!steps.length) {
        return {
            steps: [],
            reply:
                "I only know what this site's WebMCP tools let me do. Try “make it a pink chrome knot”, " +
                "“slap a sticker saying 'HELLO' with screen blend”, or “what can you do?”.",
        }
    }
    return { steps }
}
