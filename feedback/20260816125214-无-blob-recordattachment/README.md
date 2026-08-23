---
{
  "format": "niceeval.feedback/v1",
  "id": "20260816125214-无-blob-recordattachment",
  "title": "无 blob RecordAttachment 无法声明零 blob budget",
  "state": "open",
  "reportedAt": "2026-08-16T12:52:14+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "repository",
  "claim": "friction",
  "observation": "---\ntitle: '无 blob RecordAttachment 无法声明零 blob budget'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\nA fixed RecordAttachment family whose `refs()` is permanently empty and whose writer emits no blobs should be able to declare an exact zero blob budget.\n\n## Current Behavior\n\n`defineRecordAttachment` rejects `maximumBlobs: 0`, `maximumBlobBytes: 0`, and `maximumTotalBytes: 0` at module load with `Record Attachment owners must declare a bounded blob policy`. A genuinely no-blob family therefore has to advertise the artificial positive budget `1/1/1` even though no ref can be minted.\n\n## Possible Solution\n\nAllow the exact all-zero tuple as a bounded no-blob policy while continuing to reject mixed or unbounded invalid tuples. Verify that `refs(payload)` and writer closure membership are empty.\n\n## Minimal Reproducible Example\n\nDeclare a fixed family owner with `refs: () => []`, a writer that returns `blobs: []`, and budget `{ maximumBlobs: 0, maximumBlobBytes: 0, maximumTotalBytes: 0 }`. Importing the family throws from `validBlobBudget` before any Record operation runs.\n\n## Context\n\nFound while adding the Attempt-owned `niceeval.source-navigation` family, which intentionally stores only exact IDs/digests/coordinates and no blob closure. The temporary compatible declaration is `1/1/1`.\n",
  "impact": "`defineRecordAttachment` rejects `maximumBlobs: 0`, `maximumBlobBytes: 0`, and `maximumTotalBytes: 0` at module load with `Record Attachment owners must declare a bounded blob policy`. A genuinely no-blob family therefore has to advertise the artificial positive budget `1/1/1` even though no ref can be minted.",
  "memoryRelations": []
}
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
