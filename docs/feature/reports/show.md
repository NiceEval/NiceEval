# `niceeval show` —— 在终端读结果

`niceeval show` 不运行 eval，只读取记录根。它适合在 shell 或 coding agent 循环里快速回答三个问题：哪一题失败、失败的实际值是什么、下一步该看哪份证据。

## 一次调用 = 范围 × 切片 × 形态

show 的输入沿三条正交轴组合。三条轴各自独立取值，组合语义由各轴自己的规则决定，不为特定组合发明特例命令：

- **范围**选出一批 attempt。eval id 前缀位置参数、`@<locator>` 位置参数、`--exp`（可重复）、`--fresh` 与 `--record` 都是范围输入；`@<locator>` 是恰好命中一个 attempt 的最小范围，不是某些切片的专属入口。
- **切片**选择装配哪个报告组件：每个切片解析为一次报告组件的装配（[「show 的切片是组件选择」](architecture.md#show-的切片是组件选择)）。缺省切片按范围形态选择（规则见下）：[默认报告](show/default-report.md) 装配内建报告首页，[对照矩阵](show/compare.md) 装配 `sources.measure.delta`，[失败诊断首页](show/attempt.md) 装配 `AttemptDetail`；显式 flag 里 [`--source`](show/eval-source.md)、[`--execution`](show/execution.md)、[`--timing`](show/timing.md)、[`--diff`](show/diff.md) 各装配 attempt-detail 组件族的一处区块，[`--usage`](show/usage.md) 装配 `AttemptUsage`，[`--stats`](show/stats.md) 装配 `sources.measure.stability`；[`--history`](show/history.md) 直接投影 Record evidence，不经组件模型。**每个切片接受任意范围**：范围含多个 attempt 时，宿主机器把同一组件逐 attempt 分节映射，节头带 locator——分节是宿主机器，节内内容仍由组件拥有；单 attempt 范围只是省掉了分节。
- **形态**选择输出给谁：缺省 text 面给人和终端里的 agent；[`--json`](show/json.md) 把同一范围、同一切片选出的实体输出成结构化文档给脚本。两个形态消费同一套选择、去重与聚合规则，共有派生字段同值；JSON 可保留 text 注意力预算省略的字段，是数据超集。

```sh
niceeval show                              # 默认报告首页：默认报告 + 尾部页索引
niceeval show memory/swelancer             # 按 eval id 前缀收窄
niceeval show @1qrdcfq8                    # 打开一个 attempt 的诊断首页
niceeval show @1qrdcfq8 --report reports/site.tsx
                                             # 渲染自定义 attempt-input page 的 text 面
niceeval show @1qrdcfq8 --source           # 断言标回 eval 源码
niceeval show @1qrdcfq8 --execution        # 对话与工具调用；可关联时附 OTel 时间
niceeval show @1qrdcfq8 --execution --expand t2.c3
                                             # 展开一张被截断的执行卡片
niceeval show @1qrdcfq8 --timing           # 有界诊断时间树：生命周期、hook、命令、轮次与 OTel
niceeval show @1qrdcfq8 --timing=full      # 逐节点展开同一棵完整时间树
niceeval show @1qrdcfq8 --diff             # workspace 改动摘要
niceeval show @1qrdcfq8 --diff=path/to.ts  # 某个文件的完整 diff
niceeval show memory/swelancer --history   # 这个 eval 的真实执行历史
niceeval show --stats                      # eval × experiment 稳定性矩阵:哪几道题从来没通过过
niceeval show --exp dev-e2b --usage        # 范围内逐 attempt 的用量表
niceeval show --exp dev-e2b --execution --grep 'memory search'
                                             # 跨 attempt 扫描执行事件
niceeval show --exp memory/claude-baseline --exp memory/claude-mempal
                                             # 两个条件的逐 eval 对照矩阵
niceeval show --exp dev-e2b --usage --json # 同一范围的结构化数据超集
```

默认报告中的 `@<locator>` 是 attempt 的稳定引用。它必须带 `@`，既不是数组下标也不是文件路径。把 locator 复制给后续命令，便可从汇总数字回到同一次执行的证据。

## 缺省切片的选择规则

不带任何证据 flag 时，缺省切片按范围形态选择，三种输出各有分篇：

| 范围 | 缺省切片 |
|---|---|
| 单个 `@<locator>` | [失败诊断首页](show/attempt.md) |
| `--exp` 出现两次以上 | [对照矩阵](show/compare.md)：逐 eval 一行、逐条件一组列、翻转标记与基准差值 |
| 其余（裸 show、eval 前缀、单个 `--exp`） | [默认报告](show/default-report.md) |

## 按任务读分篇

| 任务 | 页面 |
|---|---|
| 读裸 `show` 的默认比较、Result 摘要口径 | [默认报告的 text 面](show/default-report.md) |
| 同批 eval 在多个条件下逐题对照、找翻转 | [对照矩阵](show/compare.md) |
| 从 locator 打开失败诊断首页（含 errored 的基础设施错误） | [失败诊断首页](show/attempt.md) |
| 把断言与轮次标回 eval 源码 | [`--source`](show/eval-source.md) |
| 看 agent 每轮说了什么、调了什么工具；跨 attempt 扫描事件 | [`--execution`](show/execution.md) |
| 分析整个 attempt 的时间花在哪 | [`--timing`](show/timing.md) |
| 看 token 拆分、轮数、工具调用数与成本 | [`--usage`](show/usage.md) |
| 核对 agent 实际改了哪些文件 | [`--diff`](show/diff.md) |
| 看一道题历次执行的时间轴 | [`--history`](show/history.md) |
| 找从来没通过过的题、区分环境错误与判定失败 | [`--stats`](show/stats.md) |
| 把任意视图喂给脚本 | [`--json`](show/json.md) |
| 渲染自定义报告：单页、多页与 `--page` 的操作步骤 | [`--report` 的单页与多页](show/reports.md) |

## 选择结果范围

```sh
niceeval show --record tmp/published-results
niceeval show --exp dev-e2b           # experiment id 路径前缀
niceeval show --exp dev-e2b/codex-e2b
niceeval show memory/swelancer --exp dev-e2b/codex-e2b
niceeval show --fresh                 # 只统计最新一次运行实测的 attempt
niceeval show --report reports/exam.tsx
niceeval show --report reports/site.tsx --page exam
niceeval show --report standard        # 内建视图名，回到默认报告
```

`--record` 改变记录根；`--exp` 按 experiment id 路径段匹配，eval id 位置参数按裸前缀过滤。`--fresh` 把口径收窄成只含新执行的 attempt——排除携带条目与跨 Run 拼入的历史执行，被排除的题按覆盖事实转为覆盖占位行，不静默消失（语义见 [Record · 时效](../sample/library.md#时效新执行与历史执行)）。`--fresh` 与其它范围输入作用于所有切片与两个形态，不是默认报告专属。

`--exp` 出现两次以上时进入对照语义：每个 `--exp` 是一个对照条件，必须恰好解析到一个 experiment；某个 `--exp` 前缀匹配到多个 experiment 时按用法错误退出并列出全部候选 id，不猜测意图（契约见[对照矩阵](show/compare.md)）。`@<locator>` 位置参数与重复 `--exp` 互斥——locator 已经唯一确定了 experiment，再给对照条件没有可执行的语义。

`--report <名字|文件>` 替换整份 pages。值按形态判别：含 `/`、以 `.` 开头或带 `.ts` / `.tsx` / `.js` / `.mjs` 后缀的当报告文件路径，其余裸词查[内建视图名](library/built-in.md)（当前只有 `standard`），裸词未命中就列出可用名字并提示文件要写成 `./reports/site.tsx`。不带 `--report` 时装载项目配置的 `report` 字段，没配则装载内建 `standard`（[三档取值链](README.md#项目默认报告)）。

无证据 flag 的 `show @<locator> --report <file>` 选择其中唯一的 attempt-input page，注入 locator 对应的 evidence 并渲染 text 面；`--source`、`--execution`、`--timing`、`--usage`、`--diff` 仍各自装配对应的报告组件区块并渲染其 text 面，不经 `--report` 传入的 page 声明（[组件归属](architecture.md#show-的切片是组件选择)）。`--report` 与 `--json` 互斥：报告树表达「怎么看」，`--json` 输出「是什么」；要自定义结构，先 `--json` 拿事实再自己加工，或直接消费 [`niceeval/record` 读取面](../record/library.md)。

## 无匹配与不可读结果

漏写 locator 的 `@` 时，输入按 eval id 前缀处理并明确报无匹配，不做模糊猜测：

```text
$ niceeval show 1qrdcfq8
No results matched: 1qrdcfq8. Evals with results: memory/agent-037-updatetag-cache, memory/swelancer-manager-proposals
```

扫描记录根时，可读 Run 照常参与报告；未完成、损坏或 schema 不兼容的 Run 会列出原因。完全没有可读结果时命令非零退出，并对带 `producer.version` 的旧格式给出对应版本的 `npx niceeval@<version> show --record <root>` 建议。

## 相关阅读

- [Reports Library](library.md) —— `--report` 文件怎样写。
- [Record](../record/README.md) —— show 读取的文件和 artifact。
- [Agent 反馈闭环](../../../docs-site/zh/tutorials/agent-feedback-loop.mdx) —— 在 AI 自迭代中组合这些命令。
