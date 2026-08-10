# Sample Library

本页是 `AnalysisSample` 公开形状的唯一 owner。Record 拥有 Run、Member、Attempt 与读取 issue；Experiments 拥有 `ExecutionProjection`。Sample 只定义怎样把既有 Record 事实投影成分析范围。

## 分析投影器

```ts
interface AnalysisProjectorIdentity {
  readonly name: string;
  readonly version: number;
}

interface ExplicitRunsAnalysisInput {
  readonly runIds: readonly [string, ...string[]];
}

interface LatestAnalysisInput {
  readonly experimentIds?: readonly string[];
}

interface AnalysisProjectionProvenance {
  readonly projector: AnalysisProjectorIdentity;
  readonly input: Readonly<JsonValue>;
}

function projectExplicitRuns(
  record: RecordView,
  input: ExplicitRunsAnalysisInput,
): Promise<AnalysisSample>;

function projectLatestRuns(
  record: RecordView,
  input: LatestAnalysisInput,
): Promise<AnalysisSample>;
```

内建 projector identity 固定为 `explicit-runs/v1` 与 `latest/v1`。`provenance.input` 是公开输入经过确定性去重和安全归一化后的 JSON 值，不含 Record root、路径、句柄或读取到的业务通道。

`explicit-runs/v1` 按 `runId` 精确匹配。重复值被删除，任一 `runId` 不存在或对应 Run 无法读取时，projection 失败。

`latest/v1` 只考虑完成的 Run，并且每个目标 Experiment 恰好选择一个。若 `experimentIds` 已给出，去重后的非空列表就是目标集合；若省略，则所有可读 Run 核心中出现过的 Experiment 都是目标。

每个目标 Experiment 内按 `completedAt` 升序排列，同一时间使用 `runId` 升序打破并列，最后一项被选中。目标集合为空，或任一目标 Experiment 没有完成 Run，都返回 `sample-latest-unavailable`；它不会悄悄缩小比较组。

latest 必须穷尽候选 Run。任一 Run 无法可靠读取排序所需的 runId、experimentId 或 completedAt 时，返回 `sample-latest-indeterminate`，不能静默跳过。未完成 Run 只能通过 `explicit-runs/v1` 选择。

自定义 analysis projector 可以采用其它用户指定范围或排序，但必须使用独立的稳定 identity，并产出本页定义的完整 `AnalysisSample`。它不能声明当前目标是否需要执行。

## 收窄输入

```ts
interface AnalysisSampleSelector {
  readonly runIds?: readonly string[];
  readonly experimentIds?: readonly string[];
  readonly evalIds?: readonly string[];
  readonly slotIds?: readonly string[];
}
```

每个字段按字符串精确匹配。单字段内是 OR，不同字段间是 AND；省略字段表示不限制该维度。selector 不接受 glob、前缀匹配或任意回调。

## AnalysisSample 形状

```ts
interface AnalysisSlotBase {
  readonly runId: string;
  readonly slotId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
}

interface IncludedAnalysisSlot extends AnalysisSlotBase {
  readonly state: "included";
  readonly memberKind: "executed" | "carried" | "accepted";
  readonly attemptId: string;
  readonly locator: string;
  readonly originRunId: string;
  readonly attemptCore: AnalysisAttempt;
}

interface AnalysisAttempt {
  readonly attemptId: string;
  readonly origin: { readonly runId: string; readonly slotId: string };
  readonly eval: { readonly evalId: string; readonly attempt: number };
}

interface NotRecordedAnalysisSlot extends AnalysisSlotBase {
  readonly state: "not-recorded";
}

interface InvalidAnalysisSlot extends AnalysisSlotBase {
  readonly state: "invalid";
  readonly issues: readonly [RecordIssue, ...RecordIssue[]];
}

interface ExcludedAnalysisSlot extends AnalysisSlotBase {
  readonly state: "excluded";
  readonly previous:
    | IncludedAnalysisSlot
    | NotRecordedAnalysisSlot
    | InvalidAnalysisSlot;
  readonly selector: AnalysisSampleSelector;
}

type AnalysisSlot =
  | IncludedAnalysisSlot
  | NotRecordedAnalysisSlot
  | InvalidAnalysisSlot
  | ExcludedAnalysisSlot;

interface AnalysisRun {
  readonly runId: string;
  readonly experimentId: string;
  readonly startedAt: UtcMillis;
  readonly completedAt?: UtcMillis;
  readonly expectedSlots: readonly ExpectedSlot[];
}

interface AnalysisSample {
  readonly provenance: AnalysisProjectionProvenance;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
  readonly included: readonly IncludedAnalysisSlot[];
  readonly notRecorded: readonly NotRecordedAnalysisSlot[];
  readonly invalid: readonly InvalidAnalysisSlot[];
  readonly excluded: readonly ExcludedAnalysisSlot[];
}
```

