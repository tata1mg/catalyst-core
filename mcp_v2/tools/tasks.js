'use strict';

const fs   = require('fs');
const path = require('path');
const { findCatalystRoot } = require('../lib/helpers');
const conversion = require('./conversion');

let _db;

function init(db) {
  _db = db;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ─── Improvement 1: Resolve needs_review inline before plan write ─────────────
//
// Reads signal_files from disk for each needs_review task.
// Returns { verdict: 'gap'|'completed', evidence } so the plan step is final.
// No needs_review items survive into the plan.

function resolveNeedsReview(task, projectRoot) {
  const rc = task.review_context;
  if (!rc || !rc.signal_files) {
    // No signal files to read — treat as gap (conservative)
    return { verdict: 'gap', evidence: 'No signal files available. Treating as gap to be safe.' };
  }

  const sf = rc.signal_files;

  // Collect all file lists from signal_files object
  const oldFiles      = sf.old_pattern_files      || [];
  const hookFiles     = sf.hook_usage_files        || [];
  const fetcherFiles  = sf.converted_files         || [];
  const correctFiles  = sf.correct_pattern_files   || [];

  // Read a sample of the old-pattern files (up to 3) to check for hook presence
  const samplesToCheck = oldFiles.slice(0, 3);
  const hookNames = {
    T4_DATA_FETCHING:    /serverFetcher|clientFetcher/,
    T17a_USE_FILEPICKER: /useFilePicker/,
    T17b_USE_CAMERA:     /useCamera/,
    T18_USE_HAPTIC:      /useHapticFeedback/,
    T20_USE_DEVICE_INFO: /__PLATFORM__|window\.__PLATFORM__/,
  };
  const hookRegex = hookNames[task.id];

  // If the task has hook_usage_files or correct_pattern_files already found → leaning completed
  const mitigationFiles = hookFiles.length ? hookFiles : correctFiles;

  if (mitigationFiles.length > 0) {
    // Hook/correct pattern IS present somewhere — check if it's in the same files
    // or at minimum in the project. We read the old-pattern files to see if they
    // import the hook directly, or accept it as a prop.
    let nativeBranchFound = false;
    for (const f of samplesToCheck) {
      try {
        const absPath = path.isAbsolute(f) ? f : path.join(projectRoot, f);
        const content = fs.readFileSync(absPath, 'utf8');
        if (hookRegex && hookRegex.test(content)) {
          nativeBranchFound = true;
          break;
        }
        // Props pattern: isNative or execute passed as props
        if (/isNative|execute\s*\(/.test(content)) {
          nativeBranchFound = true;
          break;
        }
      } catch {
        // file unreadable — skip
      }
    }

    if (nativeBranchFound) {
      return {
        verdict:  'completed',
        evidence: `Native branch confirmed in ${samplesToCheck.join(', ')}. Hook or isNative pattern found.`,
      };
    }

    // Hook exists elsewhere in project but NOT in the old-pattern files themselves.
    // Component tree pass-through is possible but unconfirmed — treat as gap.
    return {
      verdict:  'gap',
      evidence: `Hook found in ${mitigationFiles.slice(0,2).join(', ')} but not inside old-pattern files. ` +
                `Likely unconverted: ${oldFiles.slice(0,3).join(', ')}.`,
    };
  }

  // No mitigation files at all → definite gap
  return {
    verdict:  'gap',
    evidence: `No mitigation found. ${oldFiles.length} file(s) with old pattern: ${oldFiles.slice(0,3).join(', ')}.`,
  };
}

// ─── Improvement 2: Derive files_to_touch + missing_items per step ────────────
//
// For gap steps:
//   - files_to_touch: from gap.files (already collected by detector)
//   - missing_items:  for config tasks → missing config keys; for file-absence tasks → list missing files
// For resolved needs_review steps (verdict=gap):
//   - files_to_touch: from signal_files.old_pattern_files
//   - missing_items:  describe what needs to change in each file

function deriveFilesTouched(task, projectRoot) {
  // task here is a raw gap/needs_review item from get_conversion_status output
  const out = { files_to_touch: [], missing_items: [] };

  // From detector files array (T19_USE_NOTIFICATIONS, T13/T14 use this)
  if (task.files && task.files.length) {
    out.files_to_touch = task.files.slice(0, 10);
  }

  // From signal_files (needs_review-derived gaps)
  if (task.review_context?.signal_files) {
    const sf = task.review_context.signal_files;
    const candidates = (sf.old_pattern_files || []).slice(0, 10);
    out.files_to_touch = [...new Set([...out.files_to_touch, ...candidates])];
  }

  // Missing config keys (from reason string pattern "Missing fields: X, Y")
  const missingFieldsMatch = (task.reason || '').match(/Missing(?:\s+(?:fields|Android icons|iOS icons|Firebase files|Splash asset files|server files|client files))?:\s*(.+)/i);
  if (missingFieldsMatch) {
    out.missing_items = missingFieldsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  }

  // Files that don't exist yet (from reason string "not found" pattern)
  const notFoundMatch = (task.reason || '').match(/^(.+)\s+not found$/i);
  if (notFoundMatch && !out.files_to_touch.length) {
    out.files_to_touch = [notFoundMatch[1].trim()];
    out.missing_items  = ['File must be created'];
  }

  return out;
}

// ─── Improvement 3: bare_minimum section ─────────────────────────────────────
//
// Derives the ordered subset of tasks required for the first native build to run.
// = All Tier 1 gaps + Tier 2 gaps, sorted by depends_on (topological order).
// Blocked tasks are included only if their blocker is also in the set.

const TIER_1_IDS = ['T1_CONFIG','T2_ROUTER_DEP','T3_ROUTES_FILE','T4_DATA_FETCHING',
                    'T5_ROUTER_DATA_PROVIDER','T6_APP_SHELL','T7_SERVER_FILES','T8_CLIENT_ENTRY'];
const TIER_2_IDS = ['T9_WEBVIEW_ANDROID','T10_WEBVIEW_IOS','T11_ACCESS_CONTROL',
                    'T12_SPLASH_SCREEN','T13_ANDROID_ICONS','T14_IOS_ICONS','T15_OFFLINE_HTML'];

function buildBareMinimum(steps) {
  const bareIds = new Set([...TIER_1_IDS, ...TIER_2_IDS]);
  const bareSteps = steps.filter(s => bareIds.has(s.id) && s.status !== 'done');

  // Topological sort by depends_on
  const sorted = [];
  const visited = new Set();

  function visit(step) {
    if (visited.has(step.id)) return;
    visited.add(step.id);
    for (const depId of (step.depends_on || [])) {
      const depStep = bareSteps.find(s => s.id === depId);
      if (depStep) visit(depStep);
    }
    sorted.push(step);
  }

  for (const s of bareSteps) visit(s);

  return sorted.map((s, i) => ({
    order:       i + 1,
    id:          s.id,
    tier:        s.tier,
    title:       s.title,
    status:      s.status,
    files_to_touch: s.files_to_touch || [],
    missing_items:  s.missing_items  || [],
  }));
}

// ─── Main: build conversion steps with all 3 improvements ────────────────────

// Run live conversion detection and build a personalised step list from results.
// Completed tasks → pre-marked done. Gaps → pending with native_risk + fix_guide.
// needs_review → resolved inline to gap or completed. blocked → blocked status.
// Adds files_to_touch + missing_items per step. Builds bare_minimum block.
function getConversionStepsForGoal(goal, projectRoot) {
  if (!/convert|universal|native|migration|migrate/i.test(goal)) return null;

  let status;
  try {
    status = conversion.handle_get_conversion_status({});
  } catch {
    return null;
  }
  if (!status || status.error) return null;

  const steps = [];
  let i = 0;

  // Completed tasks — pre-marked done
  for (const t of (status.completed || [])) {
    steps.push({
      index:      i++,
      id:         t.id,
      tier:       t.tier,
      title:      t.title,
      detail:     `Already complete.${t.note ? ' Note: ' + t.note : ''}`,
      guide:      null,
      status:     'done',
      note:       t.note || null,
      updated_at: null,
    });
  }

  // Gaps — what needs fixing, ordered by tier
  for (const t of (status.gaps || [])) {
    const { files_to_touch, missing_items } = deriveFilesTouched(t, projectRoot);
    steps.push({
      index:          i++,
      id:             t.id,
      tier:           t.tier,
      title:          t.title,
      detail:         t.reason,
      native_risk:    t.native_risk,
      guide:          t.fix_guide,
      depends_on:     t.depends_on,
      files_to_touch,
      missing_items,
      status:         'pending',
      note:           null,
      updated_at:     null,
    });
  }

  // needs_review — resolve inline; no needs_review in final plan
  for (const t of (status.needs_review || [])) {
    const resolution = resolveNeedsReview(t, projectRoot);
    if (resolution.verdict === 'completed') {
      steps.push({
        index:      i++,
        id:         t.id,
        tier:       t.tier,
        title:      t.title,
        detail:     `Resolved as complete. ${resolution.evidence}`,
        guide:      null,
        status:     'done',
        note:       resolution.evidence,
        updated_at: null,
      });
    } else {
      // Resolved as gap
      const { files_to_touch, missing_items } = deriveFilesTouched(t, projectRoot);
      steps.push({
        index:          i++,
        id:             t.id,
        tier:           t.tier,
        title:          t.title,
        detail:         resolution.evidence,
        native_risk:    t.native_risk,
        guide:          t.fix_guide,
        depends_on:     t.depends_on,
        files_to_touch,
        missing_items,
        status:         'pending',
        resolved_from:  'needs_review',
        note:           null,
        updated_at:     null,
      });
    }
  }

  // Blocked — dependency not met
  for (const t of (status.blocked || [])) {
    steps.push({
      index:      i++,
      id:         t.id,
      tier:       t.tier,
      title:      t.title,
      detail:     `Blocked — depends on: ${(t.depends_on || []).join(', ')}`,
      depends_on: t.depends_on,
      status:     'blocked',
      note:       null,
      updated_at: null,
    });
  }

  if (steps.length === 0) return null;

  // Re-index
  steps.forEach((s, idx) => { s.index = idx; });

  // Build bare_minimum block (Improvement 3)
  const bare_minimum = buildBareMinimum(steps);

  return { steps, scan_summary: status.summary, bare_minimum };
}

// Generate generic steps when no conversion tasks apply.
// These are scaffolded from the goal string — Claude will flesh them out.
function scaffoldStepsFromGoal(goal) {
  return [
    { index: 0, title: 'Understand current state',   detail: `Review existing code relevant to: ${goal}`, status: 'pending', note: null, updated_at: null },
    { index: 1, title: 'Identify gaps',              detail: 'List what needs to change vs. what is already done.', status: 'pending', note: null, updated_at: null },
    { index: 2, title: 'Implement changes',          detail: 'Make the required code/config changes.', status: 'pending', note: null, updated_at: null },
    { index: 3, title: 'Test on target platform',    detail: 'Verify the change works. Check for regressions.', status: 'pending', note: null, updated_at: null },
    { index: 4, title: 'Mark complete + document',   detail: 'Note any findings, edge cases, or follow-up tasks.', status: 'pending', note: null, updated_at: null },
  ];
}

function getActivePlan(projectRoot) {
  return _db.prepare(`
    SELECT * FROM task_plans
    WHERE project_root = ? AND status = 'active'
    ORDER BY updated_at DESC LIMIT 1
  `).get(projectRoot);
}

function parsePlan(row) {
  return {
    ...row,
    steps: JSON.parse(row.steps),
  };
}

function summarisePlan(plan) {
  const steps = plan.steps;
  const done      = steps.filter(s => s.status === 'done').length;
  const blocked   = steps.filter(s => s.status === 'blocked').length;
  const pending   = steps.filter(s => s.status === 'pending').length;
  const next      = steps.find(s => s.status === 'pending') || null;
  const current   = steps.find(s => s.status === 'in_progress') || next;
  return { total: steps.length, done, blocked, pending, current_step: current };
}

// ─── MD file helpers ─────────────────────────────────────────────────────────

function getMdPath(projectRoot, slug) {
  return path.join(projectRoot, '.mcp_tasks', `${slug}.md`);
}

function buildUserReviewWarnings(projectRoot) {
  const warnings = [];
  const configPath = path.join(projectRoot, 'config', 'config.json');
  let config = null;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { return warnings; }

  const wc = config.WEBVIEW_CONFIG || {};

  // Android warnings
  const a = wc.android || {};
  if (a.sdkPath && !fs.existsSync(a.sdkPath)) {
    warnings.push(`Android SDK path "${a.sdkPath}" does not exist on this machine. Update WEBVIEW_CONFIG.android.sdkPath.`);
  }
  if (!a.emulatorName) {
    warnings.push('Android emulator name not set. Add WEBVIEW_CONFIG.android.emulatorName (run `emulator -list-avds` to find yours).');
  }

  // iOS warnings
  const ios = wc.ios || {};
  if (!wc.ios) {
    warnings.push('WEBVIEW_CONFIG.ios block is missing. iOS build will not work until added.');
  } else {
    if (!ios.appBundleId) {
      warnings.push('iOS app bundle ID not set. Add WEBVIEW_CONFIG.ios.appBundleId (e.g. com.company.appname). Must match your Apple Developer provisioning profile.');
    }
    if (!ios.simulatorName) {
      warnings.push('iOS simulator name not set. Add WEBVIEW_CONFIG.ios.simulatorName (run `xcrun simctl list devices` to find yours).');
    }
    if (!ios.appName) {
      warnings.push('iOS app name not set. Add WEBVIEW_CONFIG.ios.appName.');
    }
  }

  return warnings;
}

function writeMdFile(projectRoot, slug, goal, steps, bareMinimum, userReviewWarnings) {
  const dir = path.join(projectRoot, '.mcp_tasks');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const mdPath = getMdPath(projectRoot, slug);
  const today  = now().slice(0, 10);

  // Steps section
  const stepLines = steps.map(s => {
    const check = s.status === 'done' ? 'x' : ' ';
    const tier  = s.tier ? ` [T${s.tier}]` : '';
    const risk  = s.native_risk ? ` ⚠ ${s.native_risk}` : '';
    return `- [${check}]${tier} ${s.title}${risk}`;
  }).join('\n');

  // Current step
  const currentStep = steps.find(s => s.status === 'in_progress') || steps.find(s => s.status === 'pending');

  // Bare minimum section
  const bareLines = bareMinimum && bareMinimum.length
    ? bareMinimum.map(s => `${s.order}. [${s.status === 'done' ? 'x' : ' '}] ${s.title}`).join('\n')
    : '_All Tier 1+2 tasks complete._';

  // User review warnings
  const reviewLines = userReviewWarnings && userReviewWarnings.length
    ? userReviewWarnings.map(w => `- ⚠ ${w}`).join('\n')
    : '_No manual review items._';

  const content = `# Task: ${slug}
**Status:** in_progress
**Created:** ${today}
**Project:** ${path.basename(projectRoot)}

---

## Goal
${goal}

---

## User Review Required
${reviewLines}

---

## Bare Minimum (first native build)
${bareLines}

---

## Steps
${stepLines}

---

## Current Step
${currentStep ? currentStep.title : 'All steps complete.'}

---

## Findings
<!-- APPEND ONLY — never edit above this line -->

## Blockers
<!-- APPEND ONLY -->

## Decisions
<!-- APPEND ONLY -->
`;

  fs.writeFileSync(mdPath, content, 'utf8');
  return mdPath;
}

function updateMdFile(projectRoot, slug, steps) {
  const mdPath = getMdPath(projectRoot, slug);
  if (!fs.existsSync(mdPath)) return; // MD missing — skip silently, DB is source of truth

  let content = fs.readFileSync(mdPath, 'utf8');

  // Rebuild Steps section
  const stepLines = steps.map(s => {
    const check = s.status === 'done' ? 'x' : ' ';
    const tier  = s.tier ? ` [T${s.tier}]` : '';
    const risk  = s.native_risk ? ` ⚠ ${s.native_risk}` : '';
    return `- [${check}]${tier} ${s.title}${risk}`;
  }).join('\n');

  content = content.replace(
    /^## Steps\n[\s\S]*?(?=\n---)/m,
    `## Steps\n${stepLines}`
  );

  // Update Current Step
  const currentStep = steps.find(s => s.status === 'in_progress') || steps.find(s => s.status === 'pending');
  content = content.replace(
    /^## Current Step\n.*/m,
    `## Current Step\n${currentStep ? currentStep.title : 'All steps complete.'}`
  );

  fs.writeFileSync(mdPath, content, 'utf8');
}

function appendToMdFindings(projectRoot, slug, finding) {
  const mdPath = getMdPath(projectRoot, slug);
  if (!fs.existsSync(mdPath)) return;

  const line = `\n- ${now()} | ${finding}`;
  let content = fs.readFileSync(mdPath, 'utf8');
  content = content.replace('## Findings\n<!-- APPEND ONLY — never edit above this line -->', `## Findings\n<!-- APPEND ONLY — never edit above this line -->${line}`);
  fs.writeFileSync(mdPath, content, 'utf8');
}

// ─── Tool: create_task_plan ──────────────────────────────────────────────────

// Commands that are verified to exist in catalyst-core projects
const VALID_COMMANDS = new Set([
  'npm run build:android',
  'npm run build:android:release',
  'npm run build:ios',
  'npm run buildApp:android',
  'npm run buildApp:ios',
  'npm run buildApp:android:release',
  'npm run buildApp:ios:release',
  'npm run setupEmulator:android',
  'npm run setupEmulator:ios',
  'npm run devBuild',
  'npm run devServe',
  'npm run prepare',
  'node .catalyst/mcp/setup.js',
]);

function validateStepCommands(steps) {
  const invalid = [];
  for (const s of steps) {
    const text = `${typeof s === 'string' ? s : (s.title || '') + ' ' + (s.detail || '')}`;
    const cmds = text.match(/npm [\w:]+(?:\s[\w:]+)?|npx [\w@/-]+|node [\w./]+/g) || [];
    for (const cmd of cmds) {
      if (!VALID_COMMANDS.has(cmd)) {
        invalid.push(cmd);
      }
    }
  }
  return invalid;
}

function handle_create_task_plan({ goal, steps: customSteps } = {}) {
  if (!goal) return { error: 'goal is required.' };

  const catalystRoot = findCatalystRoot();
  if (!catalystRoot) return { error: 'No catalyst-core project found.' };

  const projectRoot = catalystRoot.dir;

  // Abandon any existing active plan for this project
  const existing = getActivePlan(projectRoot);
  if (existing) {
    _db.prepare(`UPDATE task_plans SET status='abandoned', updated_at=? WHERE id=?`)
       .run(now(), existing.id);
  }

  // Build steps
  let steps;
  let scan_summary  = null;
  let bare_minimum  = null;

  if (customSteps && Array.isArray(customSteps) && customSteps.length) {
    // Validate any commands in custom steps against known catalyst commands
    const invalidCmds = validateStepCommands(customSteps);
    if (invalidCmds.length > 0) {
      return {
        error: 'invalid_commands_in_steps',
        message: `Steps contain commands that do not exist in catalyst-core projects: ${invalidCmds.join(', ')}. Do not invent commands. Valid catalyst commands are: ${[...VALID_COMMANDS].join(', ')}. For conversion/migration goals, omit steps entirely — auto-generation runs live file detection and builds accurate steps.`,
        invalid_commands: invalidCmds,
        valid_commands: [...VALID_COMMANDS],
      };
    }
    steps = customSteps.map((s, i) => ({
      index: i,
      title: typeof s === 'string' ? s : s.title,
      detail: typeof s === 'string' ? '' : (s.detail || ''),
      status: 'pending',
      note: null,
      updated_at: null,
    }));
  } else {
    const result = getConversionStepsForGoal(goal, projectRoot);
    if (result) {
      steps = result.steps;
      scan_summary = result.scan_summary;
      bare_minimum = result.bare_minimum;
    } else {
      steps = scaffoldStepsFromGoal(goal);
    }
  }

  // Mark first non-done step in_progress
  const firstPending = steps.find(s => s.status === 'pending');
  if (firstPending) firstPending.status = 'in_progress';

  const slug = slugify(goal);
  const uniqueSlug = `${slug}-${Date.now()}`;

  _db.prepare(`
    INSERT INTO task_plans (slug, goal, project_root, status, steps, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)
  `).run(uniqueSlug, goal, projectRoot, JSON.stringify(steps), now(), now());

  // Write .mcp_tasks/<slug>.md
  const userReviewWarnings = buildUserReviewWarnings(projectRoot);
  const mdPath = writeMdFile(projectRoot, uniqueSlug, goal, steps, bare_minimum, userReviewWarnings);

  const summary = summarisePlan({ steps });
  const pendingSteps = steps.filter(s => s.status === 'pending' || s.status === 'in_progress');
  const resolvedFromReview = steps.filter(s => s.resolved_from === 'needs_review' && s.status !== 'done').length;

  return {
    created:       true,
    slug:          uniqueSlug,
    goal,
    project_root:  projectRoot,
    task_file:     mdPath,
    scan_summary,
    total_steps:   steps.length,
    done_already:  steps.filter(s => s.status === 'done').length,
    gaps:          pendingSteps.length,
    resolved_from_needs_review: resolvedFromReview || undefined,
    blocked:       steps.filter(s => s.status === 'blocked').length,
    current_step:  summary.current_step,
    user_review:   userReviewWarnings.length ? userReviewWarnings : undefined,
    bare_minimum,
    steps,
    tip: `Task file written to ${mdPath}. Call get_active_task to resume. Call update_task_step to mark progress.`,
  };
}

// ─── Tool: update_task_step ──────────────────────────────────────────────────

function handle_update_task_step({ step_index, status, note, plan_slug } = {}) {
  const catalystRoot = findCatalystRoot();
  if (!catalystRoot) return { error: 'No catalyst-core project found.' };

  const projectRoot = catalystRoot.dir;

  // Resolve plan
  let row = plan_slug
    ? _db.prepare(`SELECT * FROM task_plans WHERE slug=?`).get(plan_slug)
    : getActivePlan(projectRoot);

  if (!row) return { error: 'No active task plan found. Call create_task_plan first.' };

  const plan  = parsePlan(row);
  const steps = plan.steps;

  if (step_index == null || step_index < 0 || step_index >= steps.length) {
    return { error: `step_index out of range. Plan has ${steps.length} steps (0-based).` };
  }

  const validStatuses = ['done', 'blocked', 'skipped', 'in_progress', 'pending'];
  const newStatus = status || 'done';
  if (!validStatuses.includes(newStatus)) {
    return { error: `Invalid status "${newStatus}". Use: ${validStatuses.join(' | ')}` };
  }

  // Update the step
  steps[step_index].status     = newStatus;
  steps[step_index].note       = note || steps[step_index].note;
  steps[step_index].updated_at = now();

  // Auto-advance: if marking done, set next pending step to in_progress
  let next_step = null;
  if (newStatus === 'done' || newStatus === 'skipped') {
    const nextPending = steps.find(s => s.index > step_index && s.status === 'pending');
    if (nextPending) {
      nextPending.status     = 'in_progress';
      nextPending.updated_at = now();
      next_step = nextPending;
    }
  }

  // Check if all steps are terminal
  const allDone = steps.every(s => ['done', 'skipped', 'blocked'].includes(s.status));
  const planStatus = allDone ? 'completed' : 'active';

  _db.prepare(`
    UPDATE task_plans SET steps=?, status=?, updated_at=? WHERE id=?
  `).run(JSON.stringify(steps), planStatus, now(), row.id);

  // Sync MD file
  updateMdFile(plan.project_root, plan.slug, steps);
  if (note) appendToMdFindings(plan.project_root, plan.slug, note);

  const summary = summarisePlan({ steps });

  const result = {
    updated:      true,
    step_index,
    new_status:   newStatus,
    note:         note || null,
    plan_status:  planStatus,
    progress:     `${summary.done}/${summary.total} done`,
    next_step,
    all_steps:    steps,
  };

  if (allDone) {
    result.next_tool_call = {
      tool: 'close_task_plan',
      reason: `All ${summary.total} steps complete. You MUST call close_task_plan now. Ask the user: "Task complete — should I delete the task file at .mcp_tasks/${plan.slug}.md? (yes/no)" then call close_task_plan with delete_file:true or delete_file:false based on their answer.`,
    };
  }

  return result;
}

// ─── Tool: get_active_task ───────────────────────────────────────────────────

function handle_get_active_task({ include_all_steps } = {}) {
  const catalystRoot = findCatalystRoot();
  if (!catalystRoot) return { error: 'No catalyst-core project found.' };

  const projectRoot = catalystRoot.dir;
  const row = getActivePlan(projectRoot);

  if (!row) {
    // Also check if there's a recently completed plan
    const last = _db.prepare(`
      SELECT * FROM task_plans WHERE project_root=?
      ORDER BY updated_at DESC LIMIT 1
    `).get(projectRoot);

    return {
      active_plan: null,
      last_plan: last ? {
        slug:   last.slug,
        goal:   last.goal,
        status: last.status,
        updated_at: last.updated_at,
      } : null,
      message: last
        ? `No active plan. Last plan "${last.goal}" is ${last.status}. Call create_task_plan to start a new one.`
        : 'No task plans found for this project. Call create_task_plan to start.',
    };
  }

  const plan    = parsePlan(row);
  const summary = summarisePlan(plan);

  // By default only show non-done steps to keep response tight
  const visibleSteps = include_all_steps
    ? plan.steps
    : plan.steps.filter(s => s.status !== 'done' && s.status !== 'skipped');

  return {
    active_plan:  true,
    slug:         plan.slug,
    goal:         plan.goal,
    project_root: plan.project_root,
    task_file:    getMdPath(plan.project_root, plan.slug),
    created_at:   plan.created_at,
    updated_at:   plan.updated_at,
    progress:     `${summary.done}/${summary.total} done`,
    blocked:      summary.blocked > 0 ? summary.blocked : undefined,
    current_step: summary.current_step,
    pending_steps: visibleSteps,
    tip: include_all_steps ? undefined : 'Pass include_all_steps:true to see completed steps too.',
  };
}

// ─── Tool: close_task_plan ───────────────────────────────────────────────────

function handle_close_task_plan({ delete_file = false, plan_slug } = {}) {
  const catalystRoot = findCatalystRoot();
  if (!catalystRoot) return { error: 'No catalyst-core project found.' };

  const projectRoot = catalystRoot.dir;

  const row = plan_slug
    ? _db.prepare(`SELECT * FROM task_plans WHERE slug=?`).get(plan_slug)
    : getActivePlan(projectRoot) || _db.prepare(`
        SELECT * FROM task_plans WHERE project_root=? AND status='completed'
        ORDER BY updated_at DESC LIMIT 1
      `).get(projectRoot);

  if (!row) return { error: 'No active or recently completed task plan found.' };

  const plan  = parsePlan(row);
  const steps = plan.steps;
  const incomplete = steps.filter(s => !['done', 'skipped', 'blocked'].includes(s.status));

  if (incomplete.length > 0) {
    return {
      error:       'Plan has incomplete steps. Mark all steps done before closing.',
      incomplete:  incomplete.map(s => ({ index: s.index, title: s.title, status: s.status })),
      tip:         'Use update_task_step to mark remaining steps, or pass status:"skipped" to skip them.',
    };
  }

  // Mark DB record as closed
  _db.prepare(`UPDATE task_plans SET status='closed', updated_at=? WHERE id=?`)
     .run(now(), row.id);

  const mdPath = getMdPath(projectRoot, plan.slug);
  let file_deleted = false;

  if (delete_file) {
    if (fs.existsSync(mdPath)) {
      fs.unlinkSync(mdPath);
      file_deleted = true;
      // Clean up .mcp_tasks/ dir if empty
      const dir = path.dirname(mdPath);
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch { /* ignore */ }
    }
  } else {
    // Update MD status to done
    if (fs.existsSync(mdPath)) {
      let content = fs.readFileSync(mdPath, 'utf8');
      content = content.replace('**Status:** in_progress', `**Status:** done`);
      content = content.replace(
        '## Findings\n<!-- APPEND ONLY — never edit above this line -->',
        `## Findings\n<!-- APPEND ONLY — never edit above this line -->\n- ${now()} | Task closed. All steps complete.`
      );
      fs.writeFileSync(mdPath, content, 'utf8');
    }
  }

  const done    = steps.filter(s => s.status === 'done').length;
  const skipped = steps.filter(s => s.status === 'skipped').length;
  const blocked = steps.filter(s => s.status === 'blocked').length;

  return {
    closed:       true,
    slug:         plan.slug,
    goal:         plan.goal,
    summary:      `${done} done, ${skipped} skipped, ${blocked} blocked of ${steps.length} total.`,
    file_deleted,
    task_file:    file_deleted ? null : mdPath,
    message:      file_deleted
      ? `Plan closed and task file deleted.`
      : `Plan closed. Task file kept at ${mdPath}. Delete .mcp_tasks/ manually when done reviewing.`,
  };
}

module.exports = {
  init,
  handle_create_task_plan,
  handle_update_task_step,
  handle_get_active_task,
  handle_close_task_plan,
};
