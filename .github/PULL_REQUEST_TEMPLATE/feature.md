<!--
  Feature PR. Delete this comment block before submitting.
  Other forms: ?template=fix.md · ?template=chore.md
  (use &template=… if the URL already has a ?), or `gh pr create --template fix.md`.
-->

Closes #

## What

<!-- The capability being added, in one or two sentences. -->

## Why

<!-- The problem it solves or the use case it unblocks. -->

## New error codes

<!-- Keep whichever line applies; delete the other. -->

- [ ] Introduces new `CatalystError` code(s): `<CODE>` — `errors/` docs regenerated (`node packages/catalyst-core/src/errors/generateDocs.js`) and committed
- [ ] No new error codes

## Test coverage

<!-- What is now covered that was not. `coverage-summary` in CI reports per-platform line %. -->

- New tests: `<path>`
- Coverage delta:

---

- [ ] `npm run test:unit` passes locally
- [ ] `npm run lint` passes locally
- [ ] No new raw `throw new Error(...)` in changed files <!-- the check-error-wrapper gate (#439) is not built yet; this line becomes that gate when #439 lands -->
- [ ] Coverage gate (`coverage-summary`, #415/#437) not regressed
