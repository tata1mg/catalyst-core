<!--
  Chore PR — no behaviour change (deps, CI/tooling, refactor, docs).
  Delete this comment block before submitting.
  Other forms: ?template=fix.md · ?template=feature.md
  (use &template=… if the URL already has a ?), or `gh pr create --template fix.md`.
-->

Closes #

## What triggered this

<!-- Dependency bump, CI tweak, flaky job, refactor, doc drift, etc. -->

## Change

<!-- What this PR does. -->

## No behaviour change

- [ ] Confirmed: no runtime behaviour change — output, public API, and error codes are unchanged

<!-- If anything observable changes, this is a fix or a feature — use that template instead. -->

---

- [ ] `npm run test:unit` passes locally
- [ ] `npm run lint` passes locally
- [ ] No new raw `throw new Error(...)` in changed files <!-- the check-error-wrapper gate (#439) is not built yet; this line becomes that gate when #439 lands -->
- [ ] Coverage gate (`coverage-summary`, #415/#437) not regressed
