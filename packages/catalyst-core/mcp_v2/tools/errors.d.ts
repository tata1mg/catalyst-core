// Hand-written type declaration for errors.js — that file stays plain CJS
// until a future source conversion (see issue #420); this exists only so
// require("../tools/errors.js") gets real types in test/errors.test.ts
// instead of `unknown`. Keep in sync with errors.js's actual shape by hand
// for now.

export interface ExplainErrorResult {
    code?: string
    error?: string
    is_catalyst_owned?: boolean
    category?: string
    message?: string
    details?: string
    suggestedAction?: string
    docUrl?: string
    note?: string
}

export function init(): void
export function handle_explain_error(args?: { code?: string }): ExplainErrorResult
