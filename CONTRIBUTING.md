# Contributing to catalyst-core

## Setup

```sh
npm run setup   # installs deps + creates local docs config
```

Common commands: `npm run core:build`, `npm run core:test`, `npm run cca:test`,
`npm run docs:build`. See [README](./README.md#contributing) for the sandbox-app flow.

## Filing an issue

New issues go through a template — pick the one that fits:

| Template             | For                                                   |
| -------------------- | ----------------------------------------------------- |
| 🐛 Bug report        | broken, ignored, crashing, or misdocumented behaviour |
| ✨ Feature request   | a new capability, hook, or CLI/ergonomics change      |
| 📖 Documentation     | docs, examples, README, or API reference gaps         |
| 📦 Dependency update | a version bump, audit finding, or peer conflict       |
| ❓ Question          | usage guidance or a design decision                   |

Open-ended discussion belongs in
[Discussions](https://github.com/tata1mg/catalyst-core/discussions).

## Opening a pull request

PRs use a template by change type. On the compare page, append one of
`?template=fix.md`, `?template=feature.md`, or `?template=chore.md`
(`&template=…` if the URL already has a `?`), or from the CLI:

```sh
gh pr create --template fix.md
```

- **fix** — root cause, repro, regression test, affected error codes
- **feature** — what / why, new error codes (+ regenerate `errors/` docs via
  `node packages/catalyst-core/src/errors/generateDocs.js`), coverage delta
- **chore** — confirms no runtime behaviour change, what triggered it

Every PR shares a footer checklist:

- `npm run test:unit` passes locally
- `npm run lint` passes locally
- no new raw `throw new Error(...)` in changed files
- the coverage gate (`coverage-summary`) is not regressed

A local pre-commit hook (`.husky/pre-commit`) runs `lint-staged`, `test:unit`,
and a secret scan as a fast subset — CI is the actual required gate.

## MCP

The `catalyst-mcp` server (`packages/catalyst-core/mcp_v2`) can raise issues
and PRs directly (`create_github_issue`, `create_github_pr`); it renders the
same templates from an embedded copy kept in lockstep by
`mcp_v2/test/github.test.ts`. When you change a template file under
`.github/`, update the matching `ISSUE_TEMPLATES` / `PR_TEMPLATES` entry in
`mcp_v2/tools/github.js` or that test will fail.
