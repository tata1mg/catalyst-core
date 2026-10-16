/**
 * StoryWorldScene.js — Immersive 3D Living Story World with Spatial Proximity WebMCP Tools.
 *
 * Features:
 *   - Cute procedural 3D character "Pip / Boba-Bot" with bouncy waddle and authentic turning.
 *   - 6 Interactive 3D World Items:
 *       1. Base Camp Expedition Terminal
 *       2. Cozy Campfire (ignite / rest)
 *       3. Elder Byte Sage Drone (consult / riddle)
 *       4. Quantum Berry Bush (harvest stamina)
 *       5. Starlight Relic Chest (unlock 3D pass)
 *       6. Ancient Monolith (cosmic resonance shockwave)
 *   - Spatial Proximity Detection: Dynamic WebMCP tool activation when Pip is within 1.3 units radius.
 *   - Day/Night lighting transitions with twinkling stars.
 *   - Camera tracking presets: Follow, Overhead Map, and Close-Up.
 */
import * as THREE from "three"
import { playFootstep } from "../audio/sounds.js"

export const WAYPOINTS = {
    start: {
        id: "start",
        x: -3.8,
        y: 0,
        z: 0.9,
        name: "Base Camp",
        icon: "🏕️",
        toolName: "customize_character",
        itemTitle: "Frontier Base",
    },
    campfire: {
        id: "campfire",
        x: -1.9,
        y: 0,
        z: 0.5,
        name: "Campfire",
        icon: "🔥",
        toolName: "ignite_campfire",
        itemTitle: "Cozy Campfire",
    },
    crossroads: {
        id: "crossroads",
        x: 0,
        y: 0,
        z: 0,
        name: "Elder Byte",
        icon: "🧭",
        toolName: "talk_to_sage",
        itemTitle: "Sage Sentinel",
    },
    clearing: {
        id: "clearing",
        x: 1.9,
        y: 0,
        z: 0.9,
        name: "Energy Glade",
        icon: "🍇",
        toolName: "harvest_energy_berries",
        itemTitle: "Quantum Berry Bush",
    },
    chest: {
        id: "chest",
        x: 2.2,
        y: 0,
        z: -1.5,
        name: "Relic Chest",
        icon: "✨",
        toolName: "open_relic_chest",
        itemTitle: "Starlight Chest",
    },
    monolith: {
        id: "monolith",
        x: 3.8,
        y: 0,
        z: -0.4,
        name: "Ancient Monolith",
        icon: "🏛️",
        toolName: "resonate_monolith",
        itemTitle: "Cosmic Obelisk",
    },
}

export const TIME_PRESETS = {
    dawn: {
        skyColor: "#1d1933",
        sunColor: "#ffaa40",
        sunIntensity: 35,
        sunPos: [-6, 3, 4],
        ambientColor: "#624868",
        ambientIntensity: 0.6,
        starOpacity: 0.2,
    },
    day: {
        skyColor: "#0f1c2e",
        sunColor: "#c6ff3d",
        sunIntensity: 50,
        sunPos: [2, 6, 4],
        ambientColor: "#ffffff",
        ambientIntensity: 0.8,
        starOpacity: 0.0,
    },
    dusk: {
        skyColor: "#220e24",
        sunColor: "#ff3ea5",
        sunIntensity: 35,
        sunPos: [6, 2, 3],
        ambientColor: "#572b66",
        ambientIntensity: 0.5,
        starOpacity: 0.5,
    },
    night: {
        skyColor: "#060913",
        sunColor: "#3de0ff",
        sunIntensity: 25,
        sunPos: [-2, 5, 2],
        ambientColor: "#182645",
        ambientIntensity: 0.35,
        starOpacity: 0.95,
    },
}

