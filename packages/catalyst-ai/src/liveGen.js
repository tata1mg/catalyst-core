// Gemini Live API, server side: mint a short-lived ephemeral token so the browser can open the WebSocket itself without
// ever seeing the API key. Models come from config (`liveModel`), never hardcoded. CJS, loaded by route.js.

const TOKEN_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens"
const WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained"
// One use; the browser has a minute to open the socket and the session may run this long. Docs allow up to 20 h.
const START_WITHIN_MS = 60_000
const SESSION_MS = 15 * 60_000

/** Setup the browser must send first. Kept in one place so the token's constraints and the client's setup agree. */
function liveSetup(model, languageCodes = []) {
    return {
        model: `models/${model}`,
        generationConfig: { responseModalities: ["TEXT"] },
        inputAudioTranscription: { languageCodes },
    }
}

async function createLiveToken({ apiKey, model, now = Date.now(), throwProviderError }) {
    const body = {
        uses: 1,
        expireTime: new Date(now + SESSION_MS).toISOString(),
        newSessionExpireTime: new Date(now + START_WITHIN_MS).toISOString(),
        // REST name is bidiGenerateContentSetup (the docs also show liveConnectConstraints, which the API rejects).
        bidiGenerateContentSetup: liveSetup(model),
    }
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
    })
    if (!response.ok) await throwProviderError("gemini", response)
    const data = await response.json()
    if (typeof data?.name !== "string" || !data.name) throw new Error("gemini returned no token")
    return { token: data.name, model, expiresAt: body.expireTime, startBy: body.newSessionExpireTime, url: WS_URL, setup: liveSetup(model) }
}

module.exports = { createLiveToken, liveSetup, TOKEN_URL, WS_URL }
