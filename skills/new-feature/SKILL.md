---
name: new-feature
description: Walk a contributor through shipping a new feature or fix in catalyst-core — tracking issue, branch, design proposal, implementation, docs, PR. Use when a contributor says a feature/fix is ready to start or is asking "what do I do next" for new work.
---

# New feature workflow (catalyst-core)

This repo tracks 1.0 work as an Epic → Story → Task hierarchy on GitHub (see
issue #329 for the current 1.0 epic). This skill walks a contributor through
the same steps used to ship task #359 (unified error codes), so the workflow
doesn't have to be reinvented each time.

Go through the steps below **in order**, asking the user at each one rather
than assuming. Do not skip a step because it seems obvious — the user may have
context you don't (e.g. this might not belong under the current epic at all).

## Step 1 — Locate or create the tracking issue

Ask:
- Does this already have a GitHub issue? If yes, get the number and read it.
- If no: does it belong under the current 1.0 epic (#329)? If yes, which Story?
  List the open stories (`gh issue view 329 --json body` or check the sub-issues
  via the GraphQL `subIssues` field) and ask the user to pick one, or confirm
  it's net-new/outside the epic.
- Create the issue with a clear headline + description (see the #359–#368 issues
  for the format: `## Description`, `## Acceptance criteria`, `## Parent`).
- If it nests under a Story, link it as a native GitHub sub-issue via the
  `addSubIssue` GraphQL mutation (see prior session history for the exact call
  shape) — don't just mention the parent in text.
- Assign the issue to the contributor.

## Step 2 — Create the branch

- Derive a `feature/<slug>` (or `fix/<slug>` for bug fixes) name from the issue title.
- **Branch from `origin/main`**, not from whatever is currently checked out —
  the current branch may have unrelated in-progress/uncommitted work that
  shouldn't be inherited.
- If the current working tree has uncommitted changes or is mid-work on another
  branch, use `git worktree add ../catalyst-core-<slug> <branch>` instead of
  switching branches in place, so the two efforts don't collide.

## Step 3 — Proposal before code (gate)

Before writing any implementation:
- Post a design comment on the issue covering: what's being built, why this
  approach over alternatives, what files/modules it touches, and a closing
  section on **why this matters for the current release** (ties back to the
  epic/story it gates, or explains why it doesn't gate anything if it's
  independent work).
- Do not start implementation until this is posted. If the user says the
  change is trivial enough to skip (e.g. a one-line fix, a typo), that's a
  valid reason to skip — but ask first, don't assume.

## Step 4 — Implementation

- Before writing new code, look for an existing pattern to follow rather than
  inventing one. Examples already established in this repo:
  - Error codes / registry pattern: `packages/catalyst-core/src/errors/`
  - MCP tool pattern: `packages/catalyst-core/mcp_v2/tools/*.js` (each exports
    `init(...)` + `handle_<name>`, registered in `mcp_v2/mcp.js`'s tool list and
    dispatch map)
  - Validator pattern: `packages/catalyst-core/src/scripts/validator.js` /
    `src/server/utils/validator.js`
- Watch for module-system boundaries: `src/native/` is CJS-only (see its local
  `package.json` with `"type": "commonjs"`), while most of the rest of
  `packages/catalyst-core/src` is ESM. Code crossing that boundary can't use a
  plain `require()`/`import` across it under Node 20 — check before assuming
  an import will resolve.
- Verify changes actually work, not just that they parse. `node --check` only
  catches syntax. For each call site touched, confirm the error/output that
  surfaces actually names the right thing — don't rely on the happy-path test
  alone.

## Step 5 — Docs

Ask whether this change needs:
- An entry under `docs/content/` (user-facing framework docs), and/or
- A new entry under the top-level `errors/<CATEGORY>/` folder, if it introduces
  a new error code (see Step 4's registry pattern — docs are generated from
  `packages/catalyst-core/src/errors/registry.js` via `generateDocs.js`, don't
  hand-write them separately).

## Step 6 — Pull request

- Draft a PR description: summary, why, test plan, and a reference to the
  issue number (`Closes #<n>`).
- **Do not push or open the PR without explicit confirmation** — opening a PR
  is a shared-visibility action, same as pushing or commenting on an issue on
  behalf of the team.
