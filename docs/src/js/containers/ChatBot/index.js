import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAI } from 'catalyst-core/hooks'
import { Link } from 'react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import searchDocs from '../../utils/docsSearch'

const SYSTEM_PROMPT = [
    'You are the assistant for the Catalyst documentation site (Tata1mg’s',
    'open-source React meta-framework, npm package "catalyst-core").',
    'Answer only from the documentation context supplied with the question, or',
    'from context supplied earlier in this conversation. Never invent an API:',
    'if the docs do not cover something, say so plainly.',
    'Style: lead with a 1–3 sentence summary — never paste the documentation',
    'back verbatim. When a genuine multi-step process is involved, show it as a',
    'compact flow (a short numbered list, or an arrow chain such as',
    '"Request → serverFetcher() runs on the server → data passed as props →',
    'component renders"); skip the flow when the answer is not a process.',
    'When the question is about a hook, function or API, give a short',
    'signature/shape summary in a fenced code block instead of prose.',
    'Keep the whole answer brief — markdown, no long paragraphs.',
    'Finish with one short line offering more depth, e.g. "Want the full',
    'walkthrough with examples?"; if the user then asks for more, go deep with',
    'the full detail and examples from the documentation context.',
].join(' ')

/**
 * Grounding: the docs manifest is searched per turn and the matching pages are
 * prepended to the question. The user's bubble still shows only what they
 * typed — this bulk goes to the model, not to the transcript.
 *
 * Returns the sources alongside so the UI can cite them deterministically
 * rather than trusting the model to echo the URLs back.
 */
const groundQuestion = (question) => {
    const pages = searchDocs(question, { limit: 3, relaxed: true })
    if (!pages.length) return { content: question, sources: [] }

    // Doc paths carry spaces ("/content/Guides and Tutorials/…"), which would
    // break a markdown link if the model quoted one raw.
    const context = pages
        .map(
            (page, index) =>
                `[${index + 1}] Title: ${page.title}\nURL: ${encodeURI(page.url)}\n${page.searchText}`
        )
        .join('\n\n')

    return {
        content: [
            'Documentation context (answer only from this, and cite the URLs given):',
            '',
            context,
            '',
            '---',
            `User question: ${question}`,
        ].join('\n'),
        sources: pages.map((page) => ({ title: page.title, url: page.url })),
    }
}

/**
 * Resize bounds for the drag handle. Below the minimum the composer and the
 * message bubbles get cramped. The upper cap is deliberately modest — the
 * page's own grids (feature cards, doc columns) size themselves off the
 * viewport, not off however much room the shifted `.docs-site` has left, so a
 * wide drag can leave them squeezed into a column width they were never
 * designed for. Fullscreen is the "go bigger" control; this cap just keeps
 * the in-between drag range from breaking the page underneath it. The
 * viewport share is recomputed per move in case the window itself changes
 * mid-drag.
 */
const MIN_PANEL_WIDTH = 340
const MAX_PANEL_WIDTH = 560
const clampPanelWidth = (width) =>
    Math.max(
        MIN_PANEL_WIDTH,
        Math.min(width, MAX_PANEL_WIDTH, window.innerWidth * 0.9)
    )

const ChatIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

const CloseIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
            d="M18 6 6 18M6 6l12 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
        />
    </svg>
)

/**
 * Assistant turns are markdown (summaries, flow lists, signature blocks, doc
 * links), so they get parsed; user turns stay literal text so a stray `#` or
 * `*` in a question is never interpreted as formatting.
 *
 * Links to this docs site navigate client-side, so the panel (and the
 * conversation in it) stays mounted. Cmd/Ctrl/Shift-click still opens a new
 * tab, as react-router's Link leaves modified clicks to the browser. External
 * links always open in a new tab.
 */
const isSiteHref = (href) => {
    if (!href) return false
    if (href.startsWith('/') && !href.startsWith('//')) return true
    if (typeof window === 'undefined') return false
    try {
        return new URL(href).origin === window.location.origin
    } catch {
        return false
    }
}

const toSitePath = (href) => {
    if (href.startsWith('/')) return href
    const url = new URL(href)
    return `${url.pathname}${url.search}${url.hash}`
}

const DocLink = ({ href, children, ...rest }) => {
    if (isSiteHref(href)) {
        return (
            <Link to={toSitePath(href)} {...rest}>
                {children}
            </Link>
        )
    }
    return (
        <a
            href={href}
            {...rest}
            target="_blank"
            rel="noopener noreferrer"
        >
            {children}
        </a>
    )
}