`RecordIssue` 由 [Record Library](../record/library.md) 定义。`AnalysisSample` 是 core-only：它不请求业务通道，也不保存 `ChannelRead`、RecordView、文件路径、句柄或 normalized fact。

`runs` 穷尽本次实际选中的 Run，并按 `runId` 排序。它不因 Run 没有 expected slot，或全部 slot 都是 not-recorded、invalid、excluded 而省略该 Run。`slots` 是完整分母，按 `runId`、`slotId` 排序，每个 `(runId, slotId)` 恰好出现一次。四个状态子序列互斥且保序。

included 项读取 Member 采用的 Attempt。基类的 `attempt` 是 expected slot 的非负序号；`attemptCore` 才是所引用 Attempt 的核心投影。executed 的 `originRunId` 等于当前 `runId`；carried 与 accepted 保留源 Attempt 的 origin。`locator` 必须由完整 `attemptId` 双向转换得到。

invalid 项保存 reader 对 membership、identity 或引用产生的全部相关 issues。analysis projector 不把它们改写成空值或 not-recorded。通道状态不会自动把 slot 核心改成 invalid。

## 构造入口

两个内建 projector 都按以下顺序形成 `AnalysisSample`：

1. 按自己的具名 policy 选出 Run。
2. 按每个 Run 的 expected membership 形成分母。
3. 读取每个正式 Member 及其 Attempt。
4. 把缺少 Member 的 expected slot 标为 `not-recorded`。
5. 把隔离在 Run 之下的 Member、Attempt 核心或引用错误标为 `invalid`。

显式 projector 只读取所选 Run；未选择 Run 的损坏内容不阻断。若所选 Run 自身无法形成 expected slots，或其 members 目录存在没有对应 expected slot 的额外文件，projection 整体失败。对已声明 slot 的 Member、Attempt 核心或引用错误进入对应 slot。

```ts
function narrowAnalysisSample(
  sample: AnalysisSample,
  selector: AnalysisSampleSelector,
): AnalysisSample;
```

`narrowAnalysisSample()` 不重新读取 Record。匹配项保留原状态；未匹配项改成 `excluded`，并在 `previous` 中保留收窄前状态。对同一输入重复调用得到相同结果。

## 错误

```ts
type AnalysisProjectionError =
  | { readonly code: "sample-run-not-found"; readonly runId: string }
  | { readonly code: "sample-latest-unavailable"; readonly experimentId?: string }
  | { readonly code: "sample-latest-indeterminate"; readonly issues: NonEmptyRecordIssues }
  | { readonly code: "sample-selection-invalid"; readonly field: string; readonly reason: string }
  | { readonly code: "sample-run-invalid"; readonly runId: string; readonly issues: NonEmptyRecordIssues };
```

错误只描述 analysis projector 的调用输入与 Run 选择。Record 结构、文件和引用错误继续使用 Record owner 的 typed issue，不在 Sample 重新命名。

## 与 Reports 的边界

Reports 只能从 `AnalysisSample` 构造 `ReportInput`。报告可以计算聚合、呈现 coverage 和 issues，也可以把已计划页面导出成静态目录。Reports 不接收 `ExecutionProjection`，不重新选择历史，也不判断是否需要执行。

## 相关阅读

- [README](README.md) —— 分析投影的用户心智和范围。
- [局部执行后的分析](use-case/partial-rerun.md) —— Run membership 怎样形成分析分母。
- [Record Library](../record/library.md) —— `RecordView`、`ChannelRead` 与 `RecordIssue`。
- [Execution projection](../experiments/cache.md) —— 当前目标的 reuse 与 gap。
- [Reports](../reports/README.md) —— `AnalysisSample` 到 `ReportInput` 的单向边界。
