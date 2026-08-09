# Sample Library

本页是 Sample 公开形状的唯一 owner。Record 拥有 Run、Member、Attempt 与读取 issue；Sample 只定义怎样选择这些值。

## 选择输入

```ts
type RunSelection =
  | {
      readonly kind: "runs";
      readonly runIds: readonly [string, ...string[]];
    }
  | {
      readonly kind: "latest";
      readonly experimentIds?: readonly string[];
    };

interface SampleSelector {
  readonly runIds?: readonly string[];
  readonly experimentIds?: readonly string[];
  readonly evalIds?: readonly string[];
  readonly slotIds?: readonly string[];
}
```

`runs` 按 `runId` 精确匹配。重复值被删除，任一 `runId` 不存在或对应 Run 无法读取时，选择失败。

`latest` 只考虑完成的 Run，并且每个目标 Experiment 恰好选择一个。若 `experimentIds` 已给出，去重后的非空列表就是目标集合；若省略，则所有可读 Run 核心中出现过的 Experiment 都是目标。每个目标 Experiment 内按 `completedAt` 升序排列，同一时间使用 `runId` 升序打破并列，最后一项被选中。目标集合为空，或任一目标 Experiment 没有完成 Run，都返回 `sample-latest-unavailable`；它不会悄悄缩小比较组。

`SampleSelector` 的每个字段按字符串精确匹配。单字段内是 OR，不同字段间是 AND；省略字段表示不限制该维度。selector 不接受 glob、前缀匹配或任意回调。

## Sample 形状

```ts
interface SampleSlotBase {
  readonly runId: string;
  readonly slotId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
}

interface IncludedSampleSlot extends SampleSlotBase {
  readonly state: "included";
  readonly memberKind: "executed" | "carried" | "accepted";
  readonly attemptId: string;
  readonly locator: string;
  readonly originRunId: string;
  readonly attemptCore: SampleAttempt;
}

interface SampleAttempt {
  readonly attemptId: string;
  readonly origin: { readonly runId: string; readonly slotId: string };
  readonly eval: { readonly evalId: string; readonly attempt: number };
}

interface NotRecordedSampleSlot extends SampleSlotBase {
  readonly state: "not-recorded";
}

interface InvalidSampleSlot extends SampleSlotBase {
  readonly state: "invalid";
  readonly issues: readonly [RecordIssue, ...RecordIssue[]];
}

interface ExcludedSampleSlot extends SampleSlotBase {
  readonly state: "excluded";
  readonly previous:
    | IncludedSampleSlot
    | NotRecordedSampleSlot
    | InvalidSampleSlot;
  readonly selector: SampleSelector;
}

type SampleSlot =
  | IncludedSampleSlot
  | NotRecordedSampleSlot
  | InvalidSampleSlot
  | ExcludedSampleSlot;

interface SampleRun {
  readonly runId: string;
  readonly experimentId: string;
  readonly completedAt?: UtcMillis;
  readonly expectedSlots: readonly ExpectedSlot[];
}

interface Sample {
  readonly recordRoot: string;
  readonly selection: RunSelection;
  readonly runs: readonly SampleRun[];
  readonly slots: readonly SampleSlot[];
  readonly included: readonly IncludedSampleSlot[];
  readonly notRecorded: readonly NotRecordedSampleSlot[];
  readonly invalid: readonly InvalidSampleSlot[];
  readonly excluded: readonly ExcludedSampleSlot[];
}
```

`RecordIssue` 由 [Record Library](../record/library.md) 定义。Sample 是 core-only：它不请求业务通道，也不保存 `ChannelRead` 或 normalized fact。

`runs` 穷尽本次实际选中的 Run，并按 `runId` 排序。它不因 Run 没有 expected slot，或全部 slot 都是 not-recorded、invalid、excluded 而省略该 Run。`slots` 是完整分母，按 `runId`、`slotId` 排序，每个 `(runId, slotId)` 恰好出现一次。`included`、`notRecorded`、`invalid` 与 `excluded` 是 `slots` 按 state 形成的互斥、保序子序列。

