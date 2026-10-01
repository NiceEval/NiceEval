# PLAN-2：一 Run 一 SQLite application file

本页保留历史候选，不再参与当前 live 比较。
一个 final SQLite file 同时是一个 durable member；共同 member ceiling 会形成 Run byte cap，取消该 ceiling 又会形成无界 hostile 单文件。
因此本候选不能兑现当前“Core 不为 Run Content 设置固定 byte cap”的共同目标。

portable root 保留小 `record.json`；每个 published Run 是独立、只读的 SQLite application file。
active Run 使用 local staging database，seal 时由 fixed exporter 形成新的 final file，再以 no-replace rename 发布。

作者仍只提交 rich logical value、plain-data collection item 与逻辑 Content。
family 不能提供 SQL、table、column、index、expression 或 transaction。

## 原本解决的问题

本候选用 generic relational substrate 处理大量小 item、ordinal index、logical inventory、references、Content chunks 与 Seal。
不同 Run 使用不同 database，因此不会竞争 root-wide writer。

## 核心心智

```text
business API
  → logical write/start/append/Content
  → one Run storage actor
  → generic staging rows and chunks
  → fixed export to one final SQLite file
  → immutable read-only Run
```

SQLite row、page、B-tree、WAL 与 chunk boundary 都是 Host storage facts。
logical family payload/item 仍是 canonical opaque bytes。

## 范围

本候选包含 Run-local storage actor、generic STRICT schema、bounded Content chunk rows 与 fixed final exporter。
它也包含 single-file publication、hostile database hardening 与 storage migration。

它不提供 root-wide database、family SQL、public query language、item-level public cursor、cross-Run CAS 或 writable published DB。

主要收益是 row/index/transaction 与单文件 packing。
主要代价是同步 worker、hostile SQLite surface、O(run bytes) final export、接近两份 Run 的临时空间和二进制 Git diff。

如果产品以后重新接受 Run 级单文件容量边界，可以在新的 Design 中重开本候选。
不能通过豁免 RS2、RS17 或 durable-member ceiling 让它回到本轮选择。

## 入口

- [Library](library.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
- [Use Cases](use-case/README.md)
