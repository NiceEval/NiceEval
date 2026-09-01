---
format: niceeval.memory/v1
id: attachment-encode-error-hides-family-and-schema-path
title: Attachment encode failure hides its family and Schema path
createdAt: 2026-09-01
kind:
  type: problem
  state: open
promotions: []
---
## Observation

MemoryBench reported `Attempt publication failed` with `record-attachment-encode-error` through the installed NiceEval CLI. The public error did not identify the Attachment family or the failing Schema path, so the responsible constructor cannot be isolated without reading private Record storage or rerunning the paid matrix.

## Engineering finding

The Record schema codec already retains Effect Schema formatter issues, but `encodeRecordAttachmentCurrent` collapsed them to `exact-encode-failed`, and the writer collapsed that again to one generic `value` issue. The writer also omitted the known Attachment family.

## Current disposition

Keep this Problem open until a subsequent public reproduction names the real family and a deterministic public-entry E2E fixes that family's constructor. The diagnostic boundary must preserve the family plus Schema message/path. Do not infer that the constructor root cause is fixed merely because diagnostics improve.
