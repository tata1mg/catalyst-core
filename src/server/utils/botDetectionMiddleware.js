import { getUserAgentDetails } from "./userAgentUtil.js"

// Loaded once at startup when OTEL is enabled; null otherwise.
let _context, _trace, _IS_BOT_KEY
if (process.env.OTEL_ENABLE === true) {
    try {
        const { context, trace } = await import("@opentelemetry/api")
        const { IS_BOT_KEY } = await import("../../otel.js")
        _context = context
        _trace = trace
        _IS_BOT_KEY = IS_BOT_KEY
    } catch {
        // otel packages not installed — context injection skipped
    }
}

export function botDetectionMiddleware(req, res, next) {
    const ua = req.headers["user-agent"] || ""
    const { googleBot, aiBot, statusCakeBot } = getUserAgentDetails(ua)
    const isBot = !!(googleBot || aiBot || statusCakeBot)
    res.locals.is_bot = isBot

    if (_context && _IS_BOT_KEY) {
        _trace?.getActiveSpan()?.setAttribute("http.response.is_bot", isBot)
        _context.with(_context.active().setValue(_IS_BOT_KEY, isBot), next)
    } else {
        next()
    }
}
