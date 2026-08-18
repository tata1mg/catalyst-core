/**
 * Measures structuredClone's cost on synthetic payloads approximating typical
 * loopback API responses, so the clone cost `dispatch.server.js` pays on every
 * loopback call (see api/dispatch.server.js) has a real number attached instead
 * of shipping unmeasured. Run directly: `node scripts/benchmark-loopback-clone.js`.
 *
 * A third-party deep-clone library (rfdc) was evaluated as a faster alternative
 * (2-4x in this same benchmark) and rejected: it doesn't throw on a function
 * property (silently keeps the reference instead) and crashes ungracefully on a
 * circular reference, where structuredClone throws a proper DataCloneError for
 * the former and handles the latter correctly. The safety property this clone
 * exists for — a route's mutation-safety guarantee failing loudly instead of
 * silently degrading — only holds with structuredClone.
 */

const buildRecord = (i) => ({
    id: i,
    name: `item-${i}`,
    price: Number((Math.random() * 100).toFixed(2)),
    inStock: i % 2 === 0,
    tags: ["a", "b", "c"],
    meta: { createdAt: new Date().toISOString(), views: i * 7 },
})

const buildPayload = (recordCount) => ({
    items: Array.from({ length: recordCount }, (_, i) => buildRecord(i)),
})

// Tuned by trial to land close to the target serialized size for each tier.
const TIERS = [
    { label: "1KB", recordCount: 8 },
    { label: "50KB", recordCount: 378 },
    { label: "500KB", recordCount: 3780 },
]

const ITERATIONS = 2000

const timeIt = (fn, payload, iterations) => {
    // Warm up so JIT compilation isn't counted against the measured run.
    for (let i = 0; i < 50; i++) fn(payload)

    const start = process.hrtime.bigint()
    for (let i = 0; i < iterations; i++) fn(payload)
    const end = process.hrtime.bigint()

    return Number(end - start) / 1e6 / iterations // ms per call
}

console.log(`Loopback clone benchmark (structuredClone) — ${ITERATIONS} iterations per tier, after 50-call warmup\n`)

for (const { label, recordCount } of TIERS) {
    const payload = buildPayload(recordCount)
    const actualBytes = Buffer.byteLength(JSON.stringify(payload))

    const structuredCloneMs = timeIt((p) => structuredClone(p), payload, ITERATIONS)

    console.log(`${label} tier (actual ${(actualBytes / 1024).toFixed(1)}KB, ${recordCount} records)`)
    console.log(`  structuredClone: ${structuredCloneMs.toFixed(4)}ms/call\n`)
}
