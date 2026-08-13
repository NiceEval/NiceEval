# Eval 选择 —— CLI

`niceeval exp` 只用位置参数选择 Experiment。
Eval 范围使用具名、可重复的 flags，因此不提供 Experiment selector 时也能对全部 Experiment 收窄。

```sh
niceeval exp [experiment-selector] \
  [--eval <exact-id>]... \
  [--eval-prefix <raw-prefix>]... \
  [--tag <required-tag>]... \
  [--exclude-tag <forbidden-tag>]...
```

## Flags

| flag | 语义 | 重复时 |
|---|---|---|
| `--eval <id>` | 精确匹配一个 Eval ID | 与其它精确 ID 取 OR |
| `--eval-prefix <prefix>` | 按 Eval ID 的原始 `startsWith` 匹配 | 与其它前缀取 OR |
| `--tag <tag>` | 要求每条结果携带该 tag | 多个正 tag 取 AND |
| `--exclude-tag <tag>` | 排除携带该 tag 的 Eval | 多个负 tag 共同排除 |

`--eval` 与 `--eval-prefix` 同属身份轴，二者之间取 OR。
身份轴、正 tag 和负 tag 三部分取 AND；重复的相同值按一项处理。

以下命令精确选择 `algebra`，不会带上 `algebra2`：

```sh
niceeval exp compare/codex --eval algebra
```

以下命令在全部 Experiment 中保留 `memory/` 家族；每个 Experiment 再与自己的静态 `evals` 相交：

```sh
niceeval exp --eval-prefix memory/
```

位置参数最多一个。
多余位置参数是用法错误，反馈把第一个多余值改写成可执行的 `--eval-prefix <value>` 示例。

## Experiment 被临时过滤为空

每个被位置参数选中的 Experiment 都必须先通过自己的静态 `evals` 校验。
CLI 条件随后逐 Experiment 求交集；某个交集为空时，该 Experiment 不创建 Run、不执行 `setup` / `teardown`，也不进入 Session。

只要至少一个 Experiment 仍有 Eval，Invocation 就继续。
Human 的 dry 与运行起始反馈都列出被排除的 Experiment，并显示原因 `CLI Eval selection matched no evals`。

全部 Experiment 都被过滤为空时，命令在 stderr 报用法错误并以非零退出。
它不创建 Session、Run 或任何 Sandbox 资源，并提示放宽对应的 Eval flag 或先运行 `--dry`。

## 机器反馈

`--dry --json` 的计划文档包含被排除的 Experiment：

```ts
interface ExcludedExperiment {
  readonly experimentId: string;
  readonly reason: "cli_eval_selection_empty";
}

interface ExpPlanDocument {
  // 其它计划字段保持原契约。
  readonly excludedExperiments: readonly ExcludedExperiment[];
}
```

正常 `--json` NDJSON 流在计划开始前为每个被排除项追加一条事件：

```ts
interface ExperimentExcludedEvent {
  readonly type: "experiment_excluded";
  readonly experimentId: string;
  readonly reason: "cli_eval_selection_empty";
}
```

全部为空属于启动期用法错误，不产生成功形态的计划或 Session 事件。

## 命令组合

| 命令 | 临时 Eval flags | 行为 |
|---|---|---|
| `niceeval exp …` | 接受 | 运行求交后的范围 |
| `niceeval exp … --dry` | 接受 | 预览同一范围与排除项 |
| `niceeval exp list` | 拒绝 | 只展示每个 Experiment 的静态集合 |
| `niceeval exp … --teardown` | 拒绝 | 收尾不选择 Eval |
| `niceeval check [experiment-selector]` | 拒绝 | 校验所选 Experiment 的静态选择与完整 link |

不接受临时 flags 的组合在启动期报错，并指出应改用 `niceeval exp [experiment-selector] --dry`。

## 条件错误

每个 CLI 精确 ID 和前缀都必须在所选 Experiment 的静态集合并集中命中。
每个正 tag 必须在 CLI 身份候选中出现；每个负 tag 必须在应用正 tag 后的候选中出现。
任一重复 flag 的值无效时，整条命令报错，不能由其它命中值掩盖。

多个负 tag 可以命中同一条 Eval。
逐 Experiment 的最终交集允许为空，并使用前述排除反馈；全部最终交集为空才使 Invocation 失败。
