# Projection Library

Report 作者通常只从 `niceeval/report` 导入本页能力。`niceeval/projection` 也只保留安全的
声明 constructor、官方 opaque projectors、纯结果类型与纯 assembler；它不导出 raw
Record projector factory 或执行入口。

## 声明逻辑访问

```ts
import {
  attemptOriginRunProjection,
  attemptSlotProjection,
  selectedRunProjection,
  verdictProjector,
} from "niceeval/report";

const verdictsBySlot = attemptSlotProjection(verdictProjector);
```

`RecordAttachmentProjector<Owner, Value>` 与 `RecordProjection<Access, Value>` 是
package-created opaque declaration。作者可以把官方 projector 放进三种 constructor，
但不能实现 brand、绑定 raw family 或接收 payload / blob capability。

```ts
type ProjectionAccess =
  | "attempt-slot"
  | "attempt-origin-run"
  | "selected-run";

declare const attemptSlotProjection: <Value>(
  projector: RecordAttachmentProjector<"attempt", Value>,
) => RecordProjection<"attempt-slot", Value>;

declare const attemptOriginRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"attempt-origin-run", Value>;

declare const selectedRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"selected-run", Value>;
```

三种 declaration 都是纯值。创建它们不打开 Record，也不执行 projection。Report host 在
执行前静态闭合依赖，同一个 unique projection 最多执行一次。

## 官方 projectors

公开集合包括 Verdict、Score、Evaluations、Evaluation Plan、Eligibility、Membership
Provenance、Sandbox、Conversation、Usage、Timing 与 Commands。
集合也包含 Diagnostics、Assertions 与 Sources。每个 projector 只返回命名的 typed view，不暴露它绑定的 Attachment family、
schema decoder、raw payload、blob ref 或 owner lookup。

## ProjectedSample

`ProjectedSample<Access, Value>` 保留原 `AnalysisSample`、逻辑 access、穷尽 entries 与
coverage。Attempt slot / origin-run entry 为：

- `excluded`、`not-recorded` 或 `core-invalid`；
- `attachment-result`，其中 Attachment result 是 available 或具名的数据问题。

selected-run entry 始终是 `attachment-result`。reference Attempt 的 origin Run 不因此加入
selected Runs；逻辑访问不会改变 Sample 分母。

## Pure source assembler

`assembleAttemptSourceTree()` 只组合已经投影的 sources、assertions 与 source-sites 值。
它不读取当前 worktree、不打开 Record，也不补做 owner lookup。结果以 durable `entryId`
去重计数；一个 entry 的多个 site / occurrence 不会变成额外 assertion 或分值。

## 内部执行边界

CLI host 在 reader Scope 内把 `AnalysisSample`、opaque declarations 与内部 interpreter 组合，
完成 Attachment I/O 后才调用 Report graph。不存在公开的 `projectAnalysisSample()`、
`selectAnalysisSampleForAttempt()` 或 `defineRecordAttachmentProjector()`。需要观察一次运行时，
用户从 `niceeval show` / `niceeval view` 进入；Report 作者只声明数据需求。
