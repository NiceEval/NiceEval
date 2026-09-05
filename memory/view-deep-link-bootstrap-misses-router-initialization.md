---
format: niceeval.memory/v1
id: view-deep-link-bootstrap-misses-router-initialization
title: View deep-link bootstrap can miss the initial router state
createdAt: 2026-09-05
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_ABHQ7PPW920CV3BJ -> netake_0SVB9XS4NCGH4WFE; current installed authorization Journey, three isolated + two same-copy + default parallel + single-case observations, all pass and cleanup verified by parent.
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/insight/test/view-authorization.browser.spec.ts#necase_XDDZFNTFXA177RG0"]}
promotions: []
---
An installed View hard reload can remain blank even after all generation, Inspection, and lazy route requests have completed. createViewRouter registers a location observer before RouterProvider subscribes. React Router buffers initialization updates only when no subscriber exists, so an update between the Provider render snapshot and layout-effect subscription can be delivered only to that observer. The Provider retains initialized=false and renderFallback=true.

The failure was isolated on candidate 8888cdca3eac98cb40b59b28af959d7a0161e938cd2b38cc2a9426ebb9953314 after fixing the duplicate overlay and withdrawing the initialization barrier. Retained public browser diagnostic 05a1bd39-c714-4abc-8e94-152bf053a1c5 captured live router initialized=true, renderFallback=false, loaded route data, and no pending queries, while RouterProvider still held initialized=false, renderFallback=true, and empty loaderData. The DOM had no main or dialog. Candidate and Testkit identities remained verified; the process group was gone after diagnosis.

The earlier not-a-bug resolution compared router state on a different candidate that already contained the initialization barrier. That candidate instead exposed the separate [duplicate Attempt overlay](view-hard-refresh-duplicates-attempt-overlay.md). Its failure did not disprove the initialization race. This record was reopened after separating the two candidate conditions; managed history is preserved.

Bootstrap must complete router initialization before exposing it to RouterProvider and clean up its temporary subscription. The installed authorization browser journey now passes with both fixes present; a loading fallback cannot repair the missed update.

Final acceptance: candidate be39d8a68af55510a974013fd5e61950f85bf23a0ceb34d516681434fb9ea5d1; inventory neinv_QP84SXZDB9HV95JN; red nered_ABHQ7PPW920CV3BJ; complete takeover netake_0SVB9XS4NCGH4WFE. All seven observations match the current test source, pass, and report process cleanup. The full Insight seven-case suite also passes with default browser concurrency.
<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `5a1bc84e8944350574f07553b21ff61cbbd70f0a`

```json
{
  "kind": "not-a-bug",
  "proof": [
    "The router-initialization hypothesis was disproved by candidate 3a031d browser diagnostics: both router states were initialized, renderFallback false, and all 27 detail queries completed. Two complete Radix dialogs were mutually aria-hidden after restoring history background. See view-hard-refresh-duplicates-attempt-overlay; remove the ineffective router barrier."
  ]
}
```
