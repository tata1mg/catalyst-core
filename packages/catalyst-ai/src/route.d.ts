// Hand-written type declaration for route.js — that file stays plain CJS
// until a future source conversion (see issue #420); this exists only so
// require("../src/route.js") gets real types in test/route.test.ts instead
// of `unknown`. Keep in sync with route.js's actual shape by hand for now.
//
// Not importing express's own Router type here — catalyst-ai doesn't
// declare express as a direct dependency (it's provided transitively via
// catalyst-core), and @types/express isn't installed anywhere in this repo.
// The real export is an Express router; ExpressRouterLike below only
// declares the callable/middleware shape this package's own call sites
// actually touch (expressServer.js does `app.use(aiBasePath, aiRouter)`).

interface AIProviderConfig {
    apiKey: string
    defaultModel?: string
    [key: string]: unknown
}

interface AIConfig {
    enabled?: boolean
    basePath?: string
    providers?: Record<string, AIProviderConfig>
    [key: string]: unknown
}

// Common normalized usage shape every provider/API adapter maps onto —
// see route.js's own "usage normalization" comment block for the exact
// per-provider field-name differences this papers over.
interface NormalizedUsage {
    model: string
    promptTokens: number
    cachedTokens: number
    completionTokens: number
    reasoningTokens: number
}

interface RequestLike {
    body?: {
        messages?: unknown
        model?: unknown
        [key: string]: unknown
    }
}

interface ProviderConfigLike {
    defaultModel?: string
}

interface ResponseLike {
    status: number
    text(): Promise<string>
}

interface RouterInternal {
    getAIConfig(): AIConfig
    isAIEnabled(): boolean
    getProviderConfig(provider: string): AIProviderConfig | null
    validateRequestBody(req: RequestLike, cfg: ProviderConfigLike): string | null
    MODEL_NAME_RE: RegExp
    normalizeOpenAIChatUsage(usage: Record<string, unknown> | null | undefined, model: string): NormalizedUsage | null
    normalizeOpenAIResponsesUsage(usage: Record<string, unknown> | null | undefined, model: string): NormalizedUsage | null
    normalizeGeminiUsage(usageMetadata: Record<string, unknown> | null | undefined, model: string): NormalizedUsage | null
    normalizeGeminiInteractionUsage(usage: Record<string, unknown> | null | undefined, model: string): NormalizedUsage | null
    throwProviderError(provider: string, response: ResponseLike): Promise<never>
}

// Minimal shape of what an Express router actually is: a callable request
// handler with .use()/.get()/.post()/etc. attached. Deliberately not the
// full express.Router type (see the header comment above).
interface ExpressRouterLike {
    (req: unknown, res: unknown, next: unknown): void
    use(...args: unknown[]): ExpressRouterLike
    get(...args: unknown[]): ExpressRouterLike
    post(...args: unknown[]): ExpressRouterLike
}

// The real export is an Express Router with _internal attached as an extra
// property (see route.js's own comment on why).
type AIRouter = ExpressRouterLike & { _internal: RouterInternal }

declare const router: AIRouter
export = router
