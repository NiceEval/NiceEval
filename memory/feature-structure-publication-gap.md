---
format: concord.document/v1
id: feature-structure-publication-gap
title: Feature structure publication lacks a managed first release
createdAt: 2026-08-28
kind: memory
memoryKind: problem
state: open
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---
Creating or changing Feature package structure by hand can leave generated indexes and Trace publication inconsistent.

The initial supported operations need explicit publication semantics and must reject implicit structure creation.
