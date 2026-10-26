import { randomUUID } from 'crypto'

/**
 * Anthropic (Claude) provider for the /ai endpoints.
 *
 * catalyst-ai ships a hardcoded provider registry — `openai` and `gemini` only
 * (node_modules/catalyst-ai/src/route.js) — and its `/:provider/*` handlers 404
 * anything else. Rather than patch a third-party package, these routes are
 * registered from this app's own `addMiddlewares`, which catalyst-core runs
 * *before* it mounts the catalyst-ai router. Express matches in registration
 * order, so `/ai/anthropic/{stream,generate}` resolve here and every other
 * provider still falls through to catalyst-ai untouched.
 *
 * The request/response contract is catalyst-ai's, not ours: useCloudAI is the
 * client on the other end, so the SSE frames and the JSON body below mirror
 * route.js exactly (`data: {token|conversationId|usage}` … `data: [DONE]`).
 */

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// Hard ceiling on how long a single /stream request may run upstream — matches
// catalyst-ai's own timeout so both providers behave the same.
const STREAM_TIMEOUT_MS = 120000

// Anthropic requires max_tokens on every request; there is no server default.
const DEFAULT_MAX_TOKENS = 1024

// ─── config ─────────────────────────────────────────────────────────────────
// catalyst-ai keeps these private, so small local equivalents live here. Same
// source (process.env.AI_CONFIG, written from config/config.json by
// catalyst-core's loadEnvironmentVariables) and the same error strings.

function getAIConfig() {
    try {
        return JSON.parse(process.env.AI_CONFIG || '{}')
    } catch {
        return {}
    }
}

function isAIEnabled() {
    return getAIConfig()?.enabled === true
}

function getProviderConfig() {
    const cfg = getAIConfig()?.providers?.anthropic
    if (!cfg || !cfg.apiKey) return null
    return cfg
}

// Returns an error string if the request body is invalid, otherwise null.
function validateRequestBody(req, cfg) {
    const { messages, model } = req.body ?? {}
    if (!Array.isArray(messages) || messages.length === 0)
        return 'messages must be a non-empty array'
    const resolvedModel = model || cfg.defaultModel
    if (!resolvedModel)
        return 'no model specified and provider has no defaultModel configured'
    return null
}

function sseHeaders(res) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
}

// ─── conversation store ─────────────────────────────────────────────────────

/**
 * In-memory transcripts, keyed by conversationId.
 *
 * OpenAI and Gemini continue a stateful session with a server-side token
 * (`previous_response_id` / `previous_interaction_id`), so catalyst-ai can send
 * just the newest turn and let the provider remember the rest. Anthropic's
 * Messages API is stateless — there is no such token — so the history has to
 * live on this side. useCloudAI only ever sends the new turn, so this process
 * holds everything before it and replays the whole thing on each request.
 *
 * LIMITATION — this is a plain in-process Map: transcripts are lost on every
 * server restart, and they are NOT shared between instances. Behind more than
 * one replica a follow-up turn can land on a process that has never seen the
 * conversation and will answer without its history. That is an accepted
 * tradeoff for this docs site (one dev/staging Node process); a real multi-
 * instance deployment would need a shared store such as Redis.
 */
const conversations = new Map()

// Bounds, so a long-lived process can't grow without limit.
const MAX_CONVERSATIONS = 500
const MAX_MESSAGES_PER_CONVERSATION = 40

function extractSystemPrompt(messages) {
    // useCloudAI prepends a { role: 'system' } entry on *every* call because
    // ChatBot sets systemPrompt. Anthropic rejects a system role inside
    // `messages` — it takes the text as a top-level `system` field instead.
    const system = messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n')
    return system || undefined
}

function toAnthropicMessages(messages) {
    return messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
        }))
}

// Re-inserting on write makes the Map least-recently-used ordered, so the
// oldest idle conversation is the one evicted.
function remember(id, history) {
    // Anthropic requires the first message to be a user turn, so trim from the
    // front and then drop any assistant reply left stranded at the head.
    let trimmed =
        history.length > MAX_MESSAGES_PER_CONVERSATION
            ? history.slice(history.length - MAX_MESSAGES_PER_CONVERSATION)
            : history
    const firstUser = trimmed.findIndex((message) => message.role === 'user')
    if (firstUser > 0) trimmed = trimmed.slice(firstUser)

    conversations.delete(id)
    conversations.set(id, trimmed)
    while (conversations.size > MAX_CONVERSATIONS) {
        conversations.delete(conversations.keys().next().value)
    }
    return trimmed
}

