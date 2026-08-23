# Decision

## 裁决

Observability 的 durable layout 按 Source receipt 的 capture authority 切分。current writer 只写以下五个
source family：

- `niceeval.agent-turns`；
- `niceeval.turn-contexts`；
- `niceeval.sandbox-commands`；
- `niceeval.runner-activities`；
- `niceeval.runner-diagnostics`。

conversation、usage、commands、timing 与 diagnostics 是 reader-side view。source navigation 是 Turn Contexts、
Runner Activities 与 Sources 的 Fact relation。两者都不构成 durable family。Adapter 品牌、provider 与 Report
栏位也不能扩张 catalog。

第三方只提交 NiceEval 的固定 capture input，不获得 family、schema、migration、staging 或直接写盘权。

## 为什么选择 source receipt layout

- Adapter terminal Turn、SessionManager turn context、Sandbox command、Runner activity 与 Runner diagnostic
  分别形成 Source receipt。一个 source 的 `partial`、`not-recorded` 或 `invalid` 不使其它 source 不可读。
- Adapter 保存已经解释、脱敏的 provider-neutral Turn receipt，不保存 tape、JSONL、SDK frame 或 raw OTLP。
- 每个 receipt 在 capture 边界 canonicalize 并进入 private staging。Run seal 验证 Core、payload、segment 与
  blob closure，不构造 aggregate Observability payload。
- `complete` 与 Seal manifest 在 sealed staging 中一起形成，再由同一次 no-replace directory rename 发布。
  manifest 穷尽 Core、source family、owner、schemaVersion、segment、payload 与 blob inventory。
- local recovery manifest 绑定 staging / destination 与完整 portable inventory。恢复只能重试同一原子发布或
  验证已经发布的 destination，不能重跑 capture 或拼装部分事实。

## 为什么否决逻辑 family 与单 envelope

- PLAN-1 的 logical family 使 producer 在 seal 前拆散同一 capture input，再让 reader 通过 field projector 重新拼装。
- PLAN-2 的 source-tagged union 仍是一份 envelope、一组 closure 和一次 migration；它不能隔离 source failure。

旧 `niceeval.observability` aggregate 无法证明字段来自哪个 capture authority。当前 beta cutover 将其所属的
`niceeval.record` root 明确报告为 `unsupported-format`；它不能自动迁移成 source receipt，也不能为 source
navigation 伪造 provenance。

## 当前契约落点

- Feature 是当前唯一真相；本目录中的 Goals、Limits、Cases 与 PLAN 文档只保留形成裁决时的历史比较，不能改写 Feature。
- Source receipt、Seal manifest 与 reader-side view：[Observability Source receipts](../../feature/record/architecture/observability-attachments.md)。
- Record 发布边界：[Record Architecture](../../feature/record/architecture.md)。
