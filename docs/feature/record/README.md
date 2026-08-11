# Record：持久事实与本地运行状态

Record 是 `<project>/.niceeval/record/` 中可携带、可复核的持久事实集。它只含完整发布的 Run；session、writer lock、恢复材料和派生 cache 位于 sibling `.niceeval-local/`，不属于 Record，也不进入 Git 或分享边界。

一次 Run 同时封存 expected membership、executed Attempt、carried/accepted 引用与业务通道。Run 通过单次目录 rename 原子出现，发布后 immutable。Record 不提供局部 edit、delete、revision、proof 或 merge API；需要分享一个可继续读取的 Record 时复制整个 root，需要选择性分享时导出静态 Report。

Record 不判断事实是否“当前”、可复用或需要再次执行。analysis projector 从 reader 的 frozen candidate set 形成 [AnalysisSample](../sample/README.md)；execution projector 把当前 target、eligibility 与 policy 投影成 `reuse | gap`。这两种投影都不写回旧 Run。

## 两种访问能力

```text
niceeval show / niceeval view / niceeval exp --dry
    └─ lock-free RecordReader
       ├─ 一次冻结 candidateSet
       ├─ 沿已选引用冻结 dependencyClosure
       └─ 可 best-effort 写 local cache，但绝不写 Record

niceeval exp
    └─ 单 writer RecordWriteSession
       ├─ 取得 OS writer lock
       ├─ 暴露同一时点的 frozen reader view
       ├─ 在 local session 形成并 seal 完整 Run
       └─ no-replace atomic rename 发布到 Record
```

reader 与 writer 可以并发；同一 Record 同时最多一个 writer。reader 不是线性化快照，可能漏掉并发刚发布的 Run，但每个已经看见的 Run 都必须完整。`view` 每次 rebuild 都 dispose 旧 reader 后打开新 frozen view。

## 为什么不再出现 schema 1→18 的全局连锁

`niceeval.record/v1` 是一条全新的格式线，不是旧 Results `schemaVersion` 1–18 的下一版。legacy bytes 不进入 Record reader；reader 不打开、不猜测，普通 `open` 也不自动迁移。兼容承诺只从首个正式 `niceeval.record/v1` writer 开始，面向它之后的 NiceEval 迭代。

core 使用完整格式身份 `niceeval.record/v1`，只冻结 identity、membership、origin、descriptor 与发布规则。业务事实使用 `ChannelName` 表达稳定语义，再用独立 `ChannelSchemaId` 表达精确 bytes shape，例如 `niceeval.assertions/v1`。

某个业务 API 或 payload 改变时，只新增该 channel 的 schema 与 decoder；未知 schema 只让相应 fact `unsupported`，不会让整个 Record 失效。正式 built-in schema 的 decoder 与 normalized FactRequirement 在 core v1 生命周期内永久保留。只有 core owner、identity、路径或原子发布边界改变时才需要 `niceeval.record/v2`；发布 v2 不授权删除 v1 reader，也不把 v2 对象混写进 v1 root。

每个正式 `FactRequirement<A>` identity 不可变且自带版本；normalized 输出类型升级时发布新 identity，并永久保留旧 identity 与输出类型。调用方按 identity 得到对应代的 normalized 值；新 requirement 只把能完整形成其输出的历史 schema 放入 accepted set。

carry 另有前向栅栏：每个 eligibility 都带 mandatory `reuseContract` equality token。新增或改变 gate 必须切换其 domain；旧 projector 遇到新 schema 或 domain 时得到 gap，不能因为不认识新 gate 而错误 carried。policy identity 只解释当时 action，不代替这道栅栏。

旧 Results Format 逐版为何变化、7/10 为什么不是正式版本，以及 main 15 与未合并分支 16–18 的边界，统一见 [schemaVersion 历史存档](../../../memory/results-schema-version-history.md)。该存档只解释为什么另起格式线，不构成旧格式读取承诺。

## 文档入口

- [Architecture](architecture.md) —— durable/local/cache 边界、core 形状、发布恢复、schema registry 与 portable 规则。
- [Library](library.md) —— Effect 资源、reader、write session、恢复 API 与 typed errors。
- [CLI](cli.md) —— show/view/exp 的只读或写入行为、recovery 命令与 Git 边界。
- [产生运行事实](use-case/produce-runtime-facts.md) —— writer 从 preflight 到发布的完整顺序。
- [上层 API 改动不影响旧 Record](use-case/上层-API-改动不影响旧-Record.md) —— schema decoder 怎样隔离 API 重构。
- [未来功能不扩张核心格式](use-case/未来功能不扩张核心格式.md) —— 新事实的放置与 carry fence 决策。