export function createStoryWorldScene(host, { color = "#c6ff3d", onPositionChange } = {}) {
    const small = window.innerWidth < 720

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    renderer.domElement.style.width = "100%"
    renderer.domElement.style.height = "100%"
    renderer.domElement.style.display = "block"
    while (host.firstChild) {
        host.removeChild(host.firstChild)
    }
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, host.clientWidth / host.clientHeight, 0.1, 100)
    // Start behind Pip in third-person POV follow
    camera.position.set(WAYPOINTS.start.x, 0.25 + 1.35, WAYPOINTS.start.z - 2.4)
    camera.lookAt(WAYPOINTS.start.x, 0.25 + 0.45, WAYPOINTS.start.z + 4.0)

    let cameraMode = "pov" // "pov" | "cinematic" | "overhead" | "closeup"

    // ---- LIGHTING ----
    const ambientLight = new THREE.AmbientLight("#ffffff", 0.8)
    scene.add(ambientLight)

    const sunLight = new THREE.PointLight("#c6ff3d", 50, 30)
    sunLight.position.set(2, 6, 4)
    scene.add(sunLight)

    const campfireLight = new THREE.PointLight("#ff7a29", 0, 10)
    campfireLight.position.set(-1.4, 0.5, 0.5)
    scene.add(campfireLight)

    const chestLight = new THREE.PointLight("#ffb23d", 0, 8)
    chestLight.position.set(2.4, 0.6, -1.3)
    scene.add(chestLight)

    // ---- STARFIELD PARTICLES ----
    const STAR_COUNT = 900
    const starPos = new Float32Array(STAR_COUNT * 3)
    for (let i = 0; i < STAR_COUNT; i++) {
        const r = 10 + Math.random() * 22
        const th = Math.random() * Math.PI * 2
        const ph = Math.acos(2 * Math.random() - 1)
        starPos[i * 3] = r * Math.sin(ph) * Math.cos(th)
        starPos[i * 3 + 1] = Math.abs(r * Math.sin(ph) * Math.sin(th))
        starPos[i * 3 + 2] = r * Math.cos(ph)
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3))
    const starMat = new THREE.PointsMaterial({
        color: "#ffffff",
        size: 0.06,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
    })
    const starPoints = new THREE.Points(starGeo, starMat)
    scene.add(starPoints)

    // ---- WORLD ROOT GROUP ----
    const worldGroup = new THREE.Group()
    scene.add(worldGroup)

    // ---- EXPANSIVE GROUND TERRAIN ----
    const groundGeo = new THREE.PlaneGeometry(18, 12, 32, 24)
    const groundMat = new THREE.MeshStandardMaterial({
        color: "#080c18",
        roughness: 0.9,
        metalness: 0.2,
    })
    const groundMesh = new THREE.Mesh(groundGeo, groundMat)
    groundMesh.rotation.x = -Math.PI / 2
    groundMesh.position.y = -0.16
    groundMesh.receiveShadow = true
    worldGroup.add(groundMesh)

    // Sci-fi holographic terrain grid
    const terrainGrid = new THREE.GridHelper(16, 32, "#243754", "#0f1826")
    terrainGrid.position.y = -0.15
    worldGroup.add(terrainGrid)

    // Stepping platform discs along path
    const pathCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-4.2, -0.1, 0.9),
        new THREE.Vector3(-2.0, -0.05, 0.6),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(2.0, -0.05, -0.3),
        new THREE.Vector3(4.2, 0.05, -0.7),
    ])

    const discGeo = new THREE.CylinderGeometry(0.55, 0.65, 0.12, 18)
    for (let i = 0; i <= 8; i++) {
        const pt = pathCurve.getPoint(i / 8)
        const discMat = new THREE.MeshStandardMaterial({
            color: "#141a27",
            roughness: 0.8,
            metalness: 0.3,
        })
        const disc = new THREE.Mesh(discGeo, discMat)
        disc.position.copy(pt)
        disc.position.y -= 0.1
        worldGroup.add(disc)
    }

    // ---- 3D SPATIAL ITEMS & PROXIMITY BEACONS ----
    const itemBeacons = {}
    Object.entries(WAYPOINTS).forEach(([key, wp]) => {
        const beaconGroup = new THREE.Group()
        beaconGroup.position.set(wp.x, 0, wp.z)

        // Proximity radius boundary ring (radius 1.25 units)
        const ringColor =
            key === "start"
                ? "#c6ff3d"
                : key === "campfire"
                  ? "#ff8c2b"
                  : key === "crossroads"
                    ? "#3de0ff"
                    : key === "clearing"
                      ? "#a855f7"
                      : key === "chest"
                        ? "#ffb23d"
                        : "#ff3ea5"

        const ringMesh = new THREE.Mesh(
            new THREE.TorusGeometry(0.85, 0.015, 8, 48),
            new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.25 })
        )
        ringMesh.rotation.x = Math.PI / 2
        ringMesh.position.y = -0.11
        beaconGroup.add(ringMesh)

        // Center waypoint pad
        const padMesh = new THREE.Mesh(
            new THREE.CircleGeometry(0.35, 24),
            new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
        )
        padMesh.rotation.x = -Math.PI / 2
        padMesh.position.y = -0.1
        beaconGroup.add(padMesh)

        worldGroup.add(beaconGroup)
        itemBeacons[key] = { group: beaconGroup, ring: ringMesh, pad: padMesh, baseColor: ringColor }
    })

    // ---- 1. BASE CAMP TERMINAL [start] ----
    const baseCampGroup = new THREE.Group()
    baseCampGroup.position.set(WAYPOINTS.start.x, 0, WAYPOINTS.start.z)
    const baseAntenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.03, 0.8, 8),
        new THREE.MeshStandardMaterial({ color: "#c6ff3d", metalness: 0.8 })
    )
    baseAntenna.position.set(0.4, 0.4, -0.3)
    baseCampGroup.add(baseAntenna)
    worldGroup.add(baseCampGroup)

    // ---- 2. COZY CAMPFIRE [campfire] ----
    const campfireGroup = new THREE.Group()
    campfireGroup.position.set(WAYPOINTS.campfire.x, -0.05, WAYPOINTS.campfire.z)

    const logGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8)
    const logMat = new THREE.MeshStandardMaterial({ color: "#3d2212", roughness: 0.9 })
    for (let i = 0; i < 4; i++) {
        const log = new THREE.Mesh(logGeo, logMat)
        log.rotation.z = Math.PI / 3
        log.rotation.y = (i * Math.PI) / 2
        campfireGroup.add(log)
    }

    let isCampfireLit = false
    const flameMat = new THREE.MeshBasicMaterial({ color: "#ff8c2b", wireframe: true, transparent: true, opacity: 0 })
    const flameMesh = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 6), flameMat)
    flameMesh.position.y = 0.22
    flameMesh.scale.set(0.01, 0.01, 0.01)
    campfireGroup.add(flameMesh)

    const EMBER_COUNT = 30
    const emberPos = new Float32Array(EMBER_COUNT * 3)
    for (let i = 0; i < EMBER_COUNT; i++) {
        emberPos[i * 3] = (Math.random() - 0.5) * 0.2
        emberPos[i * 3 + 1] = 0.1 + Math.random() * 0.6
        emberPos[i * 3 + 2] = (Math.random() - 0.5) * 0.2
    }
    const emberGeo = new THREE.BufferGeometry()
    emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3))
    const emberMat = new THREE.PointsMaterial({
        color: "#ffc04d",
        size: 0.05,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
    })
    const emberPoints = new THREE.Points(emberGeo, emberMat)
    campfireGroup.add(emberPoints)
    worldGroup.add(campfireGroup)

    // ---- 3. ELDER BYTE (SAGE DRONE) [crossroads] ----
    const npcGroup = new THREE.Group()
    npcGroup.position.set(WAYPOINTS.crossroads.x + 0.8, 0.85, WAYPOINTS.crossroads.z - 0.4)

    const npcCoreMat = new THREE.MeshStandardMaterial({
        color: "#0f2238",
        roughness: 0.3,
        metalness: 0.8,
    })
    const npcCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), npcCoreMat)
    npcGroup.add(npcCore)

    const npcEyeMat = new THREE.MeshBasicMaterial({ color: "#3de0ff" })
    const npcEye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), npcEyeMat)
    npcEye.position.set(-0.25, 0, 0.25)
    npcGroup.add(npcEye)

    const npcHalo = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.018, 8, 36),
        new THREE.MeshBasicMaterial({ color: "#3de0ff", wireframe: true })
    )
    npcHalo.rotation.x = Math.PI / 4
    npcGroup.add(npcHalo)
    worldGroup.add(npcGroup)

    // ---- 4. QUANTUM BERRY BUSH [clearing] ----
    const berryBushGroup = new THREE.Group()
    berryBushGroup.position.set(WAYPOINTS.clearing.x, 0, WAYPOINTS.clearing.z)

    // Bush Foliage
    const bushGeo = new THREE.DodecahedronGeometry(0.35, 1)
    const bushMat = new THREE.MeshStandardMaterial({ color: "#132b35", roughness: 0.8, metalness: 0.2 })
    const bushMesh = new THREE.Mesh(bushGeo, bushMat)
    bushMesh.position.y = 0.25
    berryBushGroup.add(bushMesh)

    // Glowing Neon Berries
    let berriesAvailable = true
    const berryMeshes = []
    const berryPositions = [
        [0.2, 0.4, 0.15],
        [-0.2, 0.35, 0.2],
        [0.0, 0.5, -0.15],
        [-0.15, 0.25, -0.2],
        [0.22, 0.3, -0.1],
    ]
    const berryMat = new THREE.MeshBasicMaterial({ color: "#ff3ea5" })
    berryPositions.forEach((bpos) => {
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 12), berryMat)
        berry.position.set(bpos[0], bpos[1], bpos[2])
        berryBushGroup.add(berry)
        berryMeshes.push(berry)
    })
    worldGroup.add(berryBushGroup)

    // ---- 5. STARLIGHT RELIC CHEST [chest] ----
    const chestGroup = new THREE.Group()
    chestGroup.position.set(WAYPOINTS.chest.x, 0, WAYPOINTS.chest.z)

    let isChestOpen = false
    const chestMat = new THREE.MeshStandardMaterial({ color: "#1e1e2f", metalness: 0.85, roughness: 0.3 })
    const chestGoldMat = new THREE.MeshBasicMaterial({ color: "#ffb23d" })

    // Chest Body Box
    const chestBase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.36), chestMat)
    chestBase.position.y = 0.14
    chestGroup.add(chestBase)

    // Chest Hinged Lid
    const chestLidPivot = new THREE.Group()
    chestLidPivot.position.set(0, 0.28, -0.18) // Hinge line along back
    const chestLid = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 12, 1, false, 0, Math.PI), chestMat)
    chestLid.rotation.z = Math.PI / 2
    chestLid.position.set(0, 0, 0.18)
    chestLidPivot.add(chestLid)

    // Glowing lock crystal
    const lockCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), chestGoldMat)
    lockCrystal.position.set(0, 0.05, 0.37)
    chestLidPivot.add(lockCrystal)
    chestGroup.add(chestLidPivot)

    // Upward Light Beam (revealed on chest open)
    const beamGeo = new THREE.CylinderGeometry(0.08, 0.3, 3.5, 16, 1, true)
    const beamMat = new THREE.MeshBasicMaterial({
        color: "#ffb23d",
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    })
    const chestBeam = new THREE.Mesh(beamGeo, beamMat)
    chestBeam.position.y = 1.75
    chestGroup.add(chestBeam)
    worldGroup.add(chestGroup)

    // ---- 6. ANCIENT MONOLITH [monolith] ----
    const monolithGroup = new THREE.Group()
    monolithGroup.position.set(WAYPOINTS.monolith.x, 0, WAYPOINTS.monolith.z)

    const monolithGeo = new THREE.OctahedronGeometry(0.8, 0)
    monolithGeo.scale(0.8, 2.2, 0.8)
    const monolithMat = new THREE.MeshPhysicalMaterial({
        color: "#1c2438",
        emissive: "#ff3ea5",
        emissiveIntensity: 0.25,
        roughness: 0.2,
        metalness: 0.9,
        clearcoat: 1,
    })
    const monolithMesh = new THREE.Mesh(monolithGeo, monolithMat)
    monolithMesh.position.y = 1.0
    monolithGroup.add(monolithMesh)

    const monoRing1 = new THREE.Mesh(
        new THREE.TorusGeometry(1.1, 0.02, 8, 64),
        new THREE.MeshBasicMaterial({ color: "#ff3ea5", transparent: true, opacity: 0.7 })
    )
    monoRing1.position.y = 1.0
    monoRing1.rotation.x = Math.PI / 3
    monolithGroup.add(monoRing1)

    const monoRing2 = new THREE.Mesh(
        new THREE.TorusGeometry(1.35, 0.015, 8, 64),
        new THREE.MeshBasicMaterial({ color: "#3de0ff", transparent: true, opacity: 0.6 })
    )
    monoRing2.position.y = 1.0
    monoRing2.rotation.x = -Math.PI / 4
    monolithGroup.add(monoRing2)
    worldGroup.add(monolithGroup)

    // ---- CUTE MAIN CHARACTER: PIP ----
    const characterGroup = new THREE.Group()
    characterGroup.position.set(WAYPOINTS.start.x, 0.25, WAYPOINTS.start.z)

    const charBodyMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(color),
        roughness: 0.2,
        metalness: 0.4,
        clearcoat: 0.9,
    })
    const charBody = new THREE.Mesh(new THREE.SphereGeometry(0.38, 32, 32), charBodyMat)
    charBody.scale.set(1, 1.15, 0.95)
    characterGroup.add(charBody)

    const visorMat = new THREE.MeshStandardMaterial({ color: "#080c14", roughness: 0.1, metalness: 0.9 })
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 24), visorMat)
    visor.scale.set(1.05, 0.65, 0.6)
    visor.position.set(0, 0.06, 0.26)
    characterGroup.add(visor)

    const eyeMat = new THREE.MeshBasicMaterial({ color: "#3de0ff" })
    const eyeLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), eyeMat)
    eyeLeft.rotation.x = Math.PI / 2
    eyeLeft.position.set(-0.09, 0.07, 0.4)
    characterGroup.add(eyeLeft)

    const eyeRight = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), eyeMat)
    eyeRight.rotation.x = Math.PI / 2
    eyeRight.position.set(0.09, 0.07, 0.4)
    characterGroup.add(eyeRight)

    const antennaStem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.25, 8),
        new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 0.8 })
    )
    antennaStem.position.set(0, 0.5, 0)
    characterGroup.add(antennaStem)

    const bulbMat = new THREE.MeshBasicMaterial({ color: "#ffb23d" })
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), bulbMat)
    bulb.position.set(0, 0.64, 0)
    characterGroup.add(bulb)

    const footMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 })
    const footLeft = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), footMat)
    footLeft.position.set(-0.18, -0.42, 0)
    characterGroup.add(footLeft)

    const footRight = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), footMat)
    footRight.position.set(0.18, -0.42, 0)
    characterGroup.add(footRight)

    worldGroup.add(characterGroup)

    // ---- TARGET RETICLE (Click-to-Move Target Indicator) ----
    const targetReticle = new THREE.Group()
    const reticleRing = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.28, 32),
        new THREE.MeshBasicMaterial({ color: "#c6ff3d", side: THREE.DoubleSide, transparent: true, opacity: 0 })
    )
    reticleRing.rotation.x = -Math.PI / 2
    reticleRing.position.y = -0.12
    targetReticle.add(reticleRing)
    worldGroup.add(targetReticle)

    let reticlePulseTimer = 0
    function pulseReticle(pos) {
        targetReticle.position.set(pos.x, 0, pos.z)
        reticlePulseTimer = 1.0
        reticleRing.material.opacity = 0.9
    }

    // ---- STATE & ANIMATION VARIABLES ----
    let currentTime = "day"
    const targetPos = new THREE.Vector3().copy(characterGroup.position)
    let currentAction = "idle" // "idle" | "walk" | "rest" | "play"
    let burstPower = 0
    let stepSoundTimer = 0
    let activeProximityItem = null

    // ---- PUBLIC CONTROLLER METHODS ----
    function setTimeOfDay(timeKey) {
        if (!TIME_PRESETS[timeKey]) return
        currentTime = timeKey
    }

    function moveTo(destination) {
        if (typeof destination === "string" && WAYPOINTS[destination]) {
            targetPos.set(WAYPOINTS[destination].x, 0.25, WAYPOINTS[destination].z)
            pulseReticle(targetPos)
            currentAction = "walk"
            playFootstep(true)
            return { ok: true, waypoint: destination, x: targetPos.x, z: targetPos.z }
        } else if (destination && typeof destination.x === "number") {
            const clampedX = THREE.MathUtils.clamp(destination.x, -6.5, 6.5)
            const clampedZ = THREE.MathUtils.clamp(destination.z ?? 0, -3.5, 3.5)
            targetPos.set(clampedX, 0.25, clampedZ)
            pulseReticle(targetPos)
            currentAction = "walk"
            playFootstep(true)
            return { ok: true, x: clampedX, z: clampedZ }
        }
        return { ok: false, error: "Invalid destination format" }
    }

    function moveDirection(direction, distance = 0.75) {
        const delta = { x: 0, z: 0 }
        switch (direction) {
            case "forward":
            case "north":
            case "up":
                delta.z = -distance
                break
            case "back":
            case "south":
            case "down":
                delta.z = distance
                break
            case "left":
            case "west":
                delta.x = -distance
                break
            case "right":
            case "east":
                delta.x = distance
                break
            default:
                break
        }
        const nextX = THREE.MathUtils.clamp(targetPos.x + delta.x, -6.5, 6.5)
        const nextZ = THREE.MathUtils.clamp(targetPos.z + delta.z, -3.5, 3.5)
        targetPos.x = nextX
        targetPos.z = nextZ
        pulseReticle(targetPos)
        currentAction = "walk"
        playFootstep(true)
        return { ok: true, direction, x: nextX, z: nextZ }
    }

    function teleportTo(destination) {
        moveTo(destination)
        characterGroup.position.copy(targetPos)
        burstPower = 0.6
        return { ok: true, x: characterGroup.position.x, z: characterGroup.position.z }
    }

    function setAction(act) {
        currentAction = act
        if (act === "rest") {
            setExpression("tired")
        } else if (act === "play") {
            setExpression("playful")
            burstPower = 0.5
            setTimeout(() => {
                if (currentAction === "play") {
                    currentAction = "idle"
                    setExpression("happy")
                }
            }, 4500)
        } else if (act === "idle") {
            setExpression("happy")
        }
    }

    function setExpression(expr) {
        if (expr === "tired") {
            eyeMat.color.set("#ff3ea5")
            bulbMat.color.set("#ff3ea5")
            eyeLeft.scale.set(1, 0.3, 1)
            eyeRight.scale.set(1, 0.3, 1)
        } else if (expr === "playful") {
            eyeMat.color.set("#c6ff3d")
            bulbMat.color.set("#3de0ff")
            eyeLeft.scale.set(1.4, 1.4, 1)
            eyeRight.scale.set(1.4, 1.4, 1)
        } else {
            eyeMat.color.set("#3de0ff")
            bulbMat.color.set("#ffb23d")
            eyeLeft.scale.set(1, 1, 1)
            eyeRight.scale.set(1, 1, 1)
        }
    }

    function setCameraMode(mode) {
        cameraMode = mode
        if (mode === "overhead") {
            camera.position.set(characterGroup.position.x * 0.4, 8.8, characterGroup.position.z * 0.4 + 0.01)
            camera.lookAt(characterGroup.position.x * 0.4, 0, characterGroup.position.z * 0.4)
        } else if (mode === "closeup") {
            camera.position.set(characterGroup.position.x, characterGroup.position.y + 0.55, characterGroup.position.z + 1.9)
            camera.lookAt(characterGroup.position.x, characterGroup.position.y + 0.25, characterGroup.position.z)
        } else if (mode === "pov") {
            const angle = characterGroup.rotation.y
            const povDist = 2.4
            const povHeight = 1.35
            camera.position.set(
                characterGroup.position.x - Math.sin(angle) * povDist,
                characterGroup.position.y + povHeight,
                characterGroup.position.z - Math.cos(angle) * povDist
            )
            camera.lookAt(
                characterGroup.position.x + Math.sin(angle) * 4.0,
                characterGroup.position.y + 0.45,
                characterGroup.position.z + Math.cos(angle) * 4.0
            )
        } else {
            // cinematic follow
            camera.position.set(characterGroup.position.x + 0.8, 2.4, characterGroup.position.z + 4.2)
            camera.lookAt(characterGroup.position.x, characterGroup.position.y + 0.4, characterGroup.position.z)
        }
    }

    // Interactive Item Actions
    function igniteCampfire() {
        isCampfireLit = true
        flameMat.opacity = 1
        flameMesh.scale.set(1, 1, 1)
        emberMat.opacity = 0.9
        campfireLight.intensity = 18
        burstPower = 0.4
    }

    function extinguishCampfire() {
        isCampfireLit = false
        flameMat.opacity = 0
        flameMesh.scale.set(0.01, 0.01, 0.01)
        emberMat.opacity = 0
        campfireLight.intensity = 0
    }

    function harvestBerries() {
        berriesAvailable = false
        berryMeshes.forEach((b) => {
            b.scale.set(0.01, 0.01, 0.01)
        })
        burstPower = 0.3
    }

    function openChest() {
        isChestOpen = true
        chestLidPivot.rotation.x = -Math.PI / 2.8 // Swing lid open
        chestBeam.material.opacity = 0.8
        chestLight.intensity = 15
        burstPower = 0.5
    }

    function activateMonolith() {
        burstPower = 1.0
        monolithMat.emissiveIntensity = 1.0
        setTimeout(() => {
            monolithMat.emissiveIntensity = 0.35
        }, 1400)
    }

    function sageSpeak() {
        npcHalo.rotation.z += Math.PI / 2
        npcEyeMat.color.set("#c6ff3d")
        setTimeout(() => npcEyeMat.color.set("#3de0ff"), 1200)
    }

    function burst() {
        burstPower = 1.0
    }

    function setColor(hex) {
        charBodyMat.color.set(hex)
    }

    function getCharacterPosition() {
        return {
            x: Number(characterGroup.position.x.toFixed(2)),
            y: Number(characterGroup.position.y.toFixed(2)),
            z: Number(characterGroup.position.z.toFixed(2)),
            action: currentAction,
            heading: Math.round(((characterGroup.rotation.y * 180) / Math.PI + 360) % 360),
            proximity: activeProximityItem,
        }
    }

    // ---- POINTER CONTROLS (ORBIT DRAG vs CLICK-TO-MOVE) ----
    const raycaster = new THREE.Raycaster()
    const mouseCoord = new THREE.Vector2()
    const drag = { active: false, startX: 0, startY: 0, x: 0, y: 0, rx: 0.12, ry: 0, vx: 0, vy: 0 }

    const onPointerDown = (e) => {
        drag.active = true
        drag.startX = e.clientX
        drag.startY = e.clientY
        drag.x = e.clientX
        drag.y = e.clientY
    }

    const onPointerMove = (e) => {
        if (!drag.active) return
        const dx = e.clientX - drag.x
        const dy = e.clientY - drag.y
        drag.x = e.clientX
        drag.y = e.clientY
        drag.vy = dx * 0.005
        drag.vx = dy * 0.003
    }

    const onPointerUp = (e) => {
        if (!drag.active) return
        drag.active = false
        const travel = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)

        if (travel < 6) {
            const rect = renderer.domElement.getBoundingClientRect()
            mouseCoord.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
            mouseCoord.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
            raycaster.setFromCamera(mouseCoord, camera)

            const hits = raycaster.intersectObjects([groundMesh])
            if (hits.length > 0) {
                const pt = hits[0].point
                const localPt = pt.clone().applyEuler(new THREE.Euler(-worldGroup.rotation.x, -worldGroup.rotation.y, 0))
                moveTo({ x: localPt.x, z: localPt.z })
            }
        }
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)

    // ---- KEYBOARD CONTROLS (WASD / ARROW KEYS) ----
    const onKeyDown = (e) => {
        if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return

        let handled = false
        if (e.code === "KeyW" || e.key === "ArrowUp") {
            moveDirection("forward", 0.6)
            handled = true
        } else if (e.code === "KeyS" || e.key === "ArrowDown") {
            moveDirection("back", 0.6)
            handled = true
        } else if (e.code === "KeyA" || e.key === "ArrowLeft") {
            moveDirection("left", 0.6)
            handled = true
        } else if (e.code === "KeyD" || e.key === "ArrowRight") {
            moveDirection("right", 0.6)
            handled = true
        }
        if (handled) e.preventDefault()
    }
    window.addEventListener("keydown", onKeyDown)

    // ---- ANIMATION LOOP ----
    const clock = new THREE.Clock()
    let reqId = null
    let lastReportPos = ""

    function animate() {
        reqId = requestAnimationFrame(animate)
        const t = clock.getElapsedTime()

        // 0. Orbit world with inertia from pointer drag
        drag.rx = THREE.MathUtils.clamp(drag.rx + drag.vx, -0.25, 0.5)
        drag.ry += drag.vy
        drag.vx *= 0.92
        drag.vy *= 0.92
        if (cameraMode !== "pov") {
            worldGroup.rotation.y = drag.ry
            worldGroup.rotation.x = drag.rx
        } else {
            worldGroup.rotation.y = THREE.MathUtils.lerp(worldGroup.rotation.y, 0, 0.1)
            worldGroup.rotation.x = THREE.MathUtils.lerp(worldGroup.rotation.x, 0, 0.1)
        }

        // 1. Interpolate Pip position & heading
        const dx = targetPos.x - characterGroup.position.x
        const dz = targetPos.z - characterGroup.position.z
        const horizDist = Math.hypot(dx, dz)

        if (horizDist > 0.04) {
            const targetAngle = Math.atan2(dx, dz)
            let diff = targetAngle - characterGroup.rotation.y
            while (diff < -Math.PI) diff += Math.PI * 2
            while (diff > Math.PI) diff -= Math.PI * 2
            characterGroup.rotation.y += diff * 0.14

            characterGroup.position.x += dx * 0.05
            characterGroup.position.z += dz * 0.05
            if (currentAction !== "walk") currentAction = "walk"

            stepSoundTimer += 0.05
            if (stepSoundTimer > 0.35) {
                stepSoundTimer = 0
                playFootstep(true)
            }
        } else if (currentAction === "walk") {
            currentAction = "idle"
        }

        // 2. Spatial Proximity Detection (Radius <= 0.95 units)
        let closestItem = null
        let closestDist = Infinity
        const PROXIMITY_RADIUS = 0.95

        Object.entries(WAYPOINTS).forEach(([key, wp]) => {
            const dist = Math.hypot(characterGroup.position.x - wp.x, characterGroup.position.z - wp.z)
            const beacon = itemBeacons[key]

            if (dist < closestDist) {
                closestDist = dist
                if (dist <= PROXIMITY_RADIUS) {
                    closestItem = {
                        key,
                        id: wp.id,
                        name: wp.name,
                        icon: wp.icon,
                        toolName: wp.toolName,
                        itemTitle: wp.itemTitle,
                        distance: Number(dist.toFixed(2)),
                    }
                }
            }

            // Beacon ground ring pulsing when in radius
            if (beacon) {
                if (dist <= PROXIMITY_RADIUS) {
                    beacon.ring.material.opacity = 0.85 + Math.sin(t * 8) * 0.15
                    beacon.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.05)
                    beacon.pad.material.opacity = 0.35
                } else {
                    beacon.ring.material.opacity = THREE.MathUtils.lerp(beacon.ring.material.opacity, 0.25, 0.05)
                    beacon.ring.scale.setScalar(1)
                    beacon.pad.material.opacity = 0.12
                }
            }
        })

        activeProximityItem = closestItem

        // Notify HUD and WebMCP listener of live position & proximity change
        if (onPositionChange) {
            const proxKey = closestItem ? closestItem.key : "none"
            const posKey = `${characterGroup.position.x.toFixed(1)},${characterGroup.position.z.toFixed(1)},${currentAction},${proxKey}`
            if (posKey !== lastReportPos) {
                lastReportPos = posKey
                onPositionChange(getCharacterPosition())
            }
        }

        // Camera follow modes
        if (cameraMode === "pov") {
            const angle = characterGroup.rotation.y + drag.ry
            const povDist = 2.4
            const povHeight = 1.35
            const targetCamX = characterGroup.position.x - Math.sin(angle) * povDist
            const targetCamZ = characterGroup.position.z - Math.cos(angle) * povDist
            const targetCamY = characterGroup.position.y + povHeight + drag.rx * 1.5

            camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, 0.08)
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCamY, 0.08)
            camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, 0.08)

            const lookAheadDist = 4.0
            const lookTargetX = characterGroup.position.x + Math.sin(angle) * lookAheadDist
            const lookTargetZ = characterGroup.position.z + Math.cos(angle) * lookAheadDist
            const lookTargetY = characterGroup.position.y + 0.45 - drag.rx * 0.8

            camera.lookAt(lookTargetX, lookTargetY, lookTargetZ)
        } else if (cameraMode === "cinematic") {
            // Smooth 3D follow camera with isometric offset tracking Pip everywhere
            const targetCamX = characterGroup.position.x + 0.8
            const targetCamY = 2.4
            const targetCamZ = characterGroup.position.z + 4.2

            camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, 0.05)
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCamY, 0.05)
            camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, 0.05)
            camera.lookAt(
                characterGroup.position.x,
                characterGroup.position.y + 0.4,
                characterGroup.position.z
            )
        } else if (cameraMode === "closeup") {
            const targetX = characterGroup.position.x
            const targetY = characterGroup.position.y + 0.55
            const targetZ = characterGroup.position.z + 1.9
            camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.07)
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.07)
            camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.07)
            camera.lookAt(characterGroup.position.x, characterGroup.position.y + 0.25, characterGroup.position.z)
        } else if (cameraMode === "overhead") {
            const targetX = characterGroup.position.x * 0.4
            const targetZ = characterGroup.position.z * 0.4 + 0.01
            camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.06)
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, 8.8, 0.06)
            camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.06)
            camera.lookAt(targetX, 0, targetZ - 0.01)
        }

        // 3. Animate Character actions & waddle
        if (currentAction === "walk") {
            characterGroup.rotation.z = Math.sin(t * 12) * 0.12
            characterGroup.position.y = 0.25 + Math.abs(Math.sin(t * 12)) * 0.09
            footLeft.position.y = -0.42 + Math.sin(t * 12) * 0.08
            footRight.position.y = -0.42 - Math.sin(t * 12) * 0.08
            antennaStem.rotation.z = -Math.sin(t * 12) * 0.18
        } else if (currentAction === "rest") {
            characterGroup.rotation.z = 0
            characterGroup.position.y = 0.14 + Math.sin(t * 1.5) * 0.02
            antennaStem.rotation.z = 0.35
            footLeft.position.y = -0.35
            footRight.position.y = -0.35
        } else if (currentAction === "play") {
            characterGroup.rotation.y += 0.06
            characterGroup.position.y = 0.35 + Math.abs(Math.sin(t * 8)) * 0.25
            antennaStem.rotation.z = Math.sin(t * 16) * 0.25
        } else {
            characterGroup.rotation.z = 0
            characterGroup.position.y = 0.25 + Math.sin(t * 2.5) * 0.03
            antennaStem.rotation.z = Math.sin(t * 3) * 0.05
            footLeft.position.y = -0.42
            footRight.position.y = -0.42
        }

        // 4. Reticle pulse timer decay
        if (reticlePulseTimer > 0.01) {
            reticlePulseTimer *= 0.92
            reticleRing.scale.setScalar(1 + (1 - reticlePulseTimer) * 0.8)
            reticleRing.material.opacity = reticlePulseTimer
        } else {
            reticleRing.material.opacity = 0
        }

        // 5. NPC Elder Byte floating hover
        npcGroup.position.y = 0.85 + Math.sin(t * 2) * 0.08
        npcHalo.rotation.y += 0.02
        npcHalo.rotation.z += 0.01

        // 6. Campfire flame flicker & embers
        if (isCampfireLit) {
            flameMesh.scale.set(1 + Math.sin(t * 18) * 0.15, 1 + Math.cos(t * 22) * 0.2, 1 + Math.sin(t * 14) * 0.15)
            campfireLight.intensity = 15 + Math.sin(t * 16) * 8
            const posAttr = emberGeo.attributes.position
            for (let i = 0; i < EMBER_COUNT; i++) {
                let y = posAttr.getY(i) + 0.015
                if (y > 0.8) y = 0.1
                posAttr.setY(i, y)
            }
            posAttr.needsUpdate = true
        }

        // 7. Berries subtle float
        if (berriesAvailable) {
            berryMeshes.forEach((b, idx) => {
                b.position.y += Math.sin(t * 4 + idx) * 0.0006
            })
        }

        // 8. Chest beam animation
        if (isChestOpen) {
            chestBeam.rotation.y += 0.01
            chestBeam.material.opacity = 0.7 + Math.sin(t * 6) * 0.15
        }

        // 9. Monolith spinning rings
        monoRing1.rotation.y += 0.015
        monoRing2.rotation.z -= 0.012

        // 10. Day/Night lighting interpolation
        const preset = TIME_PRESETS[currentTime]
        if (preset) {
            sunLight.color.lerp(new THREE.Color(preset.sunColor), 0.05)
            sunLight.intensity = THREE.MathUtils.lerp(sunLight.intensity, preset.sunIntensity, 0.05)
            ambientLight.color.lerp(new THREE.Color(preset.ambientColor), 0.05)
            ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, preset.ambientIntensity, 0.05)
            starMat.opacity = THREE.MathUtils.lerp(starMat.opacity, preset.starOpacity, 0.05)
        }

        // 11. Shockwave burst decay
        if (burstPower > 0.01) {
            camera.position.x += Math.sin(t * 30) * burstPower * 0.08
            camera.position.y += Math.cos(t * 35) * burstPower * 0.08
            burstPower *= 0.94
        }

        renderer.render(scene, camera)
    }

    animate()

    // ---- RESIZE HANDLER ----
    const resize = () => {
        const w = host.clientWidth || 1
        const h = host.clientHeight || 1
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
    }
    window.addEventListener("resize", resize)
    resize()

    return {
        setTimeOfDay,
        moveTo,
        moveDirection,
        teleportTo,
        setAction,
        setExpression,
        setCameraMode,
        igniteCampfire,
        extinguishCampfire,
        harvestBerries,
        openChest,
        activateMonolith,
        sageSpeak,
        burst,
        setColor,
        getCharacterPosition,
        getActiveProximity: () => activeProximityItem,
        dispose: () => {
            cancelAnimationFrame(reqId)
            window.removeEventListener("resize", resize)
            window.removeEventListener("pointermove", onPointerMove)
            window.removeEventListener("pointerup", onPointerUp)
            window.removeEventListener("keydown", onKeyDown)
            renderer.domElement.removeEventListener("pointerdown", onPointerDown)
            renderer.dispose()
            if (host.contains(renderer.domElement)) {
                host.removeChild(renderer.domElement)
            }
        },
    }
}
