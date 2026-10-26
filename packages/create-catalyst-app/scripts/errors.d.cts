// Hand-written type declaration for errors.cjs — that file stays plain CJS
// until a future source conversion (see issue #420); this exists only so
// require("./errors.cjs") gets real types in test/errors.test.cts instead of
// `unknown`. Keep in sync with errors.cjs's actual shape by hand for now.

export interface ErrorDefinition {
    category: string
    defaultMessage: string
    defaultDetails: string
    suggestedAction: string
}

export type ErrorCodes = Record<string, string>
export type ErrorDefinitions = Record<string, ErrorDefinition>

export interface CCAErrorOverrides {
    message?: string
    details?: string
    suggestedAction?: string
    category?: string
    docUrl?: string
    cause?: unknown
}

export class CCAError extends Error {
    code: string
    category?: string
    details?: string
    suggestedAction?: string
    docUrl?: string
    cause?: unknown
    constructor(code: string, overrides?: CCAErrorOverrides)
}

export type OutputMode = "default" | "verbose" | "debug"

// formatError's debug mode just does Object.entries(env) and prints each
// key/value — getDebugEnvInfo() always returns all three fields, but any
// caller (including tests) may legitimately pass a partial record.
export type DebugEnvInfo = Partial<{
    node: string
    platform: string
    createCatalystApp: string
}> &
    Record<string, string>

export const ERROR_CODES: ErrorCodes
export const ERROR_DEFINITIONS: ErrorDefinitions

export function createError(code: string, overrides?: CCAErrorOverrides): CCAError
export function wrapForeignError(err: unknown): CCAError
export function formatError(err: CCAError, mode?: OutputMode, env?: DebugEnvInfo): string
export function resolveOutputMode(argv?: string[]): OutputMode
export function getDebugEnvInfo(): DebugEnvInfo
export function getDocUrl(code: string): string | null
