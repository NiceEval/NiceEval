# Sample Library

`niceeval/analysis` 公开 immutable Analysis 值、稳定 identity、codec 与纯 narrowing；
`niceeval/report` 为 Report 作者重导出这些需要的类型。Record reader、selection 执行、
reader-bound handle 与 I/O error 都属于内部 Report host，不是应用集成面。

## AnalysisSample shape

```ts
import { ExperimentIdSchema, narrowAnalysisSample } from "niceeval/analysis";
import type {
  AnalysisRun,
  AnalysisSample,
  AnalysisSelectionSummary,
  AnalysisSlot,
  AnalysisSlotRef,
  AttemptId,
  ExperimentId,
  RunId,
  SlotId,
} from "niceeval/analysis";

interface AnalysisSample {
  readonly selection: AnalysisSelectionSummary;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
  readonly denominator: number;
}
```

`AnalysisSample` 只包含已经读取并验证的 Core 事实、选择摘要和 slot 状态。
它不包含 reader、路径、文件句柄、callback 或延迟查询。宿主关闭资源 Scope 后，
Report callback 仍可读取这个自包含值。

`runs` 按 RunId 排序。`slots` 按 RunId、SlotId 排序，每个由 selection 建立的 expected
SlotId 恰好一项。`explicit-runs` 使用每个具名 Run 的完整 expected slots；
`project-current` 只把身份仍匹配当前目标的 slots 纳入 Sample。`denominator` 等于非 excluded slot 数；
`slots.length` 始终保留纯 narrowing 前的 selection 框架。

Slot 是下列穷尽联合：

- `included`：合法 Member 指向 origin 或 reference Attempt；
- `not-recorded`：expected slot 没有 Member；
- `core-invalid`：Core 或精确引用不成立，并携带结构化 issue；
- `excluded`：纯 narrowing 从已有 Sample 排除的 base slot。

ExperimentId、EvalId、Evaluation 类型和 attempt ordinal 不冒充 Core。Report 需要这些事实时，
声明 `niceeval/report` 提供的官方 opaque projector。

## Codec

`encodeAnalysisSample` 与 `decodeAnalysisSample` 只处理自包含的纯值。decode 在 JSON 边界
exact 校验、规范化顺序并 deep-freeze；失败返回 `AnalysisSampleCodecError`。codec 不接受
Record root，也不会打开 reader 或恢复 Attachment I/O。

## Narrowing

```ts
interface AnalysisSampleSelector {
  readonly runIds?: readonly RunId[];
  readonly slotIds?: readonly SlotId[];
}

const narrowed = narrowAnalysisSample(sample, selector);
```

单字段内是 OR，不同字段间是 AND。Narrowing 只做 monotonic intersection：excluded slot
不会重新纳入，也不读取 Record。空 selector 不表示“全部”，而是 invalid input；调用方要
保留全部成员就不要调用 narrowing。

## 内部 selection

CLI host 以 frozen Record view 执行 `explicit-runs` 或 `project-current` selection，并在同一 Scope 内完成所需 projection I/O。它不会把 reader、selection function 或 live handle 暴露给 Report 作者。

不带 locator 或 `--run` 的 `niceeval show` / `niceeval view` 使用当前项目身份保留全部匹配结果。locator 与 `--run` 用于读取指定历史事实；用户不从 Library 打开 Record。
