# PLAN-3：SQLite inventory + 外部 Content packs

每个 published Run 是一个 opaque directory。
SQLite 保存 Core、rich payload、collection item、references 与 Seal inventory；逻辑 Content 保存为同目录内的 Host-owned rolling pack sets/index。

作者 API 与其它候选相同。
业务不能选择哪些 Content 外置，也不能看到 database path、pack range、chunk 或 transaction。

## 解决的问题

本候选保留 SQLite 对大量小 item、index 与 logical transaction 的收益，同时让大 Content 直接进入顺序 file I/O。
finalization 只重建 metadata/item database，不把全部 Content bytes 再复制进 final SQLite file。

## 核心心智

```text
Run directory closure
├── final SQLite logical inventory and item store
├── rolling Content pack sets and indexes
└── whole-Run Seal + complete marker
```

SQLite transaction 只关闭 database 内逻辑状态。
database、pack sets、indexes 与 Seal 的共同原子可见性来自 whole-Run directory rename。

## 范围

本候选包含 Run-local storage actor、generic SQLite schema 与 external rolling Content pack sets。
它也拥有 cross-store closure verification、directory publication 与 storage migration。

它不提供 root-wide DB、family SQL、public item cursor、cross-Run CAS、remote object store 或 public pack configuration。

主要收益是 RS2 的 direct Content streaming 与 SQLite collection index可以同时存在。
主要代价是 NiceEval 必须维护 database 和 pack 两套 corruption、migration 与 commit protocol。

## 入口

- [Library](library.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
- [Use Cases](use-case/README.md)
