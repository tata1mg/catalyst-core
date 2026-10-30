#!/usr/bin/env bash
# Builds a GitHub Security Advisory payload from the "## Security" block of the PRs in a release.
#
# Reads the release notes of RELEASE_TAG, collects the PRs they reference (or PR_NUMBERS), parses the
# "## Security" block of each PR body, merges them, then applies any override env var on top.
# Writes the REST payload to $OUT (default advisory-payload.json) and a markdown preview to stdout.
#
# Security block (in the PR description), every key optional except Summary:
#   ## Security
#   Summary: one line, what was fixed
#   CVE: CVE-2026-1234, GHSA-xxxx-xxxx-xxxx   (resolved ids, listed in the description)
#   Severity: low | medium | high | critical
#   CWE: CWE-79, CWE-400
#   Affected: < 1.0.2                         (default: < the released version)
#
# Env: REPO, RELEASE_TAG, GH_TOKEN (read access), PR_NUMBERS, and the overrides
#      SUMMARY, DESCRIPTION, SEVERITY, CWE, AFFECTED_RANGE, PATCHED_VERSION, PACKAGE_NAME.
set -euo pipefail

: "${REPO:?}" "${RELEASE_TAG:?}"
OUT="${OUT:-advisory-payload.json}"

# catalyst-core@1.0.2 -> package catalyst-core, version 1.0.2
tag_package="${RELEASE_TAG%@*}"
tag_version="${RELEASE_TAG##*@}"
tag_version="${tag_version#v}"
[[ "$RELEASE_TAG" == *@* ]] || tag_package="catalyst-core"

package="${PACKAGE_NAME:-$tag_package}"
patched="${PATCHED_VERSION:-$tag_version}"
affected="${AFFECTED_RANGE:-< $patched}"

if ! [[ "$patched" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
    echo "::error::patched version '$patched' is not a semver version"
    exit 1
fi

prs="${PR_NUMBERS:-}"
if [[ -z "$prs" ]]; then
    notes=$(gh api "repos/$REPO/releases/tags/$RELEASE_TAG" --jq .body)
    prs=$(grep -oE '(#|/pull/)[0-9]+' <<<"$notes" | grep -oE '[0-9]+' | sort -un | tr '\n' ' ' || true)
fi
prs="${prs//,/ }"
[[ -n "${prs// /}" ]] || { echo "::error::no PRs found for $RELEASE_TAG; pass pr_numbers"; exit 1; }

summaries=() cves=() cwes=() sources=()
best_rank=0 best_sev=""
lc() { tr '[:upper:]' '[:lower:]'; }
uc() { tr '[:lower:]' '[:upper:]'; }
rank() { case "$(lc <<<"$1")" in low) echo 1 ;; medium | moderate) echo 2 ;; high) echo 3 ;; critical) echo 4 ;; *) echo 0 ;; esac; }

for pr in $prs; do
    [[ "$pr" =~ ^[0-9]+$ ]] || { echo "::error::bad PR number '$pr'"; exit 1; }
    body=$(gh api "repos/$REPO/pulls/$pr" --jq '.body // ""' | tr -d '\r')
    block=$(awk '/^#{1,6}[[:space:]]+Security[[:space:]]*$/ {on=1; next} on && /^#{1,6}[[:space:]]/ {exit} on' <<<"$body")
    [[ -n "${block//[[:space:]]/}" ]] || continue

    val() { sed -nE "s/^[[:space:]]*(-[[:space:]]*)?$1:[[:space:]]*(.*)$/\2/Ip" <<<"$block" | head -n1; }
    s=$(val Summary)
    [[ -n "$s" ]] || { echo "::warning::PR #$pr has a Security block without a Summary, skipped"; continue; }
    summaries+=("$s (#$pr)")
    sources+=("#$pr")
    while read -r id; do [[ -n "$id" ]] && cves+=("$(uc <<<"$id")"); done < <(val CVE | grep -oiE 'CVE-[0-9]{4}-[0-9]{4,}|GHSA(-[a-z0-9]{4}){3}' || true)
    while read -r id; do [[ -n "$id" ]] && cwes+=("$(uc <<<"$id")"); done < <(val CWE | grep -oiE 'CWE-[0-9]+' || true)
    r=$(rank "$(val Severity)")
    if ((r > best_rank)); then best_rank=$r; best_sev=$(val Severity | lc); fi
done

uniq_lines() { printf '%s\n' "$@" | sort -u | sed '/^$/d'; }

if [[ -z "${SUMMARY:-}" && ${#summaries[@]} -eq 0 ]]; then
    echo "::error::no '## Security' block found in PRs: $prs. Add one to the PRs or pass summary."
    exit 1
fi

summary="${SUMMARY:-${summaries[0]%% (#*}}"
[[ -z "${SUMMARY:-}" && ${#summaries[@]} -gt 1 ]] && summary="Security fixes in $package $patched"
severity=$(lc <<<"${SEVERITY:-$best_sev}")
case "$severity" in low | medium | high | critical) ;; *) echo "::error::severity '$severity' must be low, medium, high or critical (set it in a PR block or the severity input)"; exit 1 ;; esac

if [[ -n "${CWE:-}" ]]; then
    cwe_list=$(grep -oiE 'CWE-[0-9]+' <<<"$CWE" | uc || true)
else
    cwe_list=$(uniq_lines "${cwes[@]:-}")
fi
cwe_json=$(jq -R . <<<"$cwe_list" | jq -sc 'map(select(. != ""))')

if [[ -n "${DESCRIPTION:-}" ]]; then
    description="$DESCRIPTION"
else
    description="Fixed in \`$package\` $patched."$'\n\n'"### What was fixed"$'\n'
    for s in "${summaries[@]}"; do description+="- $s"$'\n'; done
    if ((${#cves[@]})); then
        description+=$'\n'"### Resolved identifiers"$'\n'
        while read -r id; do description+="- $id"$'\n'; done < <(uniq_lines "${cves[@]}")
    fi
    description+=$'\n'"Upgrade to \`$package\` $patched or later."
fi

jq -n \
    --arg summary "$summary" --arg description "$description" --arg severity "$severity" \
    --arg package "$package" --arg affected "$affected" --arg patched "$patched" \
    --argjson cwes "$cwe_json" '{
        summary: $summary, description: $description, severity: $severity, cwe_ids: $cwes,
        vulnerabilities: [{
            package: {ecosystem: "npm", name: $package},
            vulnerable_version_range: $affected, patched_versions: $patched
        }]
    }' >"$OUT"

jq -r '"**\(.summary)**\n\n| field | value |\n|---|---|\n| package | `\(.vulnerabilities[0].package.name)` |\n| affected | `\(.vulnerabilities[0].vulnerable_version_range)` |\n| patched | `\(.vulnerabilities[0].patched_versions)` |\n| severity | \(.severity) |\n| cwe | \(.cwe_ids | join(", ")) |\n\n\(.description)"' "$OUT"
