// Hand-written type declaration for github.js — that file stays plain CJS
// for now (same rationale as errors.d.ts / issue #420). This exists only so
// require("../tools/github.js") gets real types in test/github.test.ts
// instead of `unknown`. Keep in sync with github.js's actual exports by hand.

export interface IssueTemplate {
    label: string
    name: string
    use_when: string
    sections: string[]
}

export interface PrTemplate {
    change_type: "fix" | "feature" | "chore"
    name: string
    use_when: string
    sections: string[]
}

export const ISSUE_TEMPLATES: Record<string, IssueTemplate>
export const PR_TEMPLATES: Record<"fix" | "feature" | "chore", PrTemplate>
export const PR_FOOTER_CHECKLIST: string
export const DEFAULT_LABELS: string[]

export function init(projectInfo?: unknown): void

export function handle_create_github_issue(args?: Record<string, unknown>): Promise<Record<string, unknown>>

export function handle_create_github_pr(args?: {
    change_type?: "fix" | "feature" | "chore"
    title?: string
    body?: string
    summary?: string
    head?: string
    base?: string
    draft?: boolean
    dry_run?: boolean
    closes_issue?: string | number
    project_path?: string
    [key: string]: unknown
}): Promise<Record<string, unknown>>
