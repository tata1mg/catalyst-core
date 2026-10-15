/**
 * OrbScene — the 3D "sculpture" agents can drive through WebMCP tools.
 *
 * Client-only: Studio dynamic-imports this module inside an effect, so three.js
 * never runs during SSR and stays out of the initial bundle.
 *
 * Public API (each one maps 1:1 onto a WebMCP tool on the Studio route):
 *   setShape(name) · setColor(hex) · setSpin(speed) · setFinish(name)
 *   burst() · pulse() · getState() · dispose()
 */
import * as THREE from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"

export const SHAPES = ["orb", "blob", "knot", "torus", "cube", "crystal"]
export const FINISHES = ["chrome", "holo", "glass", "matte", "wire"]

function makeGeometry(shape) {
    switch (shape) {
        case "knot":
            return new THREE.TorusKnotGeometry(0.85, 0.3, 260, 36)
        case "torus":
            return new THREE.TorusGeometry(1.0, 0.42, 64, 160)
        case "cube":
            return new THREE.BoxGeometry(1.75, 1.75, 1.75, 28, 28, 28)
        case "crystal":
            return new THREE.OctahedronGeometry(1.55, 0)
        case "blob":
            return new THREE.IcosahedronGeometry(1.25, 24)
        case "orb":
        default:
            return new THREE.IcosahedronGeometry(1.32, 3)
    }
}

const FINISH_PARAMS = {
    chrome: { metalness: 1, roughness: 0.12, clearcoat: 1, iridescence: 0, opacity: 1, wireframe: false },
    holo: { metalness: 0.55, roughness: 0.18, clearcoat: 1, iridescence: 1, opacity: 1, wireframe: false },
    glass: { metalness: 0.1, roughness: 0.04, clearcoat: 1, iridescence: 0.6, opacity: 0.72, wireframe: false },
    matte: { metalness: 0, roughness: 0.82, clearcoat: 0, iridescence: 0, opacity: 1, wireframe: false },
    wire: { metalness: 0, roughness: 1, clearcoat: 0, iridescence: 0, opacity: 1, wireframe: true },
}

// Per-shape wobble amplitude: blobs wobble a lot, hard shapes barely.
const WOBBLE = { orb: 0.06, blob: 0.22, knot: 0.04, torus: 0.05, cube: 0.035, crystal: 0.0 }

