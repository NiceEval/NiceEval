# 结果携带与 Sandbox 复用反馈 —— CLI

本方向不新增命令。
它扩展既有 `niceeval exp`、`niceeval exp --dry`、`niceeval show` 与 `niceeval view` 的反馈。
`accept` 与 `exp rename` 继续走 explicit adoption，不使用这里的 `carried` action。

## Human 输出

`--dry` 在每个 Slot 显示 frozen plan 的 action、完整 prior locator 和解释。
执行命令的计划段与结束摘要复用同一措辞。

```text
PLAN
compare/codex  memory/commit0  ordinal 0  carried @01J8ZK3M6P4T7V9X2C5N8QW0RY  eligible
compare/codex  memory/commit0  ordinal 1  execute @01J8ZK3M6P4T7V9X2C5N8QW0RY  identity-mismatch
compare/codex  memory/commit0  ordinal 2  execute  no-prior  source-slot-missing
```

Human 输出只把 `priorLocator` 原样显示。
它不缩短 locator，不从计划外 Run 猜 prior，也不把 `execute` 说成一次已经发生的执行。

live 面板和结束反馈把结果携带称作 `carried`。
声明 `sandboxReuse` 时，面板对每个 Experiment 与 Eval Group 显示 `active`、`created` 和 `assignments`。
`replacements` 只有非零才显示；结束反馈显示四项最终值。

多个 group 不合并成总数。
逐实例承接细节由 `show` 与 `view` 提供，不进入运行流。

## JSON

`niceeval.exp-plan` 升为 schemaVersion 5。
`niceeval.exp` 升为 schemaVersion 3。
两个版本都使用 [Experiment display names CLI](../experiment-display-names/cli.md) 定义的扁平 `ExperimentOutputFieldsV1`，因此每个 Experiment 位置恒同时输出 `experimentId` 与 `displayName`。

```ts
interface ExpPlanSlotV5 extends ExperimentOutputFieldsV1 {
  readonly evalId: EvalId;
  readonly attempt: number;
  readonly action: "carried" | "execute";
  readonly priorLocator: AttemptLocator | null;
  readonly comparisons: readonly ComparisonProvenance[];
  readonly explanation:
    | CarriedPlanSlot["explanation"]
    | ExecutePlanSlot["explanation"];
}

interface ExpPlanDocumentV5 {
  readonly format: "niceeval.exp-plan";
  readonly schemaVersion: 5;
  readonly policy: ExecutionPolicyIdentity;
  readonly effectiveOptions: Readonly<JsonValue>;
  readonly slots: readonly ExpPlanSlotV5[];
  readonly carried: number;
  readonly execute: number;
}

interface ExpSlotPlanEventV3 extends ExperimentOutputFieldsV1 {
  readonly type: "slot_plan";
  readonly evalId: EvalId;
  readonly attempt: number;
  readonly action: "carried" | "execute";
  readonly priorLocator: AttemptLocator | null;
  readonly explanation:
    | CarriedPlanSlot["explanation"]
    | ExecutePlanSlot["explanation"];
}

interface ExpSlotResultEventV3 extends ExperimentOutputFieldsV1 {
  readonly type: "slot_result";
  readonly evalId: EvalId;
  readonly attempt: number;
  readonly plannedAction: "carried" | "execute";
  readonly priorLocator: AttemptLocator | null;
  readonly outcome: "carried" | "executed" | "not-dispatched" | "interrupted";
}

interface SandboxReuseEventV3 extends ExperimentOutputFieldsV1 {
  readonly type: "progress" | "result";
  readonly sandboxReuse: readonly SandboxReuseSummary[];
}
```

`carried` 与 `execute` summary 由 `slots` 归约。
它们不是另一份决策集合。
运行事件从原 frozen slot 复制 action、locator 与 explanation；`outcome` 只补充真实执行收尾。

JSON 模式 stdout 只有计划文档或 NDJSON 事件。
诊断写入 stderr。
消费者按 `schemaVersion` 分流；旧 reducer 收到 v3 或 v5 时报告 `unsupported schemaVersion`，不得探测字段猜版本。

## dry、并发与审计

`niceeval exp … --dry` 取得 shared maintenance lease 的 frozen reader。
它不建立 Invocation、不写 Record、不取得 writer lock，也不创建 Sandbox。
dry 的 action、locator 与 explanation 必须与同一 frozen view 上的正式 Invocation 相同。

正式 `exp` 在计划前取得 writer lock 并冻结 view。
同一 Record root 的另一条写 Invocation 立即以 `record-writer-busy` 失败。
只读 `show`、`view` 与 `--dry` 只读取已经发布的完整 Run，不能观察 writer 的局部 plan。

sealed Run 的 membership provenance 保存 frozen slot 决定与最终 outcome。
它是审计入口；CLI 不保存第二份 plan 文档，也不从事件流恢复 durable 事实。

## 退出码与失败

| 情况 | dry | 执行 |
|---|---:|---:|
| 成功形成 plan；其中有 execute Slot | 0 | 沿用 Runner 的完成状态 |
| selector、配置、policy 或 frozen view 无法形成 plan | 2 | 2 |
| 执行后有 failed、errored 或 incomplete | 不适用 | 1 |
| 进程中断 | 130 | 130 |

历史 Attachment 不可用、无法迁移、不支持或 invalid 时，plan 形成带真实 issue 的 `execute` Slot。
它不能降级为 `no-source-run`，也不能回扫更旧 Run。
无法打开 Record、无法验证 target，或 policy version 不受支持时，整个命令在计划前失败。

## 迁移与公开验收

Human 文案、`niceeval.exp` v3 与 `niceeval.exp-plan` v5 删除 `reused` 字段和别名。
不提供按字段猜测的兼容 reader。

生产验收运行真实 `exp --dry --json`、真实 `exp --json`，再用 `show` 与 `view` 核对同一 Slot 的 action、完整 locator、解释和 sealed outcome。
此处没有新的 Eval Assertion。
