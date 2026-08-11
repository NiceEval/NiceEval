# Sample Library

本页是 `niceeval/analysis` 的公开契约。Record 拥有 Run、Member、Attempt 与 Core issue；Analysis 只从 frozen `RecordReader` 形成分析分母。

## 纯值与 live handle

```ts
import { Effect, Either } from "effect";

interface AnalysisSample {
  readonly selection: AnalysisSelectionSummary;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
  readonly denominator: number;
}

interface AnalysisSampleHandle {
  readonly sample: AnalysisSample;
}
```

`AnalysisSample` 是纯值。它只包含已经读取并验证的 Core 事实、选择摘要和 slot 状态；它不包含 reader、路径、文件句柄或延迟查询。reader 的 Scope 关闭后，调用方仍可显示或纯收窄 `sample`，但没有 API 能从它恢复 I/O。

`AnalysisSampleHandle` 是 live capability。每个 Library 创建的 handle 只绑定创建它的同一个 frozen reader view；Library 不接受手工对象、从 `AnalysisSample` 重新绑定的对象或另一个 reader 的对象。reader 关闭后，任何需要 Attachment I/O 的 handle 操作返回 `RecordReadError`，而 `handle.sample` 保持可读。

## AnalysisSelectionRequest

```ts
interface ExplicitRunsAnalysisInput {
  readonly runIds: readonly [RunId, ...RunId[]];
}

interface LatestRunsAnalysisInput {
  readonly experimentIds?: readonly [ExperimentId, ...ExperimentId[]];
}

type AnalysisSelectionRequest =
  | {
      readonly policy: "explicit-runs/v1";
      readonly input: ExplicitRunsAnalysisInput;
    }
  | {
      readonly policy: "latest-runs/v1";
      readonly input: LatestRunsAnalysisInput;
    };

declare const selectAnalysisSample: (
  reader: RecordReader,
  request: AnalysisSelectionRequest,
) => Effect.Effect<
  AnalysisSampleHandle,
  AnalysisSelectionError | RecordReadError
>;
```

`AnalysisSelectionRequest` 是纯选择配置。它不携带 `RecordReader`、`AnalysisSample`、path、callback 或任何 I/O capability；reader 始终由调用点单独传入。

也提供两个只改善调用点的窄入口：

```ts
declare const selectExplicitRuns: (
  reader: RecordReader,
  input: ExplicitRunsAnalysisInput,
) => Effect.Effect<AnalysisSampleHandle, AnalysisSelectionError | RecordReadError>;

declare const selectLatestRuns: (
  reader: RecordReader,
  input: LatestRunsAnalysisInput,
) => Effect.Effect<AnalysisSampleHandle, AnalysisSelectionError | RecordReadError>;
```

三个入口都只使用传入 reader 的 frozen view，且返回绑定这同一个 reader 的 handle。它们不会打开第二个 reader，也不会让之后完成的 Run 混入已经选择的 Sample。

Selection 是 set 语义。Library exact decode 输入、去重并按稳定 identity 排序；调用方数组顺序不进入 Sample。需要展示顺序时由 Calculation 或 Page 明确排序。

explicit 要求每个 RunId 对应带完成标识的 Run。missing 或 Run Core invalid 返回具名 selection error，不产生缩小后的假 Sample。

latest 从 Run-owned Evaluations Attachment 读取 Experiment identity，以 `completedAt`、再以 `runId` 决定最后一项。任何候选的分组 identity 无法可靠读取时返回 `sample-latest-indeterminate`，不能静默缩小比较组。

空 `experimentIds` 不等于全部；它是 invalid input。省略字段才表示所有可确定的 Experiment。

## AnalysisSample shape

