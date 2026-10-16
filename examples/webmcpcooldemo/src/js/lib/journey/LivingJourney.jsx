import React, { useState, useRef, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { useTool, invokeTool } from "catalyst-core/webmcp"
import { WAYPOINTS } from "../three/StoryWorldScene.js"
import TopStoryHud from "./TopStoryHud.jsx"
import CleanJourneyPass from "../card/CleanJourneyPass.jsx"
import {
    playClick,
    playBurstSound,
    playGrandReveal,
    playFootstep,
    playCampfire,
    playPlayfulChimes,
    playNpcVoice,
} from "../audio/sounds.js"
import css from "./LivingJourney.scss"

const ARCHETYPE_ROSTER = [
    { name: "Pip", title: "THE OVERCLOCKED SLOTH", color: "#c6ff3d", desc: "Small, clumsy, but radiates overclocked quantum kinetic energy!" },
    { name: "Boba-Bot", title: "THE STARLIGHT WANDERER", color: "#3de0ff", desc: "A bouncy chrome dreamer fueled by ambient starlight and curiosity." },
    { name: "Gizmo", title: "THE POCKET VANGUARD", color: "#ffb23d", desc: "Equipped with mini radar ears and an insatiable desire to explore." },
    { name: "Puff-99", title: "THE QUANTUM PUFFER", color: "#ff3ea5", desc: "Bounces through dimensional rifts and leaves glowing stardust footprints." },
]

// ============================================================================
// SPATIAL PROXIMITY WEBMCP TOOLS
// These components mount ONLY when Pip is within 1.35m radius of an item!
// When Pip walks away, the component unmounts and unregisters the tool.
// ============================================================================

/** 1. Campfire Spatial Tool */
function CampfireSpatialTool({ isLit, onIgnite, onRest }) {
    useTool({
        name: isLit ? "rest_by_campfire" : "ignite_campfire",
        description: isLit
            ? "Rest by the roaring campfire logs to replenish Pip's stamina to 100% and bask in the warm glow."
            : "Ignite the cozy campfire logs with a spark to warm up the frontier and light the night.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
            if (isLit) {
                return onRest()
            }
            return onIgnite()
        },
    }, [isLit])
    return null
}

/** 2. Elder Byte Sage Sentinel Spatial Tool */
function ElderByteSpatialTool({ onTalk }) {
    useTool({
        name: "talk_to_sage",
        description: "Consult Elder Byte, the ancient hovering cyber sage drone, for guidance, starlight wisdom, or quest lore.",
        inputSchema: {
            type: "object",
            properties: {
                topic: {
                    type: "string",
                    enum: ["wisdom", "path", "stars", "riddle"],
                    description: "Topic of conversation with Elder Byte",
                },
            },
        },
        execute: async ({ topic } = {}) => onTalk(topic),
    })
    return null
}

/** 3. Quantum Berry Bush Spatial Tool */
function BerryBushSpatialTool({ isHarvested, onHarvest }) {
    useTool({
        name: "harvest_energy_berries",
        description: isHarvested
            ? "Inspect the harvested quantum bush (berries will regrow on the next dawn cycle)."
            : "Harvest neon starlight berries from the quantum bush to replenish +45 character stamina.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => onHarvest(),
    }, [isHarvested])
    return null
}

/** 4. Starlight Relic Chest Spatial Tool */
function RelicChestSpatialTool({ isOpened, onOpen }) {
    useTool({
        name: "open_relic_chest",
        description: isOpened
            ? "Inspect the opened starlight relic chest and admire the claimed holographic quest pass."
            : "Unlock the starlight relic chest to reveal the grand 3D holographic quest chronicle pass!",
        inputSchema: { type: "object", properties: {} },
        execute: async () => onOpen(),
    }, [isOpened])
    return null
}

/** 5. Ancient Monolith Spatial Tool */
function MonolithSpatialTool({ isResonated, onResonate }) {
    useTool({
        name: "resonate_monolith",
        description: "Channel quantum resonance through the ancient obsidian monolith, unleashing celestial particle rings.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => onResonate(),
    }, [isResonated])
    return null
}

// Base Camp customization is registered as a global tool below to ensure reliable execution anytime.