export function createOrbScene(host, { color = "#c6ff3d", shape = "orb", finish = "holo", spin = 1 } = {}) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const small = window.innerWidth < 720

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.domElement.style.width = "100%"
    renderer.domElement.style.height = "100%"
    renderer.domElement.style.display = "block"
    while (host.firstChild) {
        host.removeChild(host.firstChild)
    }
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    camera.position.set(0, 0, 7)

    // Coloured rim lights that follow the accent colour.
    const keyLight = new THREE.PointLight(color, 40, 20)
    keyLight.position.set(3, 2, 3)
    const fillLight = new THREE.PointLight("#7b5cff", 30, 20)
    fillLight.position.set(-3, -1.5, 2)
    scene.add(keyLight, fillLight, new THREE.AmbientLight("#ffffff", 0.25))

    // ---- sculpture -------------------------------------------------------
    const uniforms = { uTime: { value: 0 }, uWobble: { value: WOBBLE[shape] ?? 0.05 } }
    const material = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(color),
        emissive: new THREE.Color(color),
        emissiveIntensity: 0,
        flatShading: true,
        transparent: true,
        iridescenceIOR: 1.7,
        iridescenceThicknessRange: [120, 680],
    })
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime
        shader.uniforms.uWobble = uniforms.uWobble
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWobble;")
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
                vec3 p = position * 1.6;
                float n = sin(p.x * 2.1 + uTime * 0.9) * sin(p.y * 2.4 + uTime * 1.1) * sin(p.z * 1.9 + uTime * 0.7);
                transformed += normalize(position) * n * uWobble;`
            )
    }
    applyFinish(finish)

    const group = new THREE.Group()
    const mesh = new THREE.Mesh(makeGeometry(shape), material)
    group.add(mesh)

    // Orbit ring
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.008, 8, 220), ringMat)
    ring.rotation.set(Math.PI * 0.42, 0.2, 0)
    group.add(ring)
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.004, 8, 220), ringMat.clone())
    ring2.material.opacity = 0.25
    ring2.rotation.set(Math.PI * 0.56, -0.35, 0)
    group.add(ring2)

    // Orbital satellite drones (Totem / Character accessories)
    const satellites = []
    const satGeo = new THREE.OctahedronGeometry(0.2, 0)
    for (let i = 0; i < 3; i++) {
        const satMat = material.clone()
        satMat.wireframe = i === 1
        const satMesh = new THREE.Mesh(satGeo, satMat)
        group.add(satMesh)
        satellites.push({ mesh: satMesh, offset: (i * Math.PI * 2) / 3, radius: 2.05, currentRadius: 2.05 })
    }

    scene.add(group)


    // ---- particle field --------------------------------------------------
    const COUNT = small ? 700 : 1500
    const base = new Float32Array(COUNT * 3)
    const pos = new Float32Array(COUNT * 3)
    const vel = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
        const r = 2.4 + Math.random() * 1.6
        const th = Math.random() * Math.PI * 2
        const ph = Math.acos(2 * Math.random() - 1)
        base[i * 3] = pos[i * 3] = r * Math.sin(ph) * Math.cos(th)
        base[i * 3 + 1] = pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.7
        base[i * 3 + 2] = pos[i * 3 + 2] = r * Math.cos(ph)
    }
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    const pMat = new THREE.PointsMaterial({
        color,
        size: small ? 0.035 : 0.028,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    })
    const points = new THREE.Points(pGeo, pMat)
    scene.add(points)

    // ---- state + targets -------------------------------------------------
    const state = { shape, color, finish, spin }
    const targetColor = new THREE.Color(color)
    let spinNow = spin
    let flash = 0
    let morph = null // { phase: "out"|"in", t, next }
    let bursting = 0

    // pointer drag → rotation with inertia
    const drag = { active: false, x: 0, y: 0, vx: 0, vy: 0, rx: 0, ry: 0 }
    const onDown = (e) => {
        drag.active = true
        drag.x = e.clientX
        drag.y = e.clientY
    }
    const onMove = (e) => {
        if (!drag.active) return
        const dx = e.clientX - drag.x
        const dy = e.clientY - drag.y
        drag.x = e.clientX
        drag.y = e.clientY
        drag.vy = dx * 0.006
        drag.vx = dy * 0.006
    }
    const onUp = () => (drag.active = false)
    renderer.domElement.addEventListener("pointerdown", onDown)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)

    function applyFinish(name) {
        const p = FINISH_PARAMS[name] || FINISH_PARAMS.holo
        material.metalness = p.metalness
        material.roughness = p.roughness
        material.clearcoat = p.clearcoat
        material.iridescence = p.iridescence
        material.opacity = p.opacity
        material.wireframe = p.wireframe
        material.emissiveIntensity = p.wireframe ? 0.9 : 0
        material.needsUpdate = true
    }

    // ---- sizing + visibility --------------------------------------------
    const resize = () => {
        const w = host.clientWidth || 1
        const h = host.clientHeight || 1
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        // Pull the camera back on narrow/portrait screens so the sculpture fits.
        camera.position.z = w / h < 0.8 ? 9.5 : 7
        camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    let visible = true
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting))
    io.observe(host)

    // ---- loop ------------------------------------------------------------
    const clock = new THREE.Clock()
    let raf = 0
    const tick = () => {
        raf = requestAnimationFrame(tick)
        if (!visible || document.hidden) return
        const dt = Math.min(clock.getDelta(), 0.05)
        const t = clock.elapsedTime
        uniforms.uTime.value = t

        // spin (eased toward target) + drag inertia
        spinNow += (state.spin - spinNow) * 0.05
        const motion = reducedMotion ? 0.25 : 1
        mesh.rotation.y += dt * 0.6 * spinNow * motion
        mesh.rotation.x += dt * 0.18 * spinNow * motion
        drag.rx += drag.vx
        drag.ry += drag.vy
        drag.vx *= 0.93
        drag.vy *= 0.93
        group.rotation.x = drag.rx
        group.rotation.y = drag.ry
        group.position.y = Math.sin(t * 0.8) * 0.08 * motion

        // Satellite drone orbits
        satellites.forEach((sat, i) => {
            const angle = t * (0.8 + i * 0.35) * motion + sat.offset
            sat.currentRadius += (sat.radius - sat.currentRadius) * 0.08
            sat.mesh.position.set(
                Math.cos(angle) * sat.currentRadius,
                Math.sin(angle * 1.6 + t) * 0.5 * motion,
                Math.sin(angle) * sat.currentRadius
            )
            sat.mesh.rotation.x += dt * 1.5
            sat.mesh.rotation.y += dt * 2.2
            sat.mesh.material.color.lerp(targetColor, 0.06)
            sat.mesh.material.emissive.lerp(targetColor, 0.06)
        })

        // colour lerp

        material.color.lerp(targetColor, 0.06)
        material.emissive.lerp(targetColor, 0.06)
        keyLight.color.lerp(targetColor, 0.06)
        ringMat.color.lerp(targetColor, 0.06)
        ring2.material.color.lerp(targetColor, 0.06)
        pMat.color.lerp(targetColor, 0.06)

        // pulse flash
        if (flash > 0) {
            flash = Math.max(0, flash - dt * 2.2)
            const base = state.finish === "wire" ? 0.9 : 0
            material.emissiveIntensity = base + flash * 0.9
        }

        // morph: shrink → swap geometry → spring back
        let scale = 1 + flash * 0.08
        if (morph) {
            morph.t += dt
            if (morph.phase === "out") {
                const k = Math.min(morph.t / 0.22, 1)
                scale *= 1 - k * k
                if (k >= 1) {
                    mesh.geometry.dispose()
                    mesh.geometry = makeGeometry(morph.next)
                    uniforms.uWobble.value = WOBBLE[morph.next] ?? 0.05
                    morph = { phase: "in", t: 0 }
                }
            } else {
                const k = Math.min(morph.t / 0.6, 1)
                // easeOutBack
                const c1 = 2.2
                const e = 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2)
                scale *= e
                if (k >= 1) morph = null
            }
        }
        mesh.scale.setScalar(Math.max(scale, 0.0001))

        // particles: spring back to rest, with a slow drift
        const arr = pGeo.attributes.position.array
        const active = bursting > 0
        if (active) bursting -= dt
        for (let i = 0; i < COUNT * 3; i++) {
            vel[i] += (base[i] - arr[i]) * 0.018
            vel[i] *= 0.92
            arr[i] += vel[i]
        }
        pGeo.attributes.position.needsUpdate = true
        points.rotation.y += dt * 0.04 * motion

        renderer.render(scene, camera)
    }
    tick()

    // ---- API -------------------------------------------------------------
    return {
        setShape(next) {
            if (!SHAPES.includes(next)) throw new Error(`unknown shape "${next}"`)
            state.shape = next
            morph = { phase: "out", t: 0, next }
        },
        setColor(hex) {
            targetColor.set(hex)
            state.color = `#${targetColor.getHexString()}`
        },
        setSpin(speed) {
            state.spin = Math.max(0, Math.min(6, speed))
        },
        setFinish(name) {
            if (!FINISHES.includes(name)) throw new Error(`unknown finish "${name}"`)
            state.finish = name
            applyFinish(name)
        },
        burst() {
            bursting = 1
            satellites.forEach((sat) => {
                sat.currentRadius = 4.2
            })
            const arr = pGeo.attributes.position.array

            for (let i = 0; i < COUNT; i++) {
                const x = arr[i * 3]
                const y = arr[i * 3 + 1]
                const z = arr[i * 3 + 2]
                const len = Math.hypot(x, y, z) || 1
                const f = 0.35 + Math.random() * 0.5
                vel[i * 3] += (x / len) * f
                vel[i * 3 + 1] += (y / len) * f
                vel[i * 3 + 2] += (z / len) * f
            }
            flash = 1
        },
        pulse() {
            flash = 1
        },
        getState() {
            return { ...state }
        },
        dispose() {
            cancelAnimationFrame(raf)
            ro.disconnect()
            io.disconnect()
            renderer.domElement.removeEventListener("pointerdown", onDown)
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", onUp)
            mesh.geometry.dispose()
            material.dispose()
            ring.geometry.dispose()
            ring2.geometry.dispose()
            ringMat.dispose()
            ring2.material.dispose()
            pGeo.dispose()
            pMat.dispose()
            envTex.dispose()
            pmrem.dispose()
            renderer.dispose()
            renderer.domElement.remove()
        },
    }
}
