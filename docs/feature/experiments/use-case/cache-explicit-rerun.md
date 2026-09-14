---
format: concord.document/v1
id: cache-explicit-rerun
title: 指纹未变时主动重新运行
createdAt: 2026-07-27T18:06:13+08:00
kind: use-case
feature: docs/feature/experiments/README.md
---

# 指纹未变时主动重新运行

只想复验旧失败时使用：

```sh
niceeval exp compare/bub-e2b --rerun
```

怀疑所有历史结果都不再可信时，先收窄选择，再使用：

```sh
niceeval exp compare/bub-e2b memory/ --rerun all
```

两种模式的完整反馈和边界分别见[复验失败项](rerun-failures.md)与 [全量重验](rerun-all.md)。
