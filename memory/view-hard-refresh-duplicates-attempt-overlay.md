---
format: niceeval.memory/v1
id: view-hard-refresh-duplicates-attempt-overlay
title: Hard refresh renders the same Attempt as its background and dialog
createdAt: 2026-09-05
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - Installed authorization and snapshot reds nered_1GH2D3JYA68VAKD2 / nered_WFZ2XWRF2BECH78C; complete takeovers netake_0SVB9XS4NCGH4WFE / netake_YQZGSWP388S90J9B on be39d8a6 candidate, 14 current-source observations all pass and cleanup, independently accepted.
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/insight/test/view-authorization.browser.spec.ts#necase_XDDZFNTFXA177RG0","e2e/insight/test/view-snapshot.browser.spec.ts#necase_DCFSBPFARWB0QD6D"]}
promotions: []
---
An authenticated reader opens an Attempt from Results and hard-refreshes its URL. The browser can preserve history.state.usr.background while React refs restart. InsightShell initializes stablePage from the current outlet, which is already AttemptRoute, then renders both stablePage.current and outlet. Two Radix dialogs can hide each other instead of presenting one Attempt above a Results page.

Independent Astra review identified the background ownership mismatch. Installed candidate 3a031d diagnostics showed initialized router and Provider states, completed queries, and two complete dialogs with mutual aria-hidden. That candidate already contained an initialization barrier; its separate overlay failure did not disprove the [router initialization race](view-deep-link-bootstrap-misses-router-initialization.md). The latter was independently isolated on candidate 8888cdca after withdrawing that barrier.

The same opaque-outlet cache also changes a background Run into another dialog because RunRoute reads the active global location. The existing View snapshot Journey was strengthened with a fresh browser page opened directly at an existing Run, then a click to its Attempt. Formal red nered_WFZ2XWRF2BECH78C against candidate 3a031d reached this new step and observed two raw dialog elements instead of one, with complete process cleanup.

The fix binds each displayed background and foreground to its own target and presentation. Real soft navigation preserves the background component instance. Hard reload reconstructs its recorded background; a new Attempt URL reconstructs the manifest default Results and closes by replacement rather than an invented Back entry. Bootstrap and refresh must prepare the same visible surfaces under one generation and QueryClient. Both authorization and snapshot Journeys pass without weakening expansion, navigation, reload, or shared-link assertions.

Final candidate be39d8a68af55510a974013fd5e61950f85bf23a0ceb34d516681434fb9ea5d1 passed the complete seven-case Insight Repo at default concurrency. Authorization red nered_1GH2D3JYA68VAKD2 and Snapshot red nered_WFZ2XWRF2BECH78C are bound to inventory neinv_QP84SXZDB9HV95JN; their complete takeovers are netake_0SVB9XS4NCGH4WFE and netake_YQZGSWP388S90J9B. The parent independently verified all fourteen observations against their current sources and candidate bytes, including each default-parallel run and process cleanup.