```ts
type AnalysisSelectionSummary =
  | {
      readonly policy: "explicit-runs/v1";
      readonly runIds: readonly RunId[];
    }
  | {
      readonly policy: "latest-runs/v1";
      readonly experimentIds: readonly ExperimentId[] | "all";
      readonly selectedRunIds: readonly RunId[];
    };

interface AnalysisRun {
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
}

interface AnalysisSlotRef {
  readonly runId: RunId;
  readonly slotId: SlotId;
}

interface IncludedAnalysisSlot extends AnalysisSlotRef {
  readonly state: "included";
  readonly relation: "origin" | "reference";
  readonly attempt: RecordAttemptRef;
}

interface NotRecordedAnalysisSlot extends AnalysisSlotRef {
  readonly state: "not-recorded";
}

interface CoreInvalidAnalysisSlot extends AnalysisSlotRef {
  readonly state: "core-invalid";
  readonly issues: NonEmptyRecordIssues;
}

type AnalysisBaseSlot =
  | IncludedAnalysisSlot
  | NotRecordedAnalysisSlot
  | CoreInvalidAnalysisSlot;

interface ExcludedAnalysisSlot extends AnalysisSlotRef {
  readonly state: "excluded";
  readonly base: AnalysisBaseSlot;
}

type AnalysisSlot = AnalysisBaseSlot | ExcludedAnalysisSlot;
```

`runs` 按 RunId 排序。`slots` 按 RunId、SlotId 排序，每个 expected SlotId 恰好一项。`denominator` 等于非 excluded slot 数；`slots.length` 始终保留收窄前的完整框架。

ExperimentId、EvalId、Evaluation 类型和 attempt ordinal 不冒充 Core。需要这些数据的 Report 必须声明对应的 `RecordAttachment` projection。

## Narrowing

```ts
interface AnalysisSampleSelector {
  readonly runIds?: readonly RunId[];
  readonly slotIds?: readonly SlotId[];
}

declare const narrowAnalysisSample: (
  sample: AnalysisSample,
  selector: AnalysisSampleSelector,
) => Either.Either<AnalysisSample, AnalysisSelectionError>;

declare const narrowAnalysisSampleHandle: (
  handle: AnalysisSampleHandle,
  selector: AnalysisSampleSelector,
) => Effect.Effect<
  AnalysisSampleHandle,
  AnalysisSelectionError | RecordReadError
>;
```

单字段内是 OR，不同字段间是 AND。Narrowing 只做 monotonic intersection：excluded slot 不会重新纳入，也不重新读取 Record。

`narrowAnalysisSample()` 只处理纯值，因此 reader 已关闭后仍可使用。`narrowAnalysisSampleHandle()` 先验证 live handle，再返回绑定同一 frozen reader 的新 handle；它不是把 pure sample 恢复成 I/O capability 的入口。

## Limits 与错误

v1 最多选择 4,096 Runs，最多形成 250,000 Slots。Library 在复制或分配大数组前检查 count。

```ts
type AnalysisSelectionError =
  | {
      readonly code: "sample-selection-invalid";
      readonly field: string;
      readonly reason: string;
    }
  | { readonly code: "sample-run-not-found"; readonly runId: RunId }
  | {
      readonly code: "sample-run-invalid";
      readonly runId: RunId;
      readonly issues: NonEmptyRecordIssues;
    }
  | {
      readonly code: "sample-latest-indeterminate";
      readonly issues: NonEmptyRecordIssues;
    }
  | {
      readonly code: "sample-limit-exceeded";
      readonly limit: "selected-runs" | "slots";
      readonly maximum: number;
      readonly observedAtLeast: number;
    };
```

Record I/O、permission、closed reader 与 invalid reader-owned handle 保持 `RecordReadError`。latest 所需 Attachment 的 migration-required、unsupported 或 invalid 形成 `sample-latest-indeterminate`，并保留原始 Attachment 状态供诊断。

## 与 Projection、Reports 和 reuse 的边界

Projection 接收 `AnalysisSampleHandle` 与 `RecordAttachment` projector，形成 scripts 和 Reports 共用的穷尽 `ProjectedSample`。`ReportExecution` 只保存 pure `sample` 与投影结果，不保存 reader 或 handle。

reuse planning 接收当前 Project 或 Execution target，不接收 `AnalysisSample`。Reports 不接收 `ExecutionReusePlan`，Sample 也不判断当前 slot 是否需要执行。
