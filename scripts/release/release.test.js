// Run with `node --test scripts/release/` (built-in runner, no dependencies).
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { escapeRegExp, highestPrereleaseNumberIn } = require("./release.js")

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
