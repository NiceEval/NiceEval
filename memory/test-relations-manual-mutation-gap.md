---
format: concord.document/v1
id: test-relations-manual-mutation-gap
title: Test relations lack a managed mutation boundary
createdAt: 2026-08-28
kind: memory
memoryKind: problem
state: open
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---
Hand editing owner, regression, or Issue metadata can create invalid Trace relations and bypass safety gates.

Test relation changes need a dedicated managed command with validation and receipts.
