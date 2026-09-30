<!--
  Default PR template. For a richer, change-type-specific form, reload the
  compare page with one of:

    ?template=fix.md       root cause · repro · regression test
    ?template=feature.md   what/why · new error codes · coverage delta
    ?template=chore.md     no-behaviour-change confirmation · what triggered it

  (use &template=… if the URL already has a ?), or from the CLI:

    gh pr create --template fix.md

  Otherwise, fill in the generic form below.
-->

Closes #

## Summary

<!-- What this changes and why. -->

## Change type

- [ ] **fix** — a bug fix (see `?template=fix.md` for the fuller form)
- [ ] **feature** — new capability (see `?template=feature.md`)
- [ ] **chore** — no behaviour change: deps, CI, refactor, docs (see `?template=chore.md`)

---

- [ ] `npm run test:unit` passes locally
- [ ] `npm run lint` passes locally
- [ ] No new raw `throw new Error(...)` in changed files <!-- the check-error-wrapper gate (#439) is not built yet; this line becomes that gate when #439 lands -->
- [ ] Coverage gate (`coverage-summary`, #415/#437) not regressed