const MarkdownLink = (props) => {
    // react-markdown hands components the mdast `node`, which is not a valid
    // DOM attribute and must not be spread onto the anchor.
    const linkProps = { ...props }
    delete linkProps.node
    return <DocLink {...linkProps} />
}

const MARKDOWN_COMPONENTS = { a: MarkdownLink }

const MarkdownMessage = ({ content }) => (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {content}
    </ReactMarkdown>
)

/**
 * Citations for a turn, rendered from the retrieval result rather than from
 * anything the model wrote — the links are only trustworthy because they are
 * the pages that were actually fed in. Turns with no retrieval (follow-ups
 * riding on the previous turn's context) simply render nothing.
 */
const Sources = ({ sources }) => {
    if (!sources?.length) return null
    return (
        <div className="chatbot-sources">
            <span className="chatbot-sources-label">
                {sources.length > 1 ? 'Sources' : 'Source'}
            </span>
            <ul>
                {sources.map((source) => (
                    <li key={source.url}>
                        <DocLink href={encodeURI(source.url)}>
                            {source.title}
                        </DocLink>
                    </li>
                ))}
            </ul>
        </div>
    )
}

const ExpandIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
            d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

const CollapseIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
            d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

const SendIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
            d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

/**
 * Floating docs assistant: a launcher pinned bottom-right that opens a panel
 * docked to the right edge. Opening it stamps `chatbot-open` on <body>, which
 * is what shifts `.docs-site` left (see base/_chatbot.scss) — no other
 * component needs to know this component's state.
 *
 * Rendered by App as a sibling of <Outlet/>, so it sits outside the navbar's
 * backdrop-filter subtree and `position: fixed` resolves against the viewport;
 * unlike SearchModal, no portal is needed. App is server-rendered, so every
 * window/document touch lives in an effect.
 */