// Resolves the conversation this request belongs to and returns the full
// message list to send upstream. Stateless requests are passed straight through.
function openTurn({ stateful, conversationId, messages }) {
    const incoming = toAnthropicMessages(messages)
    if (!stateful) return { id: null, history: incoming }

    const id =
        conversationId && conversations.has(conversationId)
            ? conversationId
            : randomUUID()
    const history = remember(id, [
        ...(conversations.get(id) ?? []),
        ...incoming,
    ])
    return { id, history }
}

// Commits the assistant's reply once the full text is known.
function closeTurn(id, text) {
    if (!id || !text) return
    const history = conversations.get(id)
    if (!history) return
    remember(id, [...history, { role: 'assistant', content: text }])
}

// ─── request shaping ────────────────────────────────────────────────────────

/**
 * Which generation the configured model belongs to. Claude Sonnet 5, Opus 5,
 * the Fable/Mythos family and everything from 4.6 on removed the sampling
 * knobs: sending `temperature` or `top_p` is a 400, not a warning. They also
 * run adaptive thinking by default, which would spend most of a ~1K token
 * ceiling on reasoning this chat never renders. ChatBot sends
 * `temperature: 0.3` and `maxTokens: 1024`, so forwarding genConfig verbatim
 * would fail every request against the default model.
 *
 * Older ids (claude-haiku-4-5, claude-sonnet-4-5, …) are the mirror image: they
 * accept temperature/top_p and predate `output_config`. So the two are chosen
 * per model rather than sent together.
 */
const CURRENT_GENERATION =
    /^claude-(fable|mythos|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)\b/

function buildRequestBody({ model, system, messages, genConfig, stream }) {
    const body = {
        model,
        max_tokens: genConfig?.maxTokens || DEFAULT_MAX_TOKENS,
        messages,
        stream,
        ...(system && { system }),
    }

    if (CURRENT_GENERATION.test(model)) {
        // Cheapest reasoning depth: right for a docs Q&A, and it keeps the
        // visible answer inside a small max_tokens budget.
        body.output_config = { effort: 'low' }
    } else {
        if (genConfig?.temperature != null)
            body.temperature = genConfig.temperature
        if (genConfig?.topP != null) body.top_p = genConfig.topP
    }

    return body
}

function anthropicHeaders(apiKey) {
    return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
    }
}

// Normalized to catalyst-ai's shape (see normalizeOpenAIChatUsage in route.js).
// Anthropic folds thinking tokens into output_tokens with no separate count, so
// reasoningTokens stays 0 rather than being guessed at.
function normalizeAnthropicUsage({
    model,
    inputTokens,
    cachedTokens,
    outputTokens,
}) {
    return {
        model,
        promptTokens: inputTokens ?? 0,
        cachedTokens: cachedTokens ?? 0,
        completionTokens: outputTokens ?? 0,
        reasoningTokens: 0,
    }
}

// ─── adapters ───────────────────────────────────────────────────────────────