included 项读取 Member 采用的 Attempt。基类的 `attempt` 是 expected slot 的非负序号；`attemptCore` 才是所引用 Attempt 的核心投影，两个字段不能使用同一个属性名。executed 的 `originRunId` 等于当前 `runId`；carried 与 accepted 保留源 Attempt 的 origin。`locator` 必须由完整 `attemptId` 双向转换得到。

invalid 项保存 reader 对 membership、identity 或引用产生的全部相关 issues。Sample 不把它们改写成空值或 not-recorded。

通道状态不会自动把 slot 核心改成 invalid。ReportPlan 形成后，唯一的 Record→Reports composition adapter 才请求报告实际依赖的 facts，并把四态读取保存在 ReportInput。

## 构造入口

```ts
function selectSample(
  record: RecordReader,
  selection: RunSelection,
): Promise<Sample>;

function narrowSample(
  sample: Sample,
  selector: SampleSelector,
): Sample;
```

`selectSample()` 按以下顺序执行：

1. 校验显式 `runId`，或计算 `latest` policy。
2. 按每个 Run 的 expected membership 形成分母。
3. 读取每个正式 Member 及其 Attempt。
4. 把缺少 Member 的 expected slot 标为 `not-recorded`。
5. 把隔离在 Run 之下的 Member、Attempt 核心或引用错误标为 `invalid`。

显式选择只读取所选 Run；未选择 Run 的损坏内容不阻断。若所选 Run 自身无法形成 expected slots，或其 members 目录存在没有对应 expected slot 的额外文件，selection 整体失败。对已声明 slot 的 Member、Attempt 核心或引用错误进入对应 slot。

`latest` 必须穷尽候选 Run。任一 Run 无法可靠读取排序所需的 runId、experimentId 或 completedAt 时，返回 `sample-latest-indeterminate`，不能静默跳过。目录停稳是调用前置条件；Sample 不用 revision/hash 承诺检测并发修改。

`narrowSample()` 不重新读取 Record。匹配项保留原状态；未匹配项改成 `excluded`，并在 `previous` 中保留收窄前状态。对同一 Sample 和 selector 重复调用得到相同结果。

## 错误

```ts
type SampleSelectionError =
  | {
      readonly code: "sample-run-not-found";
      readonly runId: string;
    }
  | {
      readonly code: "sample-latest-unavailable";
      readonly experimentId?: string;
      readonly reason: "no-completed-run";
    }
  | {
      readonly code: "sample-latest-indeterminate";
      readonly issues: readonly [RecordIssue, ...RecordIssue[]];
    }
  | {
      readonly code: "sample-run-membership-invalid";
      readonly runId: string;
      readonly issues: readonly [RecordIssue, ...RecordIssue[]];
    }
  | {
      readonly code: "sample-selection-invalid";
      readonly issue: "empty-runs" | "unknown-field" | "invalid-value";
    };
```

选择错误只描述调用输入与 Run 选择。Record 结构、文件和引用错误继续使用 Record owner 的 typed error，不在 Sample 重新命名。

目标集合本身为空时，`sample-latest-unavailable.experimentId` 省略；具名目标没有完成 Run 时它等于该 Experiment identity。`latest.experimentIds` 为空数组属于 `sample-selection-invalid/invalid-value`。

## 与 Reports 的边界

Reports 从 `Sample` 构造进程内 `ReportInput` 普通值。报告可以计算聚合、呈现 coverage 和 issues，也可以把已计划页面导出成静态目录。

Reports 不得重新打开 Record、替换 `selection`、补猜缺少的 Attempt 或把 `invalid` 排除出分母而不提示。

## 相关阅读

- [README](README.md) —— Sample 的用户心智和范围。
- [局部补跑](use-case/partial-rerun.md) —— Run membership 怎样形成分母。
- [收窄样本](use-case/收窄样本.md) —— 纯内存收窄规则。
- [Record Library](../record/library.md) —— `RecordReader`、`ChannelRead` 与 `RecordIssue`。
