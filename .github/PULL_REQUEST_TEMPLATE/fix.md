<!--
  Bug-fix PR. Delete this comment block before submitting.
  Other forms: ?template=feature.md · ?template=chore.md
  (use &template=… if the URL already has a ?), or `gh pr create --template feature.md`.
-->

Closes #

## Root cause

<!-- What was actually wrong, at the level of the offending line or contract — not just the symptom. -->

## Repro

<!-- Minimal steps or the failing input that triggered it, before this change. -->

## Fix

<!-- What this PR changes, and why that closes the root cause. -->

## Regression test

<!-- Keep whichever line applies; delete the other. -->

- [ ] Added a test that fails without this fix and passes with it: `<path>`
- [ ] No regression test added — reason:

## Affected error codes

<!-- Any CatalystError codes whose behaviour or wording this touches, or "none". -->

none

---

- [ ] `npm run test:unit` passes locally
- [ ] `npm run lint` passes locally
- [ ] No new raw `throw new Error(...)` in changed files <!-- the check-error-wrapper gate (#439) is not built yet; this line becomes that gate when #439 lands -->
- [ ] Coverage gate (`coverage-summary`, #415/#437) not regressed