async function anthropicStream({
    apiKey,
    model,
    messages,
    genConfig,
    conversationId,
    stateful,
    res,
    signal,
}) {
    const system = extractSystemPrompt(messages)
    const { id, history } = openTurn({ stateful, conversationId, messages })

    // Emitted before anything else so the client holds the id even if the turn
    // fails part-way through.
    if (id) res.write(`data: ${JSON.stringify({ conversationId: id })}\n\n`)

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: anthropicHeaders(apiKey),
        body: JSON.stringify(
            buildRequestBody({
                model,
                system,
                messages: history,
                genConfig,
                stream: true,
            })
        ),
        signal,
    })
    if (!response.ok)
        throw new Error(
            `Anthropic API error (${response.status}): ${await response.text()}`
        )

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let inputTokens = 0
    let cachedTokens = 0
    let outputTokens = 0

    const finish = () => {
        closeTurn(id, text)
        const usage = normalizeAnthropicUsage({
            model,
            inputTokens,
            cachedTokens,
            outputTokens,
        })
        res.write(`data: ${JSON.stringify({ usage })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
    }

    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
            const trimmed = line.trim()
            // Anthropic labels each frame with an `event:` line too, but the
            // JSON payload carries the same name in `type` — so only the
            // `data:` lines need parsing.
            if (!trimmed || !trimmed.startsWith('data:')) continue
            const payload = trimmed.slice(5).trim()
            let parsed
            try {
                parsed = JSON.parse(payload)
            } catch {
                continue
            }
            if (parsed.type === 'message_start') {
                inputTokens = parsed.message?.usage?.input_tokens ?? 0
                cachedTokens =
                    parsed.message?.usage?.cache_read_input_tokens ?? 0
            }
            if (
                parsed.type === 'content_block_delta' &&
                parsed.delta?.type === 'text_delta' &&
                parsed.delta.text
            ) {
                // Only text deltas are forwarded; thinking deltas, when the
                // model emits them, are not part of the answer.
                text += parsed.delta.text
                res.write(
                    `data: ${JSON.stringify({ token: parsed.delta.text })}\n\n`
                )
            }
            if (parsed.type === 'message_delta') {
                outputTokens = parsed.usage?.output_tokens ?? outputTokens
            }
            if (parsed.type === 'error') {
                throw new Error(
                    `Anthropic stream error: ${parsed.error?.message ?? payload}`
                )
            }
            if (parsed.type === 'message_stop') {
                finish()
                return
            }
        }
    }

    // Upstream closed without a message_stop — finalize with what arrived.
    finish()
}

async function anthropicGenerate({
    apiKey,
    model,
    messages,
    genConfig,
    conversationId,
    stateful,
}) {
    const system = extractSystemPrompt(messages)
    const { id, history } = openTurn({ stateful, conversationId, messages })

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: anthropicHeaders(apiKey),
        body: JSON.stringify(
            buildRequestBody({
                model,
                system,
                messages: history,
                genConfig,
                stream: false,
            })
        ),
    })
    if (!response.ok)
        throw new Error(
            `Anthropic API error (${response.status}): ${await response.text()}`
        )

    const data = await response.json()
    const output = (data.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')

    closeTurn(id, output)

    return {
        output,
        conversationId: id,
        usage: normalizeAnthropicUsage({
            model,
            inputTokens: data.usage?.input_tokens,
            cachedTokens: data.usage?.cache_read_input_tokens,
            outputTokens: data.usage?.output_tokens,
        }),
    }
}

// ─── routes ─────────────────────────────────────────────────────────────────

// Rejects the request if AI is off or Anthropic has no key, and returns the
// resolved provider config otherwise. Error strings match catalyst-ai's.
function resolveRequest(req, res) {
    if (!isAIEnabled()) {
        res.status(403).json({
            error: 'AI is disabled. Set AI_CONFIG.enabled=true to enable.',
        })
        return null
    }

    const cfg = getProviderConfig()
    if (!cfg) {
        res.status(404).json({ error: 'Provider "anthropic" not configured' })
        return null
    }

    const validationError = validateRequestBody(req, cfg)
    if (validationError) {
        res.status(400).json({ error: validationError })
        return null
    }

    return cfg
}

export function mountAnthropicAI(app) {
    // catalyst-core mounts the catalyst-ai router at the same base path, so
    // read it the same way it does.
    const basePath = getAIConfig()?.basePath || '/ai'

    app.post(`${basePath}/anthropic/stream`, async (req, res) => {
        const cfg = resolveRequest(req, res)
        if (!cfg) return

        const { messages, genConfig = {}, conversationId, model } = req.body
        const stateful = 'conversationId' in req.body

        const abortController = new AbortController()
        const timeout = setTimeout(
            () => abortController.abort(),
            STREAM_TIMEOUT_MS
        )
        // res "close" (not req "close") — the request body of a small JSON POST
        // is fully read almost immediately, which would abort before the
        // upstream stream had started.
        res.on('close', () => abortController.abort())

        sseHeaders(res)
        try {
            await anthropicStream({
                apiKey: cfg.apiKey,
                model: model || cfg.defaultModel,
                messages,
                genConfig,
                conversationId,
                stateful,
                res,
                signal: abortController.signal,
            })
        } catch (err) {
            console.error('[docs/ai] anthropic stream error:', err.message)
            if (!res.writableEnded) {
                res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
                res.end()
            }
        } finally {
            clearTimeout(timeout)
        }
    })

    app.post(`${basePath}/anthropic/generate`, async (req, res) => {
        const cfg = resolveRequest(req, res)
        if (!cfg) return

        const { messages, genConfig = {}, conversationId, model } = req.body
        const stateful = 'conversationId' in req.body
        const resolvedModel = model || cfg.defaultModel

        try {
            const result = await anthropicGenerate({
                apiKey: cfg.apiKey,
                model: resolvedModel,
                messages,
                genConfig,
                conversationId,
                stateful,
            })
            res.json({ ...result, model: resolvedModel })
        } catch (err) {
            console.error('[docs/ai] anthropic generate error:', err.message)
            res.status(500).json({ error: err.message })
        }
    })
}
