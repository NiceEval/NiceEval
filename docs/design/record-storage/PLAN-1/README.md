# PLAN-1：JSON envelope + Host 私有 packs

Record root 继续以 opaque Run directory 为 published unit。
Core 与 Attachment envelope 使用 canonical JSON；大量 collection item 与 Content bytes 进入 Host-owned framed pack。

作者仍只提交 rich logical value、plain-data collection item 与逻辑 Content。
作者不能选择 inline、frame、segment、offset、digest path 或 pack file。

## 解决的问题

本候选在不引入 embedded database 的前提下，让 collection append 和 Content Stream 直接进入有界 staging I/O。
Attempt 进程无需保留完整 item 数组，Content writer 也无需形成完整 `Uint8Array`。

## 核心心智

```text
RecordAttachment logical value
├── rich payload or collection state
├── ordered plain-data items
├── logical Content handles
└── references
          │
          ▼ Host private storage
JSON envelope + item pack/index + content pack/index
```

envelope 是 logical closure 的入口；pack 和 index 是 storage facts。
改变 frame/segment 大小、inline threshold 或 pack grouping 不改变 family revision。

## 范围

本候选包含 custom framed item/content pack、per-Attachment closure verification、whole-Run directory publication 与 storage migration。
它不提供 SQL、public item cursor、跨 Run CAS、remote object store 或可配置 pack policy。

主要收益是沿用现有 directory trust/publication boundary，并允许 Content 直接流向文件。
主要代价是 NiceEval 自己拥有 framing、index、transaction、orphan、corruption 与 migration protocol。

## 入口

- [Library](library.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
- [Use Cases](use-case/README.md)
