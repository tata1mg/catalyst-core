// Hand-written type declaration for config.js (plain CJS, see issue #420);
// used only by test/config.test.ts. Keep in sync by hand.

export interface ConfigFinding {
    field: string
    severity?: string
    message?: string
    note?: string
}

export interface CheckConfigResult {
    issues: ConfigFinding[]
    warnings: ConfigFinding[]
    passed: ConfigFinding[]
}

export function init(projectInfo: { dir: string }): void
export function handle_check_config(args?: { project_path?: string; platform?: string }): CheckConfigResult
