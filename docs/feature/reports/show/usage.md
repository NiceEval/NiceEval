# `--usage`：`AttemptUsage` 在 show 的装配

`--usage` 把范围内每个 attempt 的 [`AttemptUsage`](../components/attempt-detail/attempt-usage.md#组装口径单源) 逐条映射成一行，摊开判定、轮数、工具调用数、token 拆分与成本。效率归因（「为什么这个条件更贵」）的最小证据面就是这张表，不需要逐个打开 attempt。

## 组装口径

行为计数、token/请求来源、token 拆分片段的显示规则与缺失省略规则，是 `AttemptUsage` 组件本身的契约，单源声明在 [`AttemptUsage` 组装口径（单源）](../components/attempt-detail/attempt-usage.md#组装口径单源)——`--usage` 表的每一行、attempt 详情首页的 `usage:` 行、对照矩阵的用量列、`--execution` turn 头行，全部读同一份口径，不在各自的分篇里重复声明或衍生第二套数字。

`--usage` 表在这份组件口径之上追加的是宿主装配：多个 attempt 的行怎么排、怎么分节、合计行怎么算、缺失怎么占位——这些属于 show 的机器，不是组件内容，声明在下面。

## 范围化的用量表

```sh
$ niceeval show --exp dev-e2b/codex-e2b --usage
用量 · dev-e2b/codex-e2b · 6 个 attempt

locator      eval                                 结果    turns   tools   uncached in   cache read     out    requests   成本
@160iuj3h    memory/agent-037-updatetag-cache     ✓ 通过      4       9         48.2k       201.5k    5.1k         13   $0.09
@1sxmo0m1    memory/repomod-hello-world-api       ✓ 通过     11      28        122.9k       1.98M    12.4k         39   $0.57
@1qrdcfq8    memory/swelancer-manager-proposals   ✗ 失败      2       3         13.9k        38.2k    6.4k          9   $0.05
@1pcdj0az    memory/terminal-cancel-async-tasks   ✓ 通过      6      14         71.0k       513.7k    8.0k         20   $0.13
@13wrnsc4    memory/terminal-pypi-server          ✗ 失败      7      19         88.3k       690.1k    9.2k         26   $0.19
@18etnsw5    memory/tool-call-observability       ✓ 通过      1       2          6.1k        11.0k    1.8k          3   $0.02

合计                                              4/6 通过    31      75        350.4k       3.43M    42.9k        110   $1.05
```

- 行按 experimentId、evalId、attempt 序排列；范围含多个 experiment 时逐 experiment 分节，节尾各自合计。
- 缺失字段的格显示 `—`，且不计入合计——缺 usage 不按零聚合，与[证据完整性](../../adapters/architecture/evidence.md)同一条纪律；合计行有任何 `—` 参与的列在数值后标 `*`，表示合计不完整。
- 对照范围（重复 `--exp`）下，`--usage` 输出逐 eval 的用量矩阵：每条件一组列，配对与占位规则同[对照矩阵](compare.md)。
- `--json` 输出同一批 `AttemptSnapshot` 的结构化数组，信封与指针见 [`--json`](json.md)；逐字段形状不在这里重复声明。

## 相关阅读

- [Attempt 详情组件 · `AttemptUsage` 组装口径（单源）](../components/attempt-detail/attempt-usage.md#组装口径单源) —— 组装口径与 `AttemptSnapshot` 形状的单源。
- [Record · Usage 与 facts](../../record/architecture.md#usage) —— 落盘字段的家。
- [失败诊断首页](attempt.md) —— 单 attempt 的 `usage:` 行。
- [对照矩阵](compare.md) —— 条件间的用量差。
