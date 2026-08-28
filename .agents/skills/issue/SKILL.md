---
name: issue
description: Prepare, deduplicate, create, triage, update, close, or safely retry NiceEval GitHub Issues from public sanitized observations. Use for NiceEval Issue work; remote mutations require explicit authorization for the current action.
---

# Issue

Read the [Issue and Memory workflow](../../../docs/engineering/issues/README.md) before handling Issue state or performing a remote mutation.

An Issue is only for a public, sanitized Observation that still needs NiceEval maintainer follow-up.
Send suspected vulnerabilities to Private Vulnerability Reporting, and stop if safe publication is uncertain.
Do not create a Feedback for a new Observation; Feedback is retained only for legacy migration and audit.
Use Memory for investigated Problems, Decisions, and reusable know-how; do not use an Issue as a root-cause record.

For an E2E case relation, run `pnpm run repo docs test issue add --help`. This is a local sidecar mutation, not remote Issue mutation. It must read-only verify the current repository's canonical URL, existence, non-PR identity, and direct provenance to the exact `<path>#<caseId>`, then CAS the verified remote identity before local publication. Repeat it for every Issue related to that case; repeat it separately for other cases in the same file. It never grants or consumes authorization to mutate GitHub. Remove a current relation only through `pnpm run repo docs test issue retire --help`.

## Prepare

Preserve the source's actual Observation, expected behavior, impact, public entry-point reproduction, NiceEval identity, environment, and provenance.
For a Feature, preserve the expected workflow, current gap, impact, usage example, and provenance.
Do not invent a root cause or require a proposed solution.

Search both open and closed Issues for a semantic duplicate.
Return a draft and suggested type, area, and status labels when remote mutation is not explicitly authorized.

## Remote mutation gate

Creating, editing, commenting on, labeling, closing, or reopening an Issue requires the user's explicit authorization for this repository and the current action.
A prior authorization, a local change request, or permission to prepare a draft is insufficient.

Use the named Issue CLI's plan-then-execute flow. A plan performs the complete read-only evidence collection; execute accepts that short-lived, single-use receipt only after the specific authorization is present, compares its current state with the plan by CAS, and then performs one intended remote mutation. Authorization is never embedded in, or inferred from, a receipt.
Read-only enumeration is allowed when needed to deduplicate or establish remote state.

## Machine-originated submissions

Use the exact `niceeval.issue-origin/v1` marker and canonicalization defined by the workflow.
Before creation, paginate through every open and closed Issue, read each body, filter Pull Requests, and compare exact `origin-key` values.
Do not use the GitHub search index as an existence check.

- Same key and digest: return the existing URL without mutation.
- Same key and different digest, multiple matches, or ambiguous semantic duplicate: stop and ask.
- No match after a complete scan: create once only while the current authorization remains valid.

If the create result is uncertain, scan all open and closed Issues again before any retry. An uncertain create always requires a fresh complete enumeration; no cached plan, search result, or partial page can prove absence.
Retry at most once under the same explicit authorization; stop with an unknown result if enumeration is incomplete or the retry is uncertain.

## Triage and close

New Issues start at `needs-triage`.
Triage performs semantic deduplication, public-entry reproduction, type classification, and area classification before choosing `needs-info`, `accepted`, or `blocked`.
Use `blocked` only while NiceEval retains responsibility.

Do not close as completed because a PR exists.
Apply the closure evidence table in the design, including the resolved Problem Memory and E2E takeover gate when they apply.
Keep Issue collaboration state and Memory engineering fact state independent; record only the Issue-to-Memory forward link.
