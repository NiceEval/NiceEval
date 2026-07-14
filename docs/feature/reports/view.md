# `niceeval view` —— 在浏览器读结果

`niceeval view` 把结果根呈现为本地网页：首页是报告槽，Runs、Traces 和 Attempt 详情组成证据室。它不依赖外部服务；本地模式每次请求重新读取磁盘，静态导出则把当时的结果复制成可托管目录。

## 打开与收窄

```sh
niceeval view
niceeval view weather                  # eval id 前缀，只收窄报告槽
niceeval view --experiment compare/bub
niceeval view --run site-data/run
niceeval view --no-open                # 只打印 URL
niceeval view --report reports/exam.tsx
```

位置参数有两种含义：存在的文件表示只打开这一份 `snapshot.json`；其它字符串表示 eval id 前缀。存在的目录不能作为位置参数，结果根要用 `--run <dir>` 传入。

收窄作用于报告槽的 Selection。证据室始终保留结果根中的完整 attempt 集，因此报告中的 `#/attempt/@<locator>` 深链不会因为首页过滤而失效。

## 页面构成

- **报告槽：** 默认先显示成本 × 通过率散点，再显示 experiment 比较表。比较表由 `ExperimentList` 的 web 面渲染：一行一个 experiment，固定列出实验、模型、Agent、平均耗时、成功率、Tokens、预估成本和结果摘要；表头可排序，表前可按 experiment、agent、model 或 eval 文本过滤。每行可展开查看该 experiment 的 eval 与 attempt 证据。`--report` 用同一份自定义报告文件替换整个槽。
- **Runs：** 把所有 attempt 展成可筛选列表。
- **Traces：** 用 canonical OTel 字段显示执行瀑布图。
- **Attempt 详情：** 判定、断言、统一时间树、结构化错误、按 lifecycle 分组的 diagnostics、usage、对话、trace 和 diff 的入口。时间区以 `result.json.phases` 画主链分解条与收尾段列表,每个 phase 可继续展开 runner 直接观察到的 hook、沙箱命令和 session/turn；turn 带 `traceId` 时再从 `trace.json` 挂接 agent/model/tool spans。因而 `sandbox.setup` 能一路展开到某个 hook 里的 `pnpm install`,`agent.setup` 能看到安装 CLI 与写配置的命令,`eval.run` 能从 `s1/t1` 展开到启动 Agent CLI 的命令和轮内 OTel。失败或被超时中断的最深节点带失败标记；并发或嵌套 children 不相加。独立的 Traces 页仍只画被测 agent 的原始 span,runner 节点不写进 trace；Attempt 时间区只是按显式 correlation 组合两类事实。即使 attempt 在 telemetry 建立前失败、没有 trace,错误、diagnostics 与已发生的 phase/hook/command/turn 时间仍从 `result.json` 正常显示。
- **Copy fix prompt：** 把单条或全部失败整理成可交给 coding agent 的修复 prompt。

## 静态导出

```sh
niceeval view --run site-data/run --out site               # 发布根(copySnapshots 产出):直接导出
niceeval view --out site --allow-sensitive-artifacts       # 本地事实根:必须显式确认
```

`--out` 按数据等级防呆：目标结果根的全部快照带 `publish: { redaction: "applied" }` 标记（[`copySnapshots` 补记](../results/library.md#复制与瘦身copysnapshots)）时直接导出；`redaction: "none"`、无标记结果或本地事实根，都必须显式传 `--allow-sensitive-artifacts`，否则报错并指引先走 `copySnapshots({ redact })`——静态站会原样携带证据文件，上游声明过原文发布也不豁免这里的确认。输出恒为目录：

```text
site/
├── index.html
└── artifact/
    └── <snapshot-and-attempt-path>/
        ├── sources.json
        ├── events.json
        └── trace.json
```

网页会按需 fetch 证据文件，因此不提供“单个 HTML”导出。`diff.json` 可能非常大，`o11y.json` 也不被证据室直接读取，两者不会随 view 静态站复制。

`artifact/` 由与 [`copySnapshots()`](../results/library.md#复制与瘦身copysnapshots) 同一条复制管线产出（同一 50 MiB 预检、同一布局知识）。带 `--allow-sensitive-artifacts` 对本地事实根导出的产物包含**未消毒的原始证据**——prompt、工具参数、完整输出、源码——只适合自己看或可信环境；报告组件的展示层 `redact` 不改变 `artifact/` 下的文件，深链一点开就是原文。要发布给别人，先用 `copySnapshots({ redact, artifacts })` 产出发布根，再对它运行 `view --run <发布根> --out <site>`——数据等级契约见 [Results · 复制与瘦身](../results/library.md#复制与瘦身copysnapshots)。

## 结果版本与错误

扫描整个结果根时，单个不可读快照不会挡住其它结果；页面顶部会列出被跳过的快照及原因。明确指定单个 `snapshot.json` 时，该文件不可读会让命令失败。

| 场景 | 行为 |
|---|---|
| 非 niceeval JSON | 忽略 |
| schemaVersion 不兼容 | 跳过并建议用产出它的 niceeval 版本打开 |
| JSON 损坏或必需字段错误 | 标为 malformed |
| attempt 已写入但缺 `snapshot.json` | 标为 incomplete |
| 单个 attempt 缺可选 artifact | 页面可打开，在该证据位置显示缺失 |

零可读结果时，本地 server 不启动，`--out` 也不会生成空站。读取不会迁移或改写历史结果。

## 自定义首页

```sh
niceeval view --report reports/exam.tsx
```

报告文件同时可被 `niceeval show --report` 使用。官方组件都有 web 和 text 两个渲染面，所以同一份报告在浏览器与终端保持相同数据口径；浏览器宿主额外注入 attempt 深链。写法见 [Library](library.md#交给-show--view-渲染)。

`ExperimentList` 的两个渲染面共享同一份实体与指标数据，但不强求相同排版：web 面使用适合人工横向比较的固定列表格，text 面使用适合终端读取的紧凑列表。两面中的成功率、成本、耗时、Tokens、判定构成和证据引用必须来自同一份计算结果。

## 相关阅读

- [Show](show.md) —— 同一批结果的终端入口。
- [Reports Library](library.md) —— 自定义报告槽。
- [Results](../results/README.md) —— view 读取与导出的数据。
- [Architecture](architecture.md) —— 报告宿主和证据室边界。
