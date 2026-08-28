---
format: niceeval.memory/v1
id: memory-author-update-gap
title: Memory author updates lack a managed boundary
createdAt: 2026-08-28
kind:
  type: problem
  state: open
promotions: []
---
Changing a structured Memory author region without a dedicated CLI boundary risks rewriting history, legacy entries, or published authors.

The managed update must limit its scope to the current author region before the resolution-history marker.
