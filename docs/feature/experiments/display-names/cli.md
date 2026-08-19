# Experiment 展示名称 —— CLI

本功能不新增命令。
它扩展既有 `niceeval exp list`、`niceeval exp --dry`、`niceeval exp`、`niceeval show` 和 `niceeval view`。

Experiment 选择继续只接受 `experimentId` 的既有精确或路径前缀语义。
`displayName` 和 `description` 不匹配 selector。
`show` 与 `view` 沿用现行选择契约：不传 locator 与 `--run` 时形成当前项目的全部匹配 Runs，
可重复的精确 `--run <RunId>` 用于审计指定历史 Run。`displayName` 和 `description` 都不参与这两条选择路径。

## Human 输出

`exp list` 把展示名称作为主标题，并始终在同一行显示完整 ID。
重复名称不报错，也不合并条目。

```text
Experiment             ID
Baseline               compare/codex
Baseline               compare/codex-with-memory
compare/claude         compare/claude
```

第三行表示该定义没有 `displayName`，因此展示值与完整 ID 相同。
Human renderer 可以避免重复印出同一串文本，但不能缩短或省略 ID。
description 只在列表详情中显示，不能替代主标题。

dry 计划和运行中的行把名称与 ID 成对呈现：

```text
Baseline [compare/codex]  memory/commit0  ordinal 0  carried @1K1P0VJAPVJ12
```

人类完成摘要在 terminal JSON receipt 前显示 `displayName [experimentId] → runId`。
随后的人类 receipt 段只逐行显示 canonical published `runIds`。
`show` 与 `view` 的 Run 标题显示 Run 保存的名称与完整 ID。
每个选中 Run 都遵守这条呈现规则；多个 Run 按既有 canonical Run ID 顺序呈现。

## JSON 与协议版本

展示名称只进入下表穷尽列出的输出位置。selector、map key、Report selection 与 debug locator 仍只使用
`experimentId`，不能因为某个对象含 ID 就推断它也必须含名称。

| 输出协议 | 版本 | 展示字段边界 |
|---|---:|---|
| `niceeval exp list --json` 的 `niceeval.experiments` | `1 → 2` | 每个 Experiment row 必含 `experimentId` 与 `displayName`。 |
| `niceeval exp --dry --json` 的 `niceeval.exp-plan` | `4 → 5` | 每个 Experiment target 必含两个字段；reuse action 与 locator 不复制。 |
| `niceeval exp --json` 的 `niceeval.exp` NDJSON | `1 → 2` | 原本含 `experimentId` 的 event variant 同时必含 `displayName`；复用汇总的每项也含两个字段。 |
| 内建 Report 的 Run summary | `ReportRunSummaryV1` | `show`、`view` 与 static 共用 Run snapshot 投影。 |
| `niceeval.debug-plan/v1` | 不变 | 只保留用于精确定位配对的 `experimentId`。 |
| `InvocationReceipt` | 不变 | 只交接 canonical published `runIds`。 |

terminal JSON receipt 不指向 Experiment，而是交接 canonical published Run ID 集合；所以它只使用既定
`InvocationReceipt` 的 `runIds`，不是例外或漏字段。自定义 `niceeval.report-target-execution/v1` 只交付作者
Page 的关闭结果，也不自动注入 Experiment 名称。

```ts
interface ExperimentListEntryV2 extends ExperimentOutputFieldsV1 {
  readonly description?: string;
  readonly agent: string;
  readonly model?: string;
  readonly attempts: number;
  readonly evalCount: number;
  readonly labels: Readonly<Record<string, string | number>>;
  readonly selectedEvalIds: readonly string[];
}

interface ExperimentListDocumentV2 {
  readonly format: "niceeval.experiments";
  readonly schemaVersion: 2;
  readonly experiments: readonly ExperimentListEntryV2[];
}

interface ExperimentPlanDocumentV5 {
  readonly format: "niceeval.exp-plan";
  readonly schemaVersion: 5;
  readonly total: number;
  readonly evals: number;
  readonly configs: number;
  readonly attempts: number;
  readonly reused: number;
  readonly matrix: readonly ExperimentPlanRowV5[];
}

type ExperimentPlanRowV5 = Omit<ExperimentPlanRowV4, "experimentId"> &
  ExperimentOutputFieldsV1;

interface ExpStreamStartEventV2 extends Omit<ExpStreamStartEventV1, "schemaVersion"> {
  readonly format: "niceeval.exp";
  readonly schemaVersion: 2;
}

type ExperimentScopedExpEventV2 =
  | (FailureEventV1 & ExperimentOutputFieldsV1)
  | (ErrorEventV1 & ExperimentOutputFieldsV1)
  | (EvalEventV1 & ExperimentOutputFieldsV1)
  | (BudgetExhaustedEventV1 & ExperimentOutputFieldsV1)
  | (ExperimentSetupEventV1 & ExperimentOutputFieldsV1)
  | (ExperimentTeardownEventV1 & ExperimentOutputFieldsV1)
  | (LockWaitEventV1 & ExperimentOutputFieldsV1)
  | (ExperimentNoticeEventV1 & ExperimentOutputFieldsV1)
  | (ExperimentWarningEventV1 & ExperimentOutputFieldsV1);

type ExpEventV2 =
  | ExpStreamStartEventV2
  | ProgressEventV2
  | SandboxReuseFinalEvent
  | ExperimentScopedExpEventV2
  | KeptEventV1
  | GlobalExpEventV1;
```

