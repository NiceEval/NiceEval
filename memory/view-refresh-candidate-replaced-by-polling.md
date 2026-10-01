---
format: concord.document/v1
id: view-refresh-candidate-replaced-by-polling
title: View polling replaces the snapshot being prepared for refresh
createdAt: 2026-09-08
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: |-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - Installed browser red nered_HJ67P7C0AH52MVQA; candidate ceffa89a270aec0dd8bd655bc5a3b92c0afa5c008562f9b1ee870e11c47bf4f9 passed complete takeover netake_BJJTAA44R0CE4XMX, including default Insight 7 cases and all process cleanup.
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/insight/test/view-operational-refresh.browser.spec.ts#necase_77F5PRE3YTPSA078"]}
    proof:
      - Installed browser red nered_HJ67P7C0AH52MVQA; candidate ceffa89a270aec0dd8bd655bc5a3b92c0afa5c008562f9b1ee870e11c47bf4f9 passed complete takeover netake_BJJTAA44R0CE4XMX, including default Insight 7 cases and all process cleanup.
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/insight/test/view-operational-refresh.browser.spec.ts#necase_77F5PRE3YTPSA078"]}
    source:
      path: memory/view-refresh-candidate-replaced-by-polling.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:c47825f915d89f5736d66660d8fd218c2e905898002b3402b9d3e519e462f1d4
---
Operational View eagerly imported a candidate whenever the Record publication clock changed. Run creation and closure now correctly participate in that clock, so polling could prepare an intermediate snapshot before new Attempts appeared, or retire a candidate while the browser was preparing it. PR 229 browser CI showed a successful refresh retaining the old Attempt; the installed public browser red also reproduced a rejected commit.

The existing Insight contract gives polling only an update hint and fixes a fresh snapshot when the user requests Refresh. The correction reads the latest cutoff on GET, imports on explicit refresh POST, and coalesces concurrent imports. Background reads cannot replace a prepared candidate. Existing Host leases and the CLI scope retain resource ownership; shutdown waits for any pending import and retires its result.

The unchanged operational refresh Journey verifies atomic publication, history navigation, preparation cancellation, unchanged refresh, uncertain commit recovery, and process cleanup. Formal red: nered_7RZWQMZY2SC563PS on the PR 229 installed candidate.
