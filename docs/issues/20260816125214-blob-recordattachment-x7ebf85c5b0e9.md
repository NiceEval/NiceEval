---
format: concord.document/v1
id: 20260816125214-blob-recordattachment-x7ebf85c5b0e9
title: 无 blob RecordAttachment 无法声明零 blob budget
createdAt: 2026-08-16T12:52:14+08:00
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
origin:
  kind: dev
  repository: NiceEval/NiceEval
subject: repository
claim: friction
observation: |
  ---
  title: '无 blob RecordAttachment 无法声明零 blob budget'
  severity: 'minor'
  ---

  ## Expected Behavior

  A fixed RecordAttachment family whose `refs()` is permanently empty and whose writer emits no blobs should be able to declare an exact zero blob budget.

  ## Current Behavior

  `defineRecordAttachment` rejects `maximumBlobs: 0`, `maximumBlobBytes: 0`, and `maximumTotalBytes: 0` at module load with `Record Attachment owners must declare a bounded blob policy`. A genuinely no-blob family therefore has to advertise the artificial positive budget `1/1/1` even though no ref can be minted.

  ## Possible Solution

  Allow the exact all-zero tuple as a bounded no-blob policy while continuing to reject mixed or unbounded invalid tuples. Verify that `refs(payload)` and writer closure membership are empty.

  ## Minimal Reproducible Example

  Declare a fixed family owner with `refs: () => []`, a writer that returns `blobs: []`, and budget `{ maximumBlobs: 0, maximumBlobBytes: 0, maximumTotalBytes: 0 }`. Importing the family throws from `validBlobBudget` before any Record operation runs.

  ## Context

  Found while adding the Attempt-owned `niceeval.source-navigation` family, which intentionally stores only exact IDs/digests/coordinates and no blob closure. The temporary compatible declaration is `1/1/1`.
impact: "`defineRecordAttachment` rejects `maximumBlobs: 0`, `maximumBlobBytes: 0`, and `maximumTotalBytes: 0` at module load with `Record Attachment owners must declare a bounded blob policy`. A genuinely no-blob family therefore has to advertise the artificial positive budget `1/1/1` even though no ref can be minted."
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/20260816125214-无-blob-recordattachment/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:e910fe5f721abc8c1bdd948015202a4d0ff1d269e0722518c8985590007c8f3a
---
---
title: '无 blob RecordAttachment 无法声明零 blob budget'
severity: 'minor'
---

## Expected Behavior

A fixed RecordAttachment family whose `refs()` is permanently empty and whose writer emits no blobs should be able to declare an exact zero blob budget.

## Current Behavior

`defineRecordAttachment` rejects `maximumBlobs: 0`, `maximumBlobBytes: 0`, and `maximumTotalBytes: 0` at module load with `Record Attachment owners must declare a bounded blob policy`. A genuinely no-blob family therefore has to advertise the artificial positive budget `1/1/1` even though no ref can be minted.

## Possible Solution

Allow the exact all-zero tuple as a bounded no-blob policy while continuing to reject mixed or unbounded invalid tuples. Verify that `refs(payload)` and writer closure membership are empty.

## Minimal Reproducible Example

Declare a fixed family owner with `refs: () => []`, a writer that returns `blobs: []`, and budget `{ maximumBlobs: 0, maximumBlobBytes: 0, maximumTotalBytes: 0 }`. Importing the family throws from `validBlobBudget` before any Record operation runs.

## Context

Found while adding the Attempt-owned `niceeval.source-navigation` family, which intentionally stores only exact IDs/digests/coordinates and no blob closure. The temporary compatible declaration is `1/1/1`.