// ============================================================================
// MAIN COMPONENT: LivingJourney
// ============================================================================
export default function LivingJourney({
    sceneController, // StoryWorldScene controller
    onSetSceneColor,
    coordinates,
}) {
    // ---- Character State ----
    const [character, setCharacter] = useState({
        name: "Pip",
        archetype: "THE OVERCLOCKED SLOTH",
        color: "#c6ff3d",
        energy: 100,
        mood: "energetic", // "energetic" | "tired" | "playful" | "resting"
    })

    // ---- World & Environmental State ----
    const [timeOfDay, setTimeOfDay] = useState("day") // "dawn" | "day" | "dusk" | "night"
    const [timeString, setTimeString] = useState("10:00 AM")
    const [dayNumber, setDayNumber] = useState(1)
    const [soundEnabled, setSoundEnabled] = useState(true)
    const [journeyMode, setJourneyMode] = useState("interactive") // "interactive" | "auto"
    const [isAutoPlaying, setIsAutoPlaying] = useState(false)

    // ---- Interactive Item Milestone States ----
    const [campfireLit, setCampfireLit] = useState(false)
    const [talkedToSage, setTalkedToSage] = useState(false)
    const [berriesHarvested, setBerriesHarvested] = useState(false)
    const [monolithResonated, setMonolithResonated] = useState(false)
    const [chestOpened, setChestOpened] = useState(false)
    const [npcDialogue, setNpcDialogue] = useState(null)
    const [distanceTraveled, setDistanceTraveled] = useState(4.2)

    // Climax / Grand Reveal Modal State
    const [revealOpen, setRevealOpen] = useState(false)

    const autoPlayRef = useRef(false)
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    // Helper: Trigger procedural footstep sound bursts
    const triggerFootstepAudio = useCallback(() => {
        if (!soundEnabled) return
        for (let i = 0; i < 3; i++) {
            setTimeout(() => playFootstep(soundEnabled), i * 140)
        }
    }, [soundEnabled])

    // ========================================================================
    // GLOBAL WEBMCP TOOLS (Always active across open world)
    // ONLY movement and camera tools are active when roaming open ground!
    // ========================================================================

    // Global Tool 1: Move Character (waypoint or x/z)
    useTool({
        name: "character_move",
        description:
            "Move the cute character in 3D space to explore. Destination can be a landmark waypoint ('start', 'campfire', 'crossroads', 'clearing', 'chest', 'monolith') or custom { x, z } coordinates. Walking Pip to a landmark dynamically loads its WebMCP tool (e.g. waypoint 'chest' activates open_relic_chest to unlock the reveal pass).",
        inputSchema: {
            type: "object",
            properties: {
                destination: {
                    type: "string",
                    enum: ["start", "campfire", "crossroads", "clearing", "chest", "monolith"],
                    description: "Target landmark waypoint: 'start' (Base Camp), 'campfire' (Campfire), 'crossroads' (Elder Byte Sage), 'clearing' (Quantum Berry Bush), 'monolith' (Ancient Monolith), 'chest' (Starlight Relic Chest - UNLOCKS REVEAL PASS)",
                },
                x: { type: "number", description: "Target X coordinate in 3D space (-5.0 to 5.0)" },
                z: { type: "number", description: "Target Z coordinate in 3D space (-3.5 to 3.5)" },
            },
        },
        execute: async ({ destination, x, z }) => {
            let res
            if (destination) {
                if (sceneController) {
                    res = sceneController.moveTo(destination)
                }
            } else if (typeof x === "number") {
                if (sceneController) {
                    res = sceneController.moveTo({ x, z: z || 0 })
                }
            }
            triggerFootstepAudio()
            setDistanceTraveled((d) => Number((d + 2.4).toFixed(1)))

            return {
                ok: true,
                destination: destination || `custom [${x}, ${z}]`,
                result: res,
                message: `${character.name} is walking toward ${destination ? destination.toUpperCase() : `3D coordinates [${x}, ${z}]`}`,
            }
        },
    })

    // Global Tool 2: Directional 3D Step
    useTool({
        name: "character_move_in_3d",
        description: "Move the character in 3D space step-by-step (forward, back, left, right) or to custom coordinates.",
        inputSchema: {
            type: "object",
            properties: {
                direction: { type: "string", enum: ["forward", "back", "left", "right"], description: "Directional step" },
                distance: { type: "number", description: "Distance to step (default 0.75)" },
                x: { type: "number", description: "Absolute 3D X coordinate" },
                z: { type: "number", description: "Absolute 3D Z coordinate" },
            },
        },
        execute: async ({ direction, distance, x, z }) => {
            let res
            if (direction) {
                res = sceneController ? sceneController.moveDirection(direction, distance || 0.75) : { ok: true }
            } else if (typeof x === "number") {
                res = sceneController ? sceneController.moveTo({ x, z: z || 0 }) : { ok: true }
            }
            triggerFootstepAudio()
            setDistanceTraveled((d) => Number((d + 0.8).toFixed(1)))
            return { ok: true, result: res, message: `Character stepped in 3D space` }
        },
    })

    // Global Tool 3: Camera View Mode
    useTool({
        name: "camera_setView",
        description:
            "Set the 3D scene camera viewpoint: 'pov' (comfortable over-the-shoulder third-person camera following Pip), 'cinematic' (smooth 3D isometric follow camera tracking Pip everywhere), 'overhead' (tactical map view), or 'closeup' (close face view).",
        inputSchema: {
            type: "object",
            properties: {
                mode: { type: "string", enum: ["pov", "cinematic", "overhead", "closeup"], description: "Camera viewpoint preset" },
            },
            required: ["mode"],
        },
        execute: async ({ mode }) => {
            if (sceneController) {
                sceneController.setCameraMode(mode)
            }
            return { ok: true, cameraMode: mode, message: `Camera switched to ${mode.toUpperCase()} view` }
        },
    })

    // Global Tool 4: Play with Character
    useTool({
        name: "character_play",
        description:
            "Play with Pip! Triggers a joyful acrobatic jump-spin dance animation, celebratory quantum starlight sparkles, cheerful chimes, and playful facial expressions. Pip's happiness and energy are boosted to maximum.",
        inputSchema: {
            type: "object",
            properties: {
                activity: {
                    type: "string",
                    enum: ["dance", "spin", "jump", "celebrate"],
                    description: "Playful action to perform with Pip (default 'dance')",
                },
            },
        },
        execute: async ({ activity = "dance" } = {}) => {
            if (sceneController) {
                sceneController.setAction("play")
                sceneController.setExpression("playful")
                sceneController.burst()
            }
            setCharacter((prev) => ({
                ...prev,
                mood: "playful",
                energy: 100,
            }))
            playPlayfulChimes(soundEnabled)
            return {
                ok: true,
                activity,
                mood: "playful",
                energy: 100,
                message: `🎉 You played with ${character.name}! Pip performed a joyful acrobatic ${activity} dance with radiant starlight sparkles, glowing playful eyes, and is filled with maximum happiness and energy!`,
            }
        },
    })

    // Global Tool 5: Survey & Explore Landmarks
    useTool({
        name: "world_explore_landmarks",
        description:
            "Explore and survey all 6 interactive landmarks across the 3D living quest world: Base Camp ('start'), Cozy Campfire ('campfire'), Elder Byte ('crossroads'), Quantum Berry Bush ('clearing'), Ancient Monolith ('monolith'), and Starlight Relic Chest ('chest'). Returns each landmark's name, waypoint, 3D coordinates, distance from Pip, interaction tool, and reveals which object unlocks the Grand Holographic Quest Chronicle Reveal Pass.",
        inputSchema: {
            type: "object",
            properties: {},
        },
        execute: async () => {
            const charPos = sceneController ? sceneController.getCharacterPosition() : { x: 0, z: 0 }
            const landmarks = Object.entries(WAYPOINTS).map(([key, wp]) => {
                const dist = Number(Math.hypot(charPos.x - wp.x, charPos.z - wp.z).toFixed(2))
                const givesRevealPass = key === "chest"
                return {
                    id: wp.id,
                    name: wp.name,
                    itemTitle: wp.itemTitle,
                    icon: wp.icon,
                    coordinates: { x: wp.x, z: wp.z },
                    distanceFromPip: `${dist}m`,
                    interactionTool: wp.toolName,
                    givesRevealPass,
                    description: {
                        start: "Frontier Base Camp: Customize Pip's archetype, name, and color theme.",
                        campfire: "Cozy Campfire: Ignite campfire logs to warm the twilight clearing, or rest to restore stamina.",
                        crossroads: "Elder Byte Sage Drone: Consult ancient cyber sage for starlight wisdom and riddles.",
                        clearing: "Quantum Berry Bush: Harvest glowing neon starlight berries (+45 stamina).",
                        monolith: "Ancient Monolith: Channel quantum resonance through celestial particle rings.",
                        chest: "✨ STARLIGHT RELIC CHEST: THIS OBJECT UNLOCKS THE GRAND 3D HOLOGRAPHIC REVEAL PASS! Move Pip to waypoint 'chest' and call open_relic_chest.",
                    }[key],
                }
            })

            return {
                ok: true,
                characterPosition: { x: charPos.x, z: charPos.z },
                revealPassObject: {
                    waypoint: "chest",
                    name: "Starlight Relic Chest",
                    icon: "✨",
                    coordinates: { x: WAYPOINTS.chest.x, z: WAYPOINTS.chest.z },
                    howToUnlock: "Move Pip to waypoint 'chest' using character_move({ destination: 'chest' }), then call open_relic_chest() to claim the Grand 3D Holographic Quest Chronicle Pass!",
                },
                landmarks,
                message: "World survey complete: 6 landmarks explored. The Starlight Relic Chest at waypoint 'chest' [x: 2.2, z: -1.5] is the object that unlocks the Grand Reveal Pass!",
            }
        },
    })

    // ========================================================================
    // SPATIAL ACTION HANDLERS (Called by spatial WebMCP tools or UI buttons)
    // ========================================================================

    const handleIgniteCampfire = useCallback(() => {
        if (sceneController) {
            sceneController.igniteCampfire()
            sceneController.setAction("idle")
            sceneController.setExpression("happy")
        }
        setCampfireLit(true)
        playCampfire(soundEnabled)
        setTimeOfDay("dusk")
        setTimeString("19:15 PM")
        return {
            ok: true,
            action: "ignite_campfire",
            campfireLit: true,
            message: "🔥 Cozy Campfire ignited! Warm embers illuminate the twilight clearing.",
        }
    }, [sceneController, soundEnabled])

    const handleRestCampfire = useCallback(() => {
        if (sceneController) {
            sceneController.setAction("rest")
            sceneController.setExpression("tired")
        }
        setCharacter((prev) => ({ ...prev, energy: 100, mood: "resting" }))
        playCampfire(soundEnabled)
        return {
            ok: true,
            action: "rest_by_campfire",
            energy: 100,
            status: "Well Rested",
            message: "☕ Pip rested peacefully by the fire. Stamina fully replenished to 100%!",
        }
    }, [sceneController, soundEnabled])

    const handleTalkToSage = useCallback((topic = "wisdom") => {
        if (sceneController) {
            sceneController.sageSpeak()
        }
        setTalkedToSage(true)
        playNpcVoice(soundEnabled)

        const lore = {
            wisdom: "The starlight remembers every step you take in 3D space. Explore the clearing to harvest glowing berries!",
            path: "Eastward lies the Ancient Monolith, and past the glade awaits the Starlight Relic Chest.",
            stars: "When twilight falls, the skybox twinkles with procedural cosmic clusters.",
            riddle: "I have no legs, yet I hover; no mouth, yet I transmit WebMCP schemas. What am I? A Sage Drone!",
        }[topic] || "Greetings, explorer! Your journey across the frontier has awakened ancient tools."

        setNpcDialogue(lore)
        return {
            ok: true,
            action: "talk_to_sage",
            topic,
            dialogue: lore,
            message: `Elder Byte: "${lore}"`,
        }
    }, [sceneController, soundEnabled])

    const handleHarvestBerries = useCallback(() => {
        if (sceneController) {
            sceneController.harvestBerries()
            sceneController.setExpression("playful")
        }
        setBerriesHarvested(true)
        setCharacter((prev) => ({
            ...prev,
            energy: Math.min(100, prev.energy + 45),
            mood: "playful",
        }))
        playPlayfulChimes(soundEnabled)
        return {
            ok: true,
            action: "harvest_energy_berries",
            berriesHarvested: true,
            staminaRestored: 45,
            message: "🍇 Quantum energy berries harvested! +45 Stamina restored to Pip.",
        }
    }, [sceneController, soundEnabled])

    const handleResonateMonolith = useCallback(() => {
        if (sceneController) {
            sceneController.activateMonolith()
            sceneController.burst()
        }
        setMonolithResonated(true)
        playBurstSound(soundEnabled)
        return {
            ok: true,
            action: "resonate_monolith",
            monolithResonated: true,
            message: "🏛️ Ancient Monolith resonated! Dual cosmic rings accelerate, casting radiant shockwaves.",
        }
    }, [sceneController, soundEnabled])

    const handleOpenRelicChest = useCallback(() => {
        if (sceneController) {
            sceneController.openChest()
            sceneController.burst()
        }
        setChestOpened(true)
        setRevealOpen(true)
        playGrandReveal(soundEnabled)
        return {
            ok: true,
            action: "open_relic_chest",
            chestOpened: true,
            relicRevealed: true,
            message: "✨ Starlight Relic Chest opened! 3D Holographic Quest Chronicle pass unlocked.",
        }
    }, [sceneController, soundEnabled])

    const handleCustomizeCharacter = useCallback(({ name, archetype, color } = {}) => {
        const chosenArch = ARCHETYPE_ROSTER[Math.floor(Math.random() * ARCHETYPE_ROSTER.length)]
        const finalName = name || chosenArch.name
        const finalTitle = archetype || chosenArch.title
        const finalColor = color || chosenArch.color

        setCharacter({
            name: finalName,
            archetype: finalTitle,
            color: finalColor,
            energy: 100,
            mood: "energetic",
        })

        if (sceneController) {
            sceneController.setColor(finalColor)
            sceneController.burst()
        }
        if (onSetSceneColor) onSetSceneColor(finalColor)
        playBurstSound(soundEnabled)

        return {
            ok: true,
            action: "customize_character",
            character: { name: finalName, archetype: finalTitle, color: finalColor },
            message: `Terminal updated: ${finalName} — ${finalTitle} ready for expedition!`,
        }
    }, [sceneController, onSetSceneColor, soundEnabled])

    // Global Tool 6: Customize Character (Terminal available anytime)
    useTool({
        name: "customize_character",
        description: "Access character customization to re-roll or customize Pip's archetype, name, and color theme.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Character name" },
                archetype: { type: "string", description: "Character archetype or title" },
                color: { type: "string", description: "Accent hex color" },
            },
        },
        execute: async (args = {}) => handleCustomizeCharacter(args),
    })

    // ========================================================================
    // AUTO DIRECTOR DEMO LOOP
    // Autonomously steps Pip through landmarks, letting spatial tools load,
    // and invoking each loaded tool in sequence.
    // ========================================================================
    const startAutoDirector = async () => {
        if (isAutoPlaying) {
            autoPlayRef.current = false
            setIsAutoPlaying(false)
            return
        }

        setIsAutoPlaying(true)
        autoPlayRef.current = true
        setJourneyMode("auto")

        try {
            // Beat 1: Walk to Campfire -> wait for radius -> invoke ignite_campfire
            if (!autoPlayRef.current) return
            await invokeTool("character_move", { destination: "campfire" })
            await sleep(2800)
            if (!autoPlayRef.current) return
            await invokeTool("ignite_campfire", {})
            await sleep(2200)

            // Beat 2: Walk to Elder Byte -> wait for radius -> invoke talk_to_sage
            if (!autoPlayRef.current) return
            await invokeTool("character_move", { destination: "crossroads" })
            await sleep(2600)
            if (!autoPlayRef.current) return
            await invokeTool("talk_to_sage", { topic: "wisdom" })
            await sleep(2600)

            // Beat 3: Walk to Berry Bush -> wait for radius -> invoke harvest_energy_berries
            if (!autoPlayRef.current) return
            await invokeTool("character_move", { destination: "clearing" })
            await sleep(2800)
            if (!autoPlayRef.current) return
            await invokeTool("harvest_energy_berries", {})
            await sleep(2200)

            // Beat 4: Walk to Ancient Monolith -> wait for radius -> invoke resonate_monolith
            if (!autoPlayRef.current) return
            await invokeTool("character_move", { destination: "monolith" })
            await sleep(3000)
            if (!autoPlayRef.current) return
            await invokeTool("resonate_monolith", {})
            await sleep(2400)

            // Beat 5: Walk to Starlight Chest -> wait for radius -> invoke open_relic_chest
            if (!autoPlayRef.current) return
            await invokeTool("character_move", { destination: "chest" })
            await sleep(2800)
            if (!autoPlayRef.current) return
            await invokeTool("open_relic_chest", {})
        } catch (err) {
            console.error("Auto Director error:", err)
        } finally {
            setIsAutoPlaying(false)
            autoPlayRef.current = false
        }
    }

    // Determine current active proximity item from coordinates
    const proximity = coordinates?.proximity
    const currentProxKey = proximity?.key

    // Milestone tracking for the clean holographic card
    const milestonesList = [
        { id: "start", label: "Frontier Base Expedition Prepared", icon: "🏕️", completed: true },
        { id: "fire", label: "Cozy Campfire Ignited & Rested", icon: "🔥", completed: campfireLit },
        { id: "sage", label: "Elder Byte Cosmic Wisdom Consulted", icon: "🧭", completed: talkedToSage },
        { id: "berries", label: "Quantum Energy Berries Harvested", icon: "🍇", completed: berriesHarvested },
        { id: "monolith", label: "Ancient Monolith Cosmic Resonance", icon: "🏛️", completed: monolithResonated },
        { id: "chest", label: "Starlight Relic Chest Unlocked", icon: "✨", completed: chestOpened },
    ]

    // Determine active loaded tool name for UI display
    let activeToolName = null
    let activeToolAction = null
    if (currentProxKey === "campfire") {
        activeToolName = campfireLit ? "rest_by_campfire" : "ignite_campfire"
        activeToolAction = campfireLit ? handleRestCampfire : handleIgniteCampfire
    } else if (currentProxKey === "crossroads") {
        activeToolName = "talk_to_sage"
        activeToolAction = () => handleTalkToSage("wisdom")
    } else if (currentProxKey === "clearing") {
        activeToolName = "harvest_energy_berries"
        activeToolAction = handleHarvestBerries
    } else if (currentProxKey === "chest") {
        activeToolName = "open_relic_chest"
        activeToolAction = handleOpenRelicChest
    } else if (currentProxKey === "monolith") {
        activeToolName = "resonate_monolith"
        activeToolAction = handleResonateMonolith
    } else if (currentProxKey === "start") {
        activeToolName = "customize_character"
        activeToolAction = () => handleCustomizeCharacter()
    }

    return (
        <div className={css.livingJourneyContainer}>
            {/* ============================================================ */}
            {/* SPATIAL WEBMCP TOOL MOUNT GATES                              */}
            {/* Loaded ONLY when Pip is within 1.35m radius of each object!  */}
            {/* ============================================================ */}
            {currentProxKey === "campfire" && (
                <CampfireSpatialTool
                    isLit={campfireLit}
                    onIgnite={handleIgniteCampfire}
                    onRest={handleRestCampfire}
                />
            )}
            {currentProxKey === "crossroads" && (
                <ElderByteSpatialTool onTalk={handleTalkToSage} />
            )}
            {currentProxKey === "clearing" && (
                <BerryBushSpatialTool
                    isHarvested={berriesHarvested}
                    onHarvest={handleHarvestBerries}
                />
            )}
            {currentProxKey === "chest" && (
                <RelicChestSpatialTool
                    isOpened={chestOpened}
                    onOpen={handleOpenRelicChest}
                />
            )}
            {currentProxKey === "monolith" && (
                <MonolithSpatialTool
                    isResonated={monolithResonated}
                    onResonate={handleResonateMonolith}
                />
            )}

            {/* Top HUD Overlay (Always Visible) */}
            <TopStoryHud
                characterName={character.name}
                archetypeTitle={character.archetype}
                energy={character.energy}
                timeOfDay={timeOfDay}
                timeString={timeString}
                dayNumber={dayNumber}
                characterMood={character.mood}
                coordinates={coordinates}
                mode={journeyMode}
                onToggleMode={() => setJourneyMode((m) => (m === "auto" ? "interactive" : "auto"))}
            />

            {/* ============================================================ */}
            {/* PROXIMITY RADAR & WEBMCP DYNAMIC TOOL STATUS BANNER          */}
            {/* ============================================================ */}
            {proximity ? (
                <div className={css.proximityRadarAlert} role="status">
                    <div className={css.radarPulseIcon}>
                        <span>{proximity.icon}</span>
                    </div>
                    <div className={css.radarContent}>
                        <div className={css.radarTopRow}>
                            <span className={css.radarTargetBadge}>📍 OBJECT IN RADIUS</span>
                            <span className={css.radarDistanceBadge}>{proximity.distance}m away</span>
                        </div>
                        <h4 className={css.radarTitle}>
                            {proximity.name} <span className={css.radarSubtitle}>({proximity.itemTitle})</span>
                        </h4>
                        <div className={css.radarLoadedTool}>
                            <span className={css.toolPill}>⚡ LOADED WEBMCP TOOL:</span>
                            <code className={css.toolCode}>{activeToolName}</code>
                        </div>
                        <p className={css.radarHint}>
                            WebMCP dynamically loaded <code>{activeToolName}</code> onto <code>document.modelContext</code>. AI agent can now choose to fire it!
                        </p>
                    </div>
                    {activeToolAction && (
                        <button
                            className={css.proximityFireBtn}
                            onClick={() => {
                                playClick(soundEnabled)
                                activeToolAction()
                            }}
                            title={`Execute ${activeToolName}`}
                        >
                            ⚡ Fire Action: {activeToolName}
                        </button>
                    )}
                </div>
            ) : (
                <div className={css.openGroundStatus}>
                    <span className={css.openGroundIcon}>🧭</span>
                    <div className={css.openGroundInfo}>
                        <span className={css.openGroundTitle}>OPEN TRAIL — 3D ROAMING</span>
                        <span className={css.openGroundDesc}>
                            Movement, Play &amp; Exploration tools active. Steer Pip within 0.95m of a landmark to dynamically load its spatial WebMCP tool.
                        </span>
                    </div>
                    <span className={css.toolsCountBadge}>⚡ 6 Core Tools Active</span>
                </div>
            )}

            {/* Story Control Deck & Narrative Flow */}
            <div className={css.storyCard}>
                <div className={css.storyHeader}>
                    <div className={css.badgeRow}>
                        <span className={css.stageBadge}>
                            {proximity ? `NEAR: ${proximity.name.toUpperCase()}` : "OPEN TRAIL"}
                        </span>
                        <span className={css.mcpBadge}>
                            {proximity ? `⚡ SPATIAL TOOL ACTIVE: ${activeToolName}` : "⚡ EXPLORING OPEN WORLD"}
                        </span>
                    </div>

                    <div className={css.modeSwitchGroup}>
                        <button
                            className={`${css.directorBtn} ${isAutoPlaying ? css.autoPlaying : ""}`}
                            onClick={startAutoDirector}
                        >
                            {isAutoPlaying ? "⏸ Pause AI Director" : "▶ Start Auto Story (AI Director)"}
                        </button>
                    </div>
                </div>

                {/* NPC Dialogue Box (when active) */}
                {npcDialogue && (
                    <div className={css.npcSpeechBox} role="alert">
                        <div className={css.npcAvatar}>
                            <span>🤖</span>
                        </div>
                        <div className={css.npcSpeechContent}>
                            <div className={css.npcName}>ELDER BYTE (SAGE SENTINEL)</div>
                            <p className={css.npcText}>&ldquo;{npcDialogue}&rdquo;</p>
                        </div>
                    </div>
                )}

                {/* 6 3D World Landmarks Navigation & Milestones Grid */}
                <div className={css.landmarksSection}>
                    <div className={css.sectionLabelRow}>
                        <span className={css.sectionLabel}>3D WORLD ITEMS &amp; LANDMARKS</span>
                        <span className={css.milestoneCount}>
                            {milestonesList.filter((m) => m.completed).length}/{milestonesList.length} MILESTONES COMPLETED
                        </span>
                    </div>

                    <div className={css.landmarksGrid}>
                        {/* 1. Base Camp Terminal */}
                        <div className={`${css.landmarkCard} ${currentProxKey === "start" ? css.landmarkCardActive : ""}`}>
                            <div className={css.landmarkIcon}>🏕️</div>
                            <div className={css.landmarkInfo}>
                                <div className={css.landmarkName}>Frontier Base Camp</div>
                                <div className={css.landmarkStatus}>Terminal Ready • <code>customize_character</code></div>
                            </div>
                            <button
                                className={css.landmarkWalkBtn}
                                onClick={() => {
                                    playClick(soundEnabled)
                                    invokeTool("character_move", { destination: "start" })
                                }}
                            >
                                🚶 Walk
                            </button>
                        </div>

                        {/* 2. Cozy Campfire */}
                        <div className={`${css.landmarkCard} ${currentProxKey === "campfire" ? css.landmarkCardActive : ""}`}>
                            <div className={css.landmarkIcon}>🔥</div>
                            <div className={css.landmarkInfo}>
                                <div className={css.landmarkName}>Cozy Campfire</div>
                                <div className={css.landmarkStatus}>
                                    {campfireLit ? "Roaring Fire ✓" : "Unlit Logs"} • <code>{campfireLit ? "rest_by_campfire" : "ignite_campfire"}</code>
                                </div>
                            </div>
                            <button
                                className={css.landmarkWalkBtn}
                                onClick={() => {
                                    playClick(soundEnabled)
                                    invokeTool("character_move", { destination: "campfire" })
                                }}
                            >
                                🚶 Walk
                            </button>
                        </div>

                        {/* 3. Elder Byte Sage */}
                        <div className={`${css.landmarkCard} ${currentProxKey === "crossroads" ? css.landmarkCardActive : ""}`}>
                            <div className={css.landmarkIcon}>🧭</div>
                            <div className={css.landmarkInfo}>
                                <div className={css.landmarkName}>Elder Byte Sage</div>
                                <div className={css.landmarkStatus}>
                                    {talkedToSage ? "Wisdom Received ✓" : "Hovering Drone"} • <code>talk_to_sage</code>
                                </div>
                            </div>
                            <button
                                className={css.landmarkWalkBtn}
                                onClick={() => {
                                    playClick(soundEnabled)
                                    invokeTool("character_move", { destination: "crossroads" })
                                }}
                            >
                                🚶 Walk
                            </button>
                        </div>

                        {/* 4. Quantum Berry Bush */}
                        <div className={`${css.landmarkCard} ${currentProxKey === "clearing" ? css.landmarkCardActive : ""}`}>
                            <div className={css.landmarkIcon}>🍇</div>
                            <div className={css.landmarkInfo}>
                                <div className={css.landmarkName}>Quantum Berry Bush</div>
                                <div className={css.landmarkStatus}>
                                    {berriesHarvested ? "Harvested (+45 Stamina) ✓" : "Ripe Berries"} • <code>harvest_energy_berries</code>
                                </div>
                            </div>
                            <button
                                className={css.landmarkWalkBtn}
                                onClick={() => {
                                    playClick(soundEnabled)
                                    invokeTool("character_move", { destination: "clearing" })
                                }}
                            >
                                🚶 Walk
                            </button>
                        </div>

                        {/* 5. Ancient Monolith */}
                        <div className={`${css.landmarkCard} ${currentProxKey === "monolith" ? css.landmarkCardActive : ""}`}>
                            <div className={css.landmarkIcon}>🏛️</div>
                            <div className={css.landmarkInfo}>
                                <div className={css.landmarkName}>Ancient Monolith</div>
                                <div className={css.landmarkStatus}>
                                    {monolithResonated ? "Resonating Cosmic Energy ✓" : "Dormant Rings"} • <code>resonate_monolith</code>
                                </div>
                            </div>
                            <button
                                className={css.landmarkWalkBtn}
                                onClick={() => {
                                    playClick(soundEnabled)
                                    invokeTool("character_move", { destination: "monolith" })
                                }}
                            >
                                🚶 Walk
                            </button>
                        </div>

                        {/* 6. Starlight Relic Chest */}
                        <div className={`${css.landmarkCard} ${currentProxKey === "chest" ? css.landmarkCardActive : ""}`}>
                            <div className={css.landmarkIcon}>✨</div>
                            <div className={css.landmarkInfo}>
                                <div className={css.landmarkName}>Starlight Relic Chest</div>
                                <div className={css.landmarkStatus}>
                                    {chestOpened ? "Unlocked & Minted ✓" : "Sealed Relic"} • <code>open_relic_chest</code>
                                </div>
                            </div>
                            <button
                                className={css.landmarkWalkBtn}
                                onClick={() => {
                                    playClick(soundEnabled)
                                    invokeTool("character_move", { destination: "chest" })
                                }}
                            >
                                🚶 Walk
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer Controls & Direct Card Preview Button */}
                <div className={css.deckFooter}>
                    <button
                        className={css.soundToggle}
                        onClick={() => setSoundEnabled(!soundEnabled)}
                        title="Toggle procedural audio"
                    >
                        {soundEnabled ? "🔊 Sound Effects: ON" : "🔇 Sound Effects: OFF"}
                    </button>
                    <button
                        className={css.previewPassBtn}
                        onClick={() => {
                            playClick(soundEnabled)
                            setRevealOpen(true)
                        }}
                    >
                        📇 View Decluttered Chronicle Card
                    </button>
                </div>
            </div>

            {/* ============================================================ */}
            {/* DECLUTTERED GRAND REVEAL 3D HOLOGRAPHIC PASS MODAL            */}
            {/* ============================================================ */}
            {revealOpen && typeof document !== "undefined" && createPortal(
                <div className={css.revealModalOverlay} role="dialog" aria-modal="true" aria-label="Grand Reveal Relic">
                    <button
                        id="close-reveal-modal"
                        className={css.closeRevealBtn}
                        onClick={() => setRevealOpen(false)}
                        aria-label="Close Grand Reveal"
                    >
                        ✕
                    </button>

                    <div className={css.revealHeader}>
                        <div className={css.revealBadge}>
                            <span>Holographic Quest Chronicle • 1-of-1 Minted</span>
                        </div>
                        <h2 className={css.revealTitle}>The Grand Reveal</h2>
                        <p className={css.revealSubtitle}>
                            Your adventure with <strong>{character.name}</strong> across the 3D frontier has been minted into a decluttered holographic pass!
                        </p>
                    </div>

                    {/* Decluttered 3D Quest Chronicle Pass */}
                    <CleanJourneyPass
                        characterName={character.name}
                        archetypeTitle={character.archetype}
                        characterColor={character.color}
                        milestones={milestonesList}
                        stats={{
                            stamina: `${Math.round(character.energy)}%`,
                            distance: `${distanceTraveled}m`,
                            atmosphere: `${timeOfDay.toUpperCase()} 🌙`,
                            tier: milestonesList.filter((m) => m.completed).length >= 5 ? "MYTHIC S-RANK ✦✦✦✦✦" : "LEGENDARY A-RANK ✦✦✦✦",
                        }}
                        serialNo={`EXP-${Math.floor(1000 + distanceTraveled * 100)}`}
                        onClose={() => setRevealOpen(false)}
                    />
                </div>,
                document.body
            )}
        </div>
    )
}
