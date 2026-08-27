---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# PLAN-3：SQLite inventory + 外部 Content packs

本候选是条件后备，不与 PLAN-1 对等领先。
只有 PLAN-1 framing 或 RS3 失败，且 item-level lazy reader成为明确产品目标时，才重新比较这套双 storage protocol。

每个 published Run 是一个 opaque directory。
SQLite 保存 Core、rich payload、collection item 与 references；逻辑 Content、range index 和 Run Seal inventory使用同目录内的 Host-owned rolling packs 与小 roots。

作者 API 与其它候选相同。
业务不能选择哪些 Content 外置，也不能看到 database path、pack range、chunk 或 transaction。

## 解决的问题

本候选保留 SQLite 对大量小 item、index 与 logical transaction 的收益，同时让大 Content 直接进入顺序 file I/O。
finalization 只重建 metadata/item database，不把全部 Content bytes 再复制进 final SQLite file。

## 核心心智

```text
Run directory closure
├── final SQLite logical inventory and item store
├── rolling Content data/index/catalog packs
└── rolling Seal inventory + small root + complete marker
```

SQLite transaction 只关闭 database 内逻辑状态。
database、pack sets、indexes 与 Seal 的共同原子可见性来自 whole-Run directory rename。

## 范围

本候选包含 Run-local storage actor、generic SQLite schema 与 external rolling Content pack sets。
它也拥有 cross-store closure verification、directory publication 与 storage migration。

它不提供 root-wide DB、family SQL、public item cursor、cross-Run CAS、remote object store 或 public pack configuration。

主要收益是 direct Content streaming 与 SQLite collection index可以同时存在。
主要代价是 NiceEval 必须维护 database 和 pack 两套 corruption、migration 与 commit protocol。

## 入口

- [Library](library.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
- [Use Cases](use-case/README.md)
