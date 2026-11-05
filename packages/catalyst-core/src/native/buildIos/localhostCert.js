"use strict"

// The shell's in-app HTTPS server (FrameworkServerUtils.swift) serves on
// localhost with the identity in localhost.p12, imported with an empty
// passphrase. WKWebView accepts it because WebViewNavigationDelegate trusts
// any server certificate for localhost/127.0.0.1 (no pinning), so a fresh
// self-signed pair per build works and no private key has to live in git.
//
// The PKCS#12 uses SHA1-3DES and a SHA-1 MAC: the format SecPKCS12Import has
// always read, and one OpenSSL 3 writes without its legacy provider and
// LibreSSL (/usr/bin/openssl on macOS) writes by default.
//
// Also runnable for CI or a manual Xcode build:
//   node src/native/buildIos/localhostCert.js [destination.p12]

const { execFileSync } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const DEFAULT_DESTINATION = path.join(
    __dirname,
    "..",
    "iosnativeWebView",
    "iosnativeWebView",
    "localhost.p12"
)
const VALIDITY_DAYS = 3650

function defaultRun(command, args) {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

/** openssl from PATH, else the one macOS ships. */
function opensslCandidates() {
    return ["openssl", "/usr/bin/openssl"]
}

/**
 * Write a new self-signed localhost identity to `destination`.
 *
 * @param {string} [destination]
 * @param {object} [options]
 * @param {(command: string, args: string[]) => string} [options.run]
 * @returns {string} the destination
 */
function generateLocalhostP12(destination = DEFAULT_DESTINATION, { run = defaultRun } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-localhost-cert-"))
    fs.chmodSync(dir, 0o700)
    const keyFile = path.join(dir, "key.pem")
    const certFile = path.join(dir, "cert.pem")
    const p12File = path.join(dir, "localhost.p12")
    try {
        let lastError = null
        for (const openssl of opensslCandidates()) {
            try {
                run(openssl, [
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-keyout",
                    keyFile,
                    "-out",
                    certFile,
                    "-days",
                    String(VALIDITY_DAYS),
                    "-subj",
                    "/O=Catalyst/CN=localhost",
                    "-addext",
                    "subjectAltName=DNS:localhost,IP:127.0.0.1",
                    "-addext",
                    "extendedKeyUsage=serverAuth",
                ])
                run(openssl, [
                    "pkcs12",
                    "-export",
                    "-inkey",
                    keyFile,
                    "-in",
                    certFile,
                    "-name",
                    "localhost",
                    "-out",
                    p12File,
                    "-passout",
                    "pass:",
                    "-certpbe",
                    "PBE-SHA1-3DES",
                    "-keypbe",
                    "PBE-SHA1-3DES",
                    "-macalg",
                    "sha1",
                ])
                lastError = null
                break
            } catch (error) {
                lastError = error
            }
        }
        if (lastError) {
            const detail = String(lastError.stderr || lastError.message || "")
                .trim()
                .split("\n")
                .pop()
            throw new Error(`Could not create the localhost certificate with openssl: ${detail}`)
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.copyFileSync(p12File, destination)
        return destination
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

module.exports = { generateLocalhostP12, DEFAULT_DESTINATION }

if (require.main === module) {
    const destination = path.resolve(process.argv[2] || DEFAULT_DESTINATION)
    generateLocalhostP12(destination)
    console.log(`Wrote ${destination}`)
}
