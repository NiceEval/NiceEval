---
format: niceeval.memory/v1
id: view-refresh-commit-races-with-navigation
title: View refresh can publish a candidate after navigation changes during commit
createdAt: 2026-09-05
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - Installed View browser red nered_SF50AX0SXYPK151S; candidate be39d8a68af55510a974013fd5e61950f85bf23a0ceb34d516681434fb9ea5d1 full Insight7 and complete takeover netake_GNGEXFKZ0FQ46Y0H, all seven observations with process cleanup, current source verified by parent.
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/insight/test/view-operational-refresh.browser.spec.ts#necase_77F5PRE3YTPSA078"]}
promotions: []
---
A reader confirms Refresh on one Experiment while retaining another Experiment in browser history. The browser prepares only the current surface, checks its location epoch, and then awaits the Host commit response. A Back/Forward or selector navigation during that await can publish a different location before the prepared candidate reaches the UI.

The Host switches its current generation and retires the former reader before returning the commit response. Rejecting the candidate merely because the location changed after that response would leave the browser using the retired identity. The fix must coordinate the short final commit/publish interval locally, preserving navigation during preparation, retaining the last requested Router navigation, and publishing the new generation before replaying it. The transport and Host resource ownership remain unchanged.

The operational-refresh browser owner uses a real HTTP boundary gate: forward the commit to the installed Host, retain its actual successful response, trigger browser Back, and verify that the selected Experiment remains stable until the response is delivered. Afterwards the queued destination must show the new published Attempt and Forward must preserve history. A separate preparation gate within the same refresh Journey checks that preparation still permits navigation and discards the candidate.

Independent GPT-6 Astra review requires a publicly installed Router blocker before the final epoch and in-flight-navigation check, suspension of old-generation detail interactions including portals, recovery by existing current-generation readback after an uncertain response, and a reload recovery state if the committed generation cannot be established. The frozen Journey passed the installed candidate and complete takeover below.

A later default-parallel browser diagnostic on candidate 25b29f8e2dc74a3cef482ce85f291081d84281569c9ccacf944ac717cbd752e8 separated navigation from rendering: the Router had committed the last queued destination with idle navigation and an unblocked blocker, while the committed React LocationContext and selector retained the previous destination for five seconds. Moving control unlock alone did not establish a causal fix.

Independent inspection of the installed TanStack Query observer established a separate lifetime error: changing QueryClientProvider.client preserves existing observers, which remain bound to the client from their initial mount. Candidate prefetch and surviving observers could therefore use different caches. The adopted correction gives ViewRuntime one stable QueryClient, isolates queries by generation identity, rejects duplicate live repository owners, and removes only inactive queries when a generation retires. Active old queries expire through the existing finite GC period. Stale prepared handles cannot close a current or successor owner. Page teardown aborts its lifetime, unmounts React consumers, then disposes Router and Runtime. This corrects the verified cache ownership error; the full browser and takeover results, rather than that hypothesis alone, determine whether the observed rendering failure is fixed.

The final refresh Journey also verifies an unchanged-generation refresh preserves expanded results, and loses the actual successful Host commit response plus the recovery GET at the HTTP boundary. It observes Reload with old result controls removed, restores transport, and waits for a real document load before checking the newest Attempt. Fault handlers record completion and are joined during cleanup.

Final acceptance uses candidate be39d8a68af55510a974013fd5e61950f85bf23a0ceb34d516681434fb9ea5d1 and inventory neinv_4X8193F3BCWX211H. Old-candidate red nered_SF50AX0SXYPK151S fails because the Experiment selector remains enabled while the successful Host commit response is held. Takeover netake_GNGEXFKZ0FQ46Y0H contains three isolated runs, two same-copy observations, the default parallel Repo run, and the exact single-case green; all seven match the final test source and candidate, and all process groups are gone. The complete seven-case Insight run also passed, including all three browser owners at default concurrency.
