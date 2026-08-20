# Experiment 展示名称 —— CLI

本方向不新增命令。
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

## JSON

每个 JSON 表面只要指向 Experiment，恒同时包含 `experimentId` 和 `displayName`。
两个字段都是 string；缺失作者输入只使 `displayName` 等于完整 ID。
terminal JSON receipt 不指向 Experiment，而是交接 canonical published Run ID 集合；所以它只使用既定 `InvocationReceipt` 的 `runIds`，不是此规则的例外或漏字段。

```ts
interface ExperimentListEntryV2 extends ExperimentOutputFieldsV1 {
  readonly description?: string;
  readonly agent: string;
  readonly model: string | null;
  readonly attempts: number;
  readonly selectedEvalCount: number;
}

interface ExperimentRunOutputV1 extends ExperimentOutputFieldsV1 {
  readonly runId: RunId;
}

interface ReportRunSummaryV1 extends ExperimentRunOutputV1 {
  readonly displayNameState:
    | "recorded"
    | "fallback-missing"
    | "unavailable";
}
```

`niceeval.exp` 的 plan、progress 与 result 事件，以及 `niceeval.exp-plan` v5 使用 `ExperimentOutputFieldsV1`。
reuse action、prior locator 与 explanation 的形状唯一由 [缓存与携带](../../../feature/experiments/cache.md) 定义。
这两个 schema 不复制第二套计划决定。

`show --json` 的 selected Run 摘要使用 `ReportRunSummaryV1`。
`view` 的 host data 使用同一 summary，而不是从页面标题反向提取字段。

`displayNameState: "recorded"` 表示读取到 Run snapshot。
`"fallback-missing"` 只表示历史 Run 缺少该 Attachment，并以完整 ID 作为展示名称。
`"unavailable"` 表示 Attachment 有 non-available Record 状态；JSON 仍以完整 ID 填充 `displayName`，同时保留 Record problem，不能把它伪装成已经持久化的名称。

## dry、并发与审计

dry 只读取当前 discovery definition 并得到展示值。
它不建立 Invocation、不写 Run snapshot、不写 Record，也不改变 reuse 结果。

正式 Invocation 把当前规范化后的展示值写入每个新 Run。
writer lock、frozen reuse plan、budget 和 Sandbox 调度仍只按 `experimentId` 工作。
并发 Invocation 不共享展示名称 registry，也不会因重复名称互相阻塞。

`show` 和 `view` 对已选择的 published Run 读取其快照。
它们不读取当前项目的 Experiment 源码来改写历史标题。
terminal JSON receipt、Report JSON 和静态导出形成审计链，但它们不成为 identity 或 selection 输入。

## 退出码、删除与公开验收

| 情况 | 退出行为 |
|---|---:|
| 重复展示名称 | 0；所有条目继续按 ID 输出。 |
| 缺失展示名称 | 0；使用完整 ID。 |
| 无效展示名称 | 2；discovery 在 Invocation 前失败。 |
| 按 displayName 传入 selector | 2；提示使用完整 ID 或现有路径前缀。 |
| 正常执行后有失败或未完成 Run | 沿用 Runner 既有退出码。 |
| 中断 | 130。 |

删除短 ID、名称别名、名称唯一注册、按名称选择，以及把名称映射写入 terminal JSON receipt 的路径。
事件 consumer 必须按 schema version 显式分流，不能探测字段猜兼容路径；receipt consumer 保持既定 canonical `runIds` 契约。

生产验收执行真实 `exp list`、`exp --dry --json`、`exp --json`、不带 selection 的 `show --json` / `view`，以及
`show --run <RunId> --json` / `view --run <RunId>`。
验收核对所有指向 Experiment 的 JSON 位置都有 ID 与名称，terminal JSON receipt 只保留 canonical `runIds`，重复名称不改变选择，名称改动不改变 reuse。
这里没有新的 Eval Assertion；CLI-only 行为由真实 CLI/E2E 旅程证明。
