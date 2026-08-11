# Record 分离 durable facts、local write state 与 cache

日期：2026-08-11

替代：[`editable-record-stable-core-channels.md`](editable-record-stable-core-channels.md)

## 起因

把 `.niceeval` 同时当成可分享事实、writer 工作目录、session、lock 与 cache，会产生三组互相冲突的要求：只读命令不应被写命令锁住，崩溃恢复材料不能随 Git/copy 到另一台机器，已发布数据又必须能在 writer 崩溃时保持完整。旧“停稳后可编辑 Record”还要求 reader、writer、人工修改、clean 与报告共用一把 operation lock，并把 revision/maintenance API 重新带回核心。

另一条问题来自 Results schema 1–18：业务字段、assertion API、source、timing 或 commands 任一变化都递增同一个全局版本，导致整份历史一起失效。删除整数但继续让核心自由扩张，只会隐藏同一个问题。

## 裁决

状态分为三类，并且没有重叠真源：

1. durable Record 默认位于 `<project>/.niceeval/record/`。它只包含完整发布的 immutable Run；Run 连同 owned Attempt、Member、channels 与 blobs 以一次 no-replace directory rename 原子出现。没有局部 edit、delete、clean、revision、proof 或 merge API。
2. local operation state 位于 durable root 的 sibling `.niceeval-local/<recordKey>/`。它保存 writer lock、session、recovery manifest 与 staging；按 canonical physical root 的 SHA-256 key 隔离，并用 durable `recordId` 防止路径重建或复制后的 session 串线。它不进 Git、不复制、不分享。
3. derived cache 也在 local sidecar，但不是 session。cache 可随时删除，读写失败退化为 no-cache；它不能保存权威 absence、latest、candidateSet、coverage、carry 或 recovery 结论。

读取使用 lock-free frozen `RecordReader`。`show`、`view` 与 `exp --dry` 不取得 writer lock；一次 reader 只冻结一次弱 candidateSet 与所选 Member 的精确 Attempt closure。`view` rebuild 时 dispose 整个旧 Scope，再打开新 reader。一个 writer 可以和任意 reader 并发。

写入使用单 writer `RecordWriteSession`。同一 Record 同时最多一个 OS writer lock；session 暴露取得锁时冻结的 reader view，在 local staging 中形成并 seal 完整 Run。seal 前持久化位于被移动目录之外的 recovery manifest；rename、两端 parent fsync 与 destination 重验之后才报告 durable。崩溃后只允许按 source/destination/manifest 的穷尽矩阵 commit-only recovery 或按精确 session ID abandon，不恢复模型、Sandbox 或外部命令。

Record 的 native runtime 边界是 Effect。纯 identity、路径、membership、manifest 比对与状态折叠保持纯函数；文件、lock、并发、取消、stream 与资源生命周期进入 Effect/Scope。Stream 只用于 JSONL 和大 blob，不能泄漏进 frozen candidateSet、`AnalysisSample` 或自包含 `ReportInput`。

格式兼容拆成 core format、channel schema、不可变且自带版本的 FactRequirement identity 与 reuseContract carry fence。`niceeval.record/v1` 只冻结 owner/identity/path/publication；业务事实用稳定 ChannelName 加精确 ChannelSchemaId 局部演进；FactRequirement identity 自带不可变版本，normalized 输出类型升级时发布新 identity 并保留旧 identity。built-in decoder 与 FactRequirement 在 core v1 内永久保留。eligibility 的 mandatory `reuseContract` domain 是前向 carry 栅栏；policy identity 只解释 provenance，不代替 gate。

portable 单位始终是完整 durable root。whole-root copy/Git 只在 quiescent 外部操作中进行；local sidecar 永远排除。Record 可能含源码、conversation、prompt、commands 与 binary blob，纳入 Git 前必须由用户显式承担敏感信息和仓库体积风险；选择性分享使用自包含静态 Report。

## 否决方案

- session、lock 与 cache 一起放进 durable root：会把机器本地 owner 状态误当作可携带事实，并让 checkout/copy 带入假锁与错误恢复现场。
- 所有命令共用 operation lock：让只读 `show/view` 无故阻塞 writer，也无法支持持续 view 与短原子发布并存。
- 发布后继续编辑或删除 Run：需要 maintenance、revision、并发编辑与引用修复协议，破坏 whole-Run immutable closure。
- 用 journal/Graph/Store 事务保存每次修改：为产品不要求的可编辑历史和防伪付出第二套事实模型。
- 继续使用全局整数 schemaVersion：任何业务通道变化仍会使整份历史失效。
- 仅靠 policy identity 防止错误 carry：旧 policy 无法预见新 gate；必须由 eligibility schema 与 `reuseContract` accept set 明确 fail closed。
- 把所有读取都做成 Stream：核心选择必须穷尽、排序并冻结，Reports 也必须在 reader Scope 外保持自包含。

## 后果

- reader 能和 writer 并发，但不是 Invocation 级线性化快照；它可能漏掉刚发布 Run，却不会看到半个 Run。
- crash recovery 需要 file/directory fsync、no-follow、同文件系统 no-replace rename 与 OS lock 等真实平台能力；Effect 负责组合和生命周期，不替代这些 OS 保证。
- 外部直接修改 durable bytes 被当成损坏输入呈现，不自动修复；需要改变事实时发布新 Run。
- 同路径删除重建、whole-root 复制与 stale session 都依赖 `recordId`/canonical path 明确区分 lineage，不能凭目录名猜 owner。
- 纯内部 API 重构不改变持久 identity；bytes shape 变化只在所属 channel 增加 schema/decoder，normalized 类型变化发布新 FactRequirement。完整 core 升版成为少见且可审计的结构事件。

目标契约见 [`docs/feature/record/`](../docs/feature/record/README.md)，旧版本证据见 [`results-schema-version-history.md`](results-schema-version-history.md)。