`ExperimentPlanRowV4` 与各个 `*EventV1` 名称表示 v4/v1 中同名 variant 的完整既有字段；上面的 `Omit` / 交叉
只替换或增加展示字段，不能删除、重命名或放宽其它字段。

`KeptEventV1` 保留 v1 的 `event`、`locator`、`evalId`、`attempt`、`verdict`、`provider`、`sandboxId`
与 `enter` 完整字段。它报告已经原子登记的 Sandbox 现场，没有可审计的单个 Experiment subject，因此不补
`experimentId` 或 `displayName`。`GlobalExpEventV1` 穷尽 start 之外没有单个 Experiment subject 的 Judge
precheck、interrupted、reporter error 与 receipt。`ProgressEventV2` 和 `SandboxReuseFinalEvent` 的精确增量由
[Experiments CLI](../cli.md#sandbox-复用汇总)唯一拥有。

首行只能是 `ExpStreamStartEventV2`。其后只能是同一 `ExpEventV2` 联合的非 start variant，最后恰好一条 receipt。

`niceeval.exp` v2 的 failure、error、eval、budget、Experiment hook、lock-wait，以及带 Experiment identity 的
notice / warning 都使用 `ExperimentOutputFieldsV1`。start、全局 progress、kept、Judge precheck、interrupted、
reporter error 与 receipt 没有单个 Experiment subject，不添加顶层名称。progress 内的 Sandbox 复用汇总按
[Sandbox 复用](../../sandbox/reuse.md#运行级复用反馈)自己的穷尽形状携带名称。

`niceeval.exp-plan` v5 的 target 使用同一对字段。reuse action、prior locator 与 explanation 的形状唯一由
[缓存与携带](../cache.md)定义；它们不复制第二套计划决定。

`show --json` 的内建 selected Run 摘要使用 Reports-owned `ReportRunSummaryV1`；`view` 与 static 的内建 host
data 使用同一 summary，而不是从页面标题反向提取字段。`niceeval.show` 因新增显式 `runPresentations` 字段从
v1 升为 v2；精确形状由 [Reports CLI](../../reports/cli.md)拥有，不能借 `JsonValue` 隐藏 required field 变化。

`displayNameState: "recorded"` 表示读取到 Run snapshot。
`"fallback-missing"` 只表示已发布 Run 缺少该 Attachment，并以完整 ID 作为展示名称；Record v1 无法区分
较早 writer 省略与发布后删除。`"unavailable"` 只表示 Attachment unsupported 或 invalid；JSON 仍以完整 ID
填充 `displayName`，同时保留 Record problem，不能把它伪装成已经持久化的名称。root/Core、已知 family 的
migration-required、I/O 与 open 失败会阻断输出，不能成为第三种 fallback。

## dry、并发与审计

dry 只读取当前 discovery definition 并得到展示值。
它不建立 Invocation、不写 Run snapshot、不写 Record，也不改变 reuse 结果。

正式 Invocation 把当前规范化后的展示值写入每个新 Run。
Run writer、frozen reuse plan、budget 和 Sandbox 调度仍只按 `experimentId` 工作。
并发 Invocation 不共享展示名称 registry，也不会因重复名称互相阻塞。

`show` 和 `view` 对已选择的 published Run 读取其快照。
它们不读取当前项目的 Experiment 源码来改写历史标题。
terminal JSON receipt、Report JSON 和静态导出形成审计链，但它们不成为 identity 或 selection 输入。

## 退出码、删除与公开验收

| 情况 | 退出行为 |
|---|---:|
| 重复展示名称 | 0；所有条目继续按 ID 输出。 |
| 缺失展示名称 | 0；使用完整 ID。 |
| 无效展示名称 | 1；受控 discovery error，在 Invocation 前失败。 |
| 按 displayName 传入 selector | 1；受控 selector error，提示使用完整 ID 或现有路径前缀。 |
| 正常执行后有失败或未完成 Run | 沿用 Runner 既有退出码。 |
| 中断 | 130。 |

删除短 ID、名称别名、名称唯一注册、按名称选择，以及把名称映射写入 terminal JSON receipt 的路径。
事件 consumer 必须按 schema version 显式分流，不能探测字段猜兼容路径；receipt consumer 保持既定 canonical `runIds` 契约。

生产验收执行真实 `exp list`、`exp --dry --json`、`exp --json`、不带 selection 的 `show --json` / `view`，以及
`show --run <RunId> --json` / `view --run <RunId>`。
验收逐项核对上表和 `ExpEventV2` 联合声明的 Experiment-scoped 位置都有 ID 与名称；global variant 与 terminal
JSON receipt 不添加名称，receipt 只保留 canonical `runIds`。重复名称不改变选择，名称改动不改变 reuse。
这里没有新的 Eval Assertion；CLI-only 行为由真实 CLI/E2E 旅程证明。
