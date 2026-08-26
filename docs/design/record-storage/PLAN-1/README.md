# PLAN-1：JSON envelope + Host 私有 packs

Record root 继续以 opaque Run directory 为 published unit。
Core 与 Attachment envelope 使用 canonical JSON；大量 collection item 与 Content bytes 进入 Host-owned rolling framed pack sets。

作者仍只提交 rich logical value、plain-data collection item 与逻辑 Content。
作者不能选择 inline、frame、segment、offset、digest path、rollover threshold 或 pack file。

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
JSON envelope + data packs + rolling index/catalog/Seal + small roots
```

envelope 与小 root 是 logical closure 的入口；pack、index、catalog 与 Seal page 都是 storage facts。
任一 pack 达到 Host 私有阈值后自动 rollover；逻辑 item、Content 或 Seal 不因此变成另一个 Attachment。
改变 frame/segment 大小、rollover threshold、inline threshold 或 pack grouping 不改变 family revision。

## 为什么这样分层

Record API、storage codec 与 rolling pack 分别回答不同问题：

```text
Record API / Effect Schema
  → 定义 owner、family、业务字段与 logical Content
  → storage codec 把逻辑事实编码成 envelope、frame、index、catalog 与 Seal page
  → rolling packs 有界地保存 data 与 metadata，并在达到私有阈值时自动 rollover
```

family 作者只定义“保存什么”。
storage codec 定义 Host 怎样认证这些逻辑事实，rolling pack 则负责怎样把持续增长的 bytes 保存成自包含 Run。
改变 pack 数量、page grouping 或 rollover threshold 不改变业务字段、Content handle 或 family revision。

这个边界兑现以下产品能力：

- 一个 logical Content 可以跨多个 data packs，producer 仍只提交一个 handle；
- writer 与 `content.stream(handle)` 按当前 buffer、page 和 segment 增量处理，不先形成完整 Content value；
- 多个小 Content 与 collection item 可以共享 packs，不为每个值创建一个 filesystem member；
- index、catalog 与 Seal inventory 和 data 一起 rollover，不用单个巨大 metadata 文件重新形成容量墙；
- ordinary read 只下钻请求的 Attachment 与 Content，`requireComplete()` 才流式验证整个 Run；
- whole-Run directory rename 保持 publication fail closed，crash 不暴露半份 Run；
- unknown family 可以按 generic roots、pages 与 raw bytes 搬运，不要求 Host 理解业务 Schema；
- 每个 Attempt 的 Attachment closure 独立拥有 packs，不跨 owner 建立生命周期依赖。

## 与 Protocol Buffers 的边界

`Protocol Buffers` 是 message encoding；rolling pack 是 storage container 与 publication protocol。
二者不是替代关系。

| 能力 | rolling pack | Protocol Buffers |
|---|---|---|
| 描述 metadata 字段和类型 | 交给 storage codec | 可以提供 `.proto` 与生成代码 |
| Content 有界流式写入 | segment 直接进入当前 data pack | 单个 `bytes` field 通常仍需整体读入内存 |
| 文件达到阈值后自动 rollover | Host 私有完成 | 不提供 |
| 定位一个 handle 的 ordered ranges | authenticated catalog 与 range index | 不提供跨文件位置和生命周期 |
| rolling index、catalog 与 Seal | pack、page 与小 root 共同完成 | 只编码单个 page，不管理 page tree |
| missing、extra、truncated member 校验 | exact Seal inventory 与 directory 验证 | 不验证 filesystem closure |
| crash、fsync 与原子 publication | staging、root-last 与 directory rename | 不提供 |
| unknown family storage migration | generic inventory 流式复制原 bytes | unknown field 不能代替 family/closure migration |

本候选可以让 `Protocol Buffers` 编码有界的 frame header、index page 或 Seal page。
即便采用它，raw Content、pack rollover、authenticated roots、完整 inventory 与 publication 仍由 Record Host 负责。

把整个 Content 放进一个 Protobuf `bytes` field，或把整个 Run 放进一个 `.pb` 文件，不能提供本设计要求的增量 Content 路径。
把多个 length-delimited message 持续写入并自动换文件，本身就需要 rolling pack protocol。

因此需要单独比较的是 page codec，而不是 `Protocol Buffers` 与 rolling pack：

- 固定二进制 page codec 提供更窄的合法编码面、直接的 offset/length 校验与较少对象分配；
- Protobuf page codec 提供 IDL、生成代码与跨语言 reader，但必须额外裁决 unknown field、重复字段、canonical encoding 与 `uint64` 的 JavaScript 表示；
- 无论选择哪种 page codec，都不能把 pack、segment、path、threshold 或 message schema 暴露给 family 作者。

page codec 的最终选择必须由 hostile-input、deterministic validity、50,000-item 功能路径与跨语言需求的共同 spike 决定。
它属于 storage revision，不改变本候选提供给业务的逻辑能力。

## 范围

本候选包含 custom framed data/metadata pack sets、authenticated roots、per-Attachment closure verification、whole-Run directory publication 与 storage migration。
它不提供 SQL、public item cursor、跨 Run CAS、remote object store 或可配置 pack policy。

主要收益是沿用现有 directory trust/publication boundary，并允许 Content 直接流向文件。
主要代价是 NiceEval 自己拥有 framing、authenticated catalog、range index、Seal、orphan、corruption 与 migration protocol。

## 入口

- [Library](library.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
- [Use Cases](use-case/README.md)
