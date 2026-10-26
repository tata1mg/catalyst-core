// Run with `node --test scripts/release/` (built-in runner, no dependencies).
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { escapeRegExp, highestPrereleaseNumberIn, listedPackages, releaseState } = require("./release.js")

test("escapeRegExp makes every regex metacharacter literal", () => {
    const metacharacters = ".*+?^${}()|[]\\"
    const matcher = new RegExp(`^${escapeRegExp(metacharacters)}$`)

    assert.ok(matcher.test(metacharacters))
    assert.equal(escapeRegExp("1.2.3"), "1\\.2\\.3")
    assert.equal(escapeRegExp("plain-text_123"), "plain-text_123")
})

test("escapeRegExp neutralises patterns that would otherwise match broadly", () => {
    assert.equal(new RegExp(`^${escapeRegExp(".*")}$`).test("anything at all"), false)
    assert.equal(new RegExp(`^${escapeRegExp("a|b")}$`).test("a"), false)
})

test("highestPrereleaseNumberIn returns the highest N for the exact base and channel", () => {
    const versions = ["1.0.0-beta.1", "1.0.0-beta.3", "1.0.0-beta.2", "1.0.0-rc.9", "1.0.0"]

    assert.equal(highestPrereleaseNumberIn(versions, "1.0.0", "beta"), 3)
    assert.equal(highestPrereleaseNumberIn(versions, "1.0.0", "rc"), 9)
})

test("highestPrereleaseNumberIn returns 0 when nothing matches", () => {
    assert.equal(highestPrereleaseNumberIn([], "1.0.0", "beta"), 0)
    assert.equal(highestPrereleaseNumberIn(["1.0.0", "2.0.0-beta.4"], "1.0.0", "beta"), 0)
})

test("highestPrereleaseNumberIn treats dots in the base literally", () => {
    // An unescaped "." would let base "1.2.3" also match "1x2y3-beta.7".
    const versions = ["1x2y3-beta.7", "1.2.3-beta.2"]

    assert.equal(highestPrereleaseNumberIn(versions, "1.2.3", "beta"), 2)
})

test("highestPrereleaseNumberIn ignores similarly prefixed and suffixed versions", () => {
    const versions = [
        "1.2.3-beta.1",
        "11.2.3-beta.50", // base is only a suffix of this one
        "1.2.3-beta.1.4", // extra dotted segment
        "1.2.3-beta.x", // non-numeric
        "1.2.3-betamax.9", // channel is only a prefix of this one
        "1.2.3-beta.10",
    ]

    assert.equal(highestPrereleaseNumberIn(versions, "1.2.3", "beta"), 10)
})

test("highestPrereleaseNumberIn does not interpret channel or base as pattern syntax", () => {
    const versions = ["1.0.0-beta.5", "1.0.0-alpha.6"]

    assert.equal(highestPrereleaseNumberIn(versions, "1.0.0", "beta|alpha"), 0)
    assert.equal(highestPrereleaseNumberIn(versions, "1.0.0", ".*"), 0)
    assert.equal(highestPrereleaseNumberIn(versions, "1.0.0+", "beta"), 0)
})

const head = "4953f27c1f04456a1585e9728b9ed2be977e9d56"
const otherSha = "e85e02178e85e02178e85e02178e85e02178e85"

test("releaseState is new when the version is not on npm", () => {
    assert.equal(releaseState(null, head), "new")
})

test("releaseState is published-here when npm recorded this commit", () => {
    assert.equal(releaseState(head, head), "published-here")
})

test("releaseState is a collision when npm recorded another commit or none", () => {
    assert.equal(releaseState(otherSha, head), "collision")
    assert.equal(releaseState("", head), "collision")
    assert.equal(releaseState(undefined, head), "collision")
})

const manifests = { "catalyst-core": "1.0.1", "create-catalyst-app": "1.0.1", "catalyst-ai": "0.2.0" }

test("listedPackages returns the listed packages in publish order", () => {
    const meta = { branch: "feat/x", packages: { "create-catalyst-app": "1.0.1", "catalyst-core": "1.0.1" } }
    const listed = listedPackages(meta, manifests).map(
        ({ workspace, version }) => `${workspace.name}@${version}`
    )

    assert.deepEqual(listed, ["catalyst-core@1.0.1", "create-catalyst-app@1.0.1"])
})

test("listedPackages rejects an unknown package", () => {
    const meta = { packages: { "catalyst-core": "1.0.1", "left-pad": "1.0.0" } }

    assert.throws(() => listedPackages(meta, manifests), /unknown package 'left-pad'/)
})

test("listedPackages rejects a version that differs from package.json", () => {
    const meta = { packages: { "catalyst-core": "1.0.2" } }

    assert.throws(
        () => listedPackages(meta, manifests),
        /catalyst-core@1\.0\.2 but package\.json has 1\.0\.1/
    )
})

test("listedPackages rejects prerelease versions and malformed files", () => {
    assert.throws(
        () => listedPackages({ packages: { "catalyst-core": "1.0.1-beta.1" } }, manifests),
        /X\.Y\.Z/
    )
    assert.throws(() => listedPackages({ packages: {} }, manifests), /lists no packages/)
    assert.throws(() => listedPackages({ branch: "x" }, manifests), /packages object/)
    assert.throws(() => listedPackages(null, manifests), /packages object/)
})