const ChatBot = () => {
    const [open, setOpen] = useState(false)
    const [messages, setMessages] = useState([])
    const [draft, setDraft] = useState('')
    // True from the moment a turn is sent until the hook settles, which is what
    // makes `output` belong to a bubble that is still being written.
    const [awaiting, setAwaiting] = useState(false)
    const [notice, setNotice] = useState(null)
    // Explicit panel width in px once the user has dragged the handle; null
    // means "no override", i.e. the stylesheet's own default still applies.
    // Survives a close/reopen — the component never unmounts.
    const [width, setWidth] = useState(null)
    const [fullscreen, setFullscreen] = useState(false)

    const inputRef = useRef(null)
    const listRef = useRef(null)
    const lastSentRef = useRef(null)
    // Latest clamped width during a drag. Moves are written straight to the DOM
    // for smoothness, so this is what gets committed to state on pointerup.
    const dragWidthRef = useRef(null)
    // Sources retrieved for the turn in flight, held until the assistant reply
    // is committed so the bubble can carry its own citations.
    const pendingSourcesRef = useRef([])

    const { output, streaming, loading, error, generate, cancel, clearError } =
        useAI({
            // Must be explicit. useAI falls back to AI_CONFIG.browser.provider
            // when no provider is passed, and this app configures that as
            // "transformers" — which would route the docs chat to in-browser
            // inference instead of the server. Naming the cloud provider here
            // keeps it on /ai/openai/*; the model comes from
            // AI_CONFIG.providers.openai.defaultModel.
            provider: 'openai',
            systemPrompt: SYSTEM_PROMPT,
            sessionMode: 'stateful',
            // Roomier than a plain prose answer needs: a summary plus a flow
            // list, an API signature block and the closing offer is a lot of
            // structure to truncate mid-way through.
            genConfig: { temperature: 0.3, maxTokens: 1500, stream: true },
        })

    const busy = loading || streaming

    // Both send() and retry() go through here so a replay is grounded exactly
    // like the original attempt.
    const dispatch = useCallback(
        (question) => {
            const { content, sources } = groundQuestion(question)
            pendingSourcesRef.current = sources
            setAwaiting(true)
            // sessionMode "stateful" continues the conversation server-side via
            // conversationId (OpenAI previous_response_id / Gemini
            // previous_interaction_id), and the local/native backends keep their
            // own history — so each call carries only the new turn. Replaying the
            // whole transcript here would double-count it. It also means a bare
            // follow-up ("yes, go deeper") still sees the documentation injected
            // on an earlier turn, which is why an empty retrieval is fine.
            generate({ messages: [{ role: 'user', content }] })
        },
        [generate]
    )

    const send = useCallback(
        (text) => {
            const content = text.trim()
            if (!content || busy) return
            lastSentRef.current = content
            setNotice(null)
            setMessages((current) => [...current, { role: 'user', content }])
            dispatch(content)
        },
        [busy, dispatch]
    )

    const handleSubmit = useCallback(() => {
        send(draft)
        setDraft('')
    }, [draft, send])

    const retry = useCallback(() => {
        if (!lastSentRef.current || busy) return
        clearError()
        setNotice(null)
        dispatch(lastSentRef.current)
    }, [busy, clearError, dispatch])

    // A turn is finished once the hook reports neither loading nor streaming.
    // `output` holds only the latest assistant turn and is cleared by the next
    // generate(), so it has to be committed into the local transcript here.
    useEffect(() => {
        if (!awaiting || busy) return
        setAwaiting(false)
        if (error) return
        const content = output.trim()
        if (content) {
            const sources = pendingSourcesRef.current
            pendingSourcesRef.current = []
            setMessages((current) => [
                ...current,
                { role: 'assistant', content, sources },
            ])
        } else {
            // Reached when the request produced nothing — most commonly because
            // catalyst-ai is not installed and useAI degraded to its no-op hook.
            setNotice(
                'No response came back. The AI provider may not be configured for this site.'
            )
        }
    }, [awaiting, busy, error, output])

    // Drives the content shift. Kept in an effect so SSR never touches document.
    useEffect(() => {
        document.body.classList.toggle('chatbot-open', open)
        return () => document.body.classList.remove('chatbot-open')
    }, [open])

    /**
     * The whole stylesheet derives from --chatbot-width — the panel, the
     * content shift and the launcher's slide — so setting that one property is
     * all either control has to do; everything else follows for free. Removing
     * it hands the default in base/_chatbot.scss back, rather than repeating
     * that number here.
     */
    useEffect(() => {
        const root = document.documentElement
        if (fullscreen) root.style.setProperty('--chatbot-width', '100vw')
        else if (width !== null)
            root.style.setProperty('--chatbot-width', `${width}px`)
        else root.style.removeProperty('--chatbot-width')
    }, [fullscreen, width])

    // Defensive only: App keeps this mounted for the life of the page.
    useEffect(
        () => () => {
            document.documentElement.style.removeProperty('--chatbot-width')
            document.body.classList.remove('chatbot-resizing')
        },
        []
    )

    // Pointer capture keeps the move/up events on the handle itself, so no
    // window-level listeners are needed and a fast drag cannot outrun them.
    const startResize = useCallback((event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.target.setPointerCapture(event.pointerId)
        dragWidthRef.current = null
        document.body.classList.add('chatbot-resizing')
    }, [])

    const onResizeMove = useCallback((event) => {
        if (!event.target.hasPointerCapture?.(event.pointerId)) return
        // The panel is pinned at right: 0, so the cursor's distance from the
        // right edge of the viewport is exactly the width being asked for.
        const next = clampPanelWidth(window.innerWidth - event.clientX)
        dragWidthRef.current = next
        // Straight to the DOM: a React round-trip per pointermove would make
        // the drag visibly lag the cursor.
        document.documentElement.style.setProperty(
            '--chatbot-width',
            `${next}px`
        )
    }, [])

    const endResize = useCallback((event) => {
        if (event.target.hasPointerCapture?.(event.pointerId))
            event.target.releasePointerCapture(event.pointerId)
        document.body.classList.remove('chatbot-resizing')
        // Commit so the value survives for the fullscreen toggle to restore.
        if (dragWidthRef.current !== null) setWidth(dragWidthRef.current)
        dragWidthRef.current = null
    }, [])

    useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
            if (event.key !== 'Escape') return
            // Un-fullscreen before closing, as fullscreen video does: the first
            // Escape restores the previous width, a second one closes.
            if (fullscreen) setFullscreen(false)
            else setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, fullscreen])

    useEffect(() => {
        if (!open) return
        inputRef.current?.focus()
    }, [open])

    // Follow the stream: every token append should keep the newest text visible.
    useEffect(() => {
        const list = listRef.current
        if (!list || !open) return
        list.scrollTop = list.scrollHeight
    }, [open, messages, output, awaiting, notice, error])

    // Leaving mid-stream should not keep a request open. Closing also drops
    // fullscreen — reopening should start from the normal drawer again — while
    // a dragged width is deliberately kept.
    useEffect(() => {
        if (open) return
        cancel()
        setAwaiting(false)
        setFullscreen(false)
    }, [open, cancel])

    const errorMessage = error?.message ?? notice

    return (
        <>
            <button
                type="button"
                className={`chatbot-launcher${open ? ' is-open' : ''}`}
                onClick={() => setOpen((current) => !current)}
                aria-label={open ? 'Close the docs assistant' : 'Ask Catalyst'}
                aria-expanded={open}
                aria-controls="chatbot-panel"
            >
                {open ? <CloseIcon /> : <ChatIcon />}
            </button>

            <aside
                id="chatbot-panel"
                className={`chatbot-panel${open ? ' is-open' : ''}${
                    fullscreen ? ' is-fullscreen' : ''
                }`}
                role="complementary"
                aria-label="Ask Catalyst"
                inert={!open}
            >
                <div
                    className="chatbot-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize chat panel"
                    onPointerDown={startResize}
                    onPointerMove={onResizeMove}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                />

                <header className="chatbot-header">
                    <div>
                        <h2 className="chatbot-title">Ask Catalyst</h2>
                        <p className="chatbot-subtitle">
                            Grounded in the real Catalyst docs
                        </p>
                    </div>
                    <div className="chatbot-header-actions">
                        <button
                            type="button"
                            className="chatbot-icon-button chatbot-fullscreen"
                            onClick={() => setFullscreen((current) => !current)}
                            aria-label={
                                fullscreen
                                    ? 'Exit fullscreen'
                                    : 'Expand to fullscreen'
                            }
                            aria-pressed={fullscreen}
                        >
                            {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
                        </button>
                        <button
                            type="button"
                            className="chatbot-icon-button"
                            onClick={() => setOpen(false)}
                            aria-label="Close the docs assistant"
                        >
                            <CloseIcon />
                        </button>
                    </div>
                </header>

                <div className="chatbot-messages" ref={listRef}>
                    {!messages.length && !awaiting && (
                        <div className="chatbot-empty">
                            <p>Here&apos;s what I can do:</p>
                            <ul>
                                <li>Explain any Catalyst API or concept</li>
                                <li>Link you straight to the doc page that covers it</li>
                                <li>Go deeper with examples when you ask</li>
                            </ul>
                        </div>
                    )}

                    {messages.map((message, index) =>
                        message.role === 'assistant' ? (
                            <div
                                /* Messages are append-only, so the index is stable. */
                                key={index}
                                className="chatbot-message chatbot-message-assistant chatbot-markdown"
                            >
                                <MarkdownMessage content={message.content} />
                                <Sources sources={message.sources} />
                            </div>
                        ) : (
                            <div
                                key={index}
                                className="chatbot-message chatbot-message-user"
                            >
                                {message.content}
                            </div>
                        )
                    )}

                    {awaiting &&
                        (output ? (
                            <div className="chatbot-message chatbot-message-assistant chatbot-markdown">
                                <MarkdownMessage content={output} />
                            </div>
                        ) : (
                            <div
                                className="chatbot-message chatbot-message-assistant chatbot-typing"
                                role="status"
                                aria-label="Generating a reply"
                            >
                                <span />
                                <span />
                                <span />
                            </div>
                        ))}

                    {errorMessage && (
                        <div className="chatbot-error" role="alert">
                            <span>{errorMessage}</span>
                            <button
                                type="button"
                                className="chatbot-retry"
                                onClick={retry}
                                disabled={busy || !lastSentRef.current}
                            >
                                Retry
                            </button>
                        </div>
                    )}
                </div>

                <div className="chatbot-composer">
                    <textarea
                        ref={inputRef}
                        className="chatbot-input"
                        rows={1}
                        value={draft}
                        placeholder="Ask a question…"
                        aria-label="Message the docs assistant"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                handleSubmit()
                            }
                        }}
                    />
                    <button
                        type="button"
                        className="chatbot-send"
                        onClick={handleSubmit}
                        disabled={busy || !draft.trim()}
                        aria-label="Send message"
                    >
                        <SendIcon />
                    </button>
                </div>
            </aside>
        </>
    )
}

export default ChatBot
