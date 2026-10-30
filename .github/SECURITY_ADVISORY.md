# Security advisories for releases

After a release that fixes security issues, draft a GitHub Security Advisory (and optionally request a CVE)
with the **Security Advisory** workflow. It is manual: nothing is created unless you run it with `dry_run` off,
and the draft still has to be published by an admin in the GitHub UI.

## 1. Mark the PR

Put a `## Security` block in the description of every PR that fixes a security issue. Only `Summary` is required.

```
## Security
Summary: Static server no longer follows symlinks outside the build dir
CVE: CVE-2026-1234, GHSA-xxxx-xxxx-xxxx
Severity: high
CWE: CWE-22
Affected: < 1.0.2
```

`Severity` is `low`, `medium`, `high` or `critical`. With several PRs the highest severity wins and the
`CVE`/`CWE` ids are merged. `Affected` defaults to `< <released version>`.

## 2. Run the workflow

Actions → **Security Advisory** → Run workflow, or from a terminal / AI tool:

```bash
# dry run (default): prints the advisory in the job summary, creates nothing
gh workflow run security-advisory.yml -f release_tag=catalyst-core@1.0.2

# create the draft advisory
gh workflow run security-advisory.yml -f release_tag=catalyst-core@1.0.2 -f dry_run=false

# create it and request a CVE
gh workflow run security-advisory.yml -f release_tag=catalyst-core@1.0.2 -f dry_run=false -f request_cve=true
```

The PRs come from the release notes. Optional inputs override the prefilled values: `pr_numbers`, `summary`,
`description`, `severity`, `cwe`, `affected_range`, `patched_version`.

## Using it from Claude Code, Codex or another AI tool

Ask the tool to "draft a security advisory for the latest release". It should:

1. List releases with `gh release list --repo tata1mg/catalyst-core` and ask which one.
2. Read the `## Security` blocks of the release's PRs and ask about anything missing or unclear
   (severity, CWE, whether to request a CVE).
3. Run the workflow as a dry run, read the job summary with `gh run view --log` and show it to you.
4. Only after you confirm, re-run with `dry_run=false` (and `request_cve=true` if you asked for it).

## Setup (once)

1. Create a token with **Repository security advisories: read and write** (fine-grained PAT, or a GitHub App
   installation token). The default `GITHUB_TOKEN` cannot use the advisories API.
2. Create an environment named `security-advisory` (Settings → Environments), add required reviewers, and store
   the token as the secret `SECURITY_ADVISORY_TOKEN` in it.
