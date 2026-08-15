# Reports CLI

`show`、`view` 与 `view --out` 使用同一条 Record→Sample→Report execution 管线。一次 execution 读取一个 frozen candidate set，形成该 selection 的完整分母与全部 requested projections，然后成为不再访问 Record 的 immutable value。

本机 `view` 可以长期观察输入变化，但每次成功 rebuild 都发布一个新的固定 execution；它不修改旧 execution。

## 共同选择项

```sh
niceeval show [selection] [report options]
niceeval view [selection] [report options]
niceeval view [selection] [report options] --out <directory>
```

| 选项 | 含义 |
|---|---|
| `--record <root>` | 选择实际 Record root；省略时使用 `<cwd>/.niceeval/record`。 |
| `--run <run-id>` | 可重复；使用 explicit analysis selection。 |
| `--experiment <id>` | 可重复；按完整 ExperimentId 收窄不带 locator 或 `--run` 的当前项目目标。 |
| `--report <standard\|overview\|module>` | 选择 0.12 经典标准 Report、Record 诊断概览或受信任的 Report module。省略时先使用项目配置，项目未配置则使用 `standard`。 |
| `--page <route-or-page-id>` | 为人读 `show` 或 `view` 选择一个已经展开的 exact route / page id；不与 `show --json` 合用。 |
| `--port <port>` | `view` 监听端口；默认 4173。 |
| `--host <address>` | `view` 监听地址；省略时为 `127.0.0.1`，只写 `--host` 时等价于 `0.0.0.0`。 |
| `--no-open` | 阻止 `view` 自动打开浏览器。 |

不传 locator 与 `--run` 时，`show` / `view` 规划当前项目身份，并扫描默认 Record 中全部 published Run。只有 Experiment、Eval、attempt ordinal、evaluation kind、input identity 与 config identity 仍匹配当前目标的 slot 才进入 `project-current` Sample。选择不会按时间缩成最后一个 Run，也不会写回 Record。

`project-current` 的 classic facade 用完整 current-declaration profile 填充 metadata，并显示 `metadataOrigin: "current-declaration"`。`--run` 走 explicit-runs：Record 没有 durable profile 时 metadata 是 unknown / partial，experiment id 回退为 id / unknown，并给出一条结构化 notice。两条路径都不读取当前项目声明填充历史数据，也不与当前项目字段混合。

`--experiment` 使用完整 ExperimentId 收窄当前目标，不能与 `--run` 合用。`--run` 可重复，用于审计指定历史 Run；它不要求结果仍匹配当前项目身份。多值 flag 不接受逗号列表。

不存在的 Run、未知 Experiment、未知 route 或尚未展开的参数化 route 都是用法错误。没有结果匹配当前项目时，不带选择项的命令形成空 Sample；它不会拿过期结果补位。

`exp` 与不带 `--record` 的 `show` / `view` 默认使用同一个 `<cwd>/.niceeval/record`。只有主动读取其它 Record root 时才传该选项。旧 Record major 在执行选择或装载 Report 前以 `record-migration-required` 停止，并提示用户运行 `niceeval migrate`。

### selector 与默认 Report

selector 先决定 Sample，默认 Report 再决定要从这个 Sample 读取哪些事实。三条命令使用同一份决议：

| selector | 没有显式 `--report` | 有显式 `--report` |
|---|---|---|
| 不带 selector 的 `project-current` | `niceeval.config.ts` 的 `report`；没有配置时使用 `standard` | 显式 Report |
| 一个或多个 `--run` | 内建 `run-membership-overview` | 显式 Report |
| 精确 `@1<12-character-body>` | 内建 `attempt-overview` | 显式 Report |

`--report overview` 是显式选择通用 `default-overview`，不会改成 `run-membership-overview`。`niceeval.config.ts` 仍是 Theme、source snapshot 与 `view` rebuild 的输入；表中的“内建 Run Report 优先”只表示配置里的 Report 不参与这次默认 Report 决议，不表示命令完全不加载 Config。

`--run` 不是“取最后一次结果”，也不是因为同一命令预计会产生不同答案。Run 是一次固定的 expected-slot 分母与 membership 决定边界；两个 Run 即使引用同一个 immutable Attempt，也可能分别是 `origin`、自动沿用的 `carried`，或人工采用的 `accepted`。因此单个 `--run` 用来回答“这一轮纳入了什么、怎样纳入”，多个 `--run` 用同一表形状比较这些历史边界；已知 Attempt 的业务事实则用 `show @<AttemptLocator>` 下钻。

Run ID 有两个公开取得方式：

- `exp --json` 最后一条 `InvocationReceipt.runIds` 是机器稳定出口；TTY 完成反馈也显示同一批 Run ID。
- `accept` 当前在成功反馈中显示新 Run ID，供操作者复制；它不是 JSON receipt，也不承诺把人读句子作为自动化输入契约。

## `niceeval show`

```sh
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --run 91b07bde-e00a-441b-a4c0-cf78c374204a
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --report ./reports/summary.ts
niceeval show --experiment checkout --page /overview
niceeval show @1K1P0VJAPVJ12
niceeval show --json
```

`show` 构造一次 `ReportExecution`，再从 closed semantic report tree 渲染 terminal text。

项目没有配置 `report` 时，不带选项的 `show` 与 `view` 使用 `standard`：经典 Hero、Sample summary、
Experiment scatter、Experiment table 与详情页面。`overview` 是显式选择的 Record slot 诊断面，
不会作为零配置用户界面回退。`--report standard` 可按次忽略项目自定义 Report，回到内建经典报告。

公开 `show --report` 与 `show --json` 互斥：报告树表达「怎么看」，`--json` 表达「是什么」。两者同时出现时，命令在任何 Record I/O 或报告装载之前以 i18n 用法错误退出。

`show --page` 只选择人读 Report 页面。`niceeval.show` 与 membership JSON 是数据文档，不是 Report 页面树；`show --json --page` 同样在任何 Record I/O 前以用法错误退出。Library `showReport({ format: "json", page })` 仍可收窄低层 `niceeval.report-show/v1`，不等于 CLI 普通 JSON 支持页面筛选。

普通 selector 的 `--json` 输出 `niceeval.show` 数据信封，而不是 classic 报告树。
其中 `view` 区分 leaderboard、attempt、source 与 timing 等数据面。

信封在 view data 之外保留同一次 execution 的 selection、run / slot count、Sample-wide denominator
与 canonical problem table。已有自动化因此可以核对 Run provenance 和完整度，而无需读取 Report 页面树。

显式 `--run` 且没有 `--report` 时，命令选择内建 membership Report，输出同一次 execution 的
`niceeval.report-show/v1`。这个 envelope 也供 live host 与 static export 使用。

### 精确 Attempt 与 execution JSON

`show @<AttemptLocator> --json` 固定输出 `view: "attempt"`；加 `--execution` 后固定输出
`view: "execution"`。两者的 `data` 都是 Calculation 结果，而不是从 terminal 页面或 Record 私有文件
重新拼出的摘要：

```json
{
  "state": "available",
  "inputState": "complete",
  "problemIds": [],
  "value": { "kind": "attempt", "identity": {}, "evaluation": {} }
}
```

成功结果的 `inputState` 是 `complete | partial`；失败结果只保留
`state: "data-unavailable" | "execution-failed"` 与 `problemIds`，不提供 `value`。因此调用方不能把
Calculation 失败误读成空证据。

两种 view 的 value 有以下共同字段：

- `identity` 包含 canonical `locator`、`selectedRunId`、`originRunId`、`slotId` 与 `memberRelation`。
- `evaluation` 保留 Experiment、Eval、attempt ordinal 与 evaluation kind。
- `conversation`、`commands`、`usage`、`timing` 与 `diagnostics` 来自同一个 Attempt。

Attempt view 另外公开 `assertions`、`verdict` 与 `score`。pass evaluation 的 Score 是
`not-applicable`。

每个证据字段都是 `{ state, value? }`。只有 `available` 有 `value`；其它状态保持
`unavailable`、`migration-required`、`migration-unavailable`、`unsupported`、`invalid` 或
`not-applicable`。命令不能用 `null`、零、空数组或 `@unknown` 伪造可用事实。

### Timing JSON

`show @<AttemptLocator> --timing --json` 固定输出 `view: "timing"`。它的 `data` 是
`ShowJsonCalculationData<PublicTimingJson>`，而不是未包装的 timing value。`available` 时，`data` 包含
`inputState`、`problemIds` 与 `value: { kind, locator, durationMs, phases }`；value 内不另建
`status` 或 `reason`。

缺少完整 timing 输入时，`data` 是 `data-unavailable`，人读面显示 `phase timing unavailable`。
Calculation 或 projection 失败时，`data` 是 `execution-failed`，人读面明确显示
`timing calculation/projection failed`。这两种状态都没有 `value`。

已经得到 available timing view、但没有可公开 phase 时，结果仍是 `available`，并使用
`durationMs: null` 与 `phases: []`；人读面显示 `no public phase timing recorded`。它不把这种
空映射说成附件缺失。当前 `niceeval.show` 的 `schemaVersion: 1` 与 Record v1 均不变。

精确 Attempt 必须唯一对齐一个 included Slot 与它在 Evaluation Plan 中的 coordinate；对齐丢失会让
命令失败，而不是猜 identity。`--grep` 只影响 execution 的人读呈现；与 `--json` 合用时不得裁剪上述
机器证据。

Source view 的 text 与 JSON 只公开已选 Attempt 的 canonical locator、Evaluation coordinate 与捕获内容。它不输出 Record path、blob path、`sources.json` 文件名或其它私有布局；source Attachment 不可用时仍保留已知 locator，并返回显式 unavailable。

`show @<AttemptLocator> --source` 使用 `default` source mode。`--source=full` 展开可显示的 project
调用。`--source=<captured-path>` 映射为 `{ mode: "file", file: <captured-path> }`，只显示匹配的
captured source。终端 text 先取 `stdout.columns`，再取 `COLUMNS`，最后用 80 列；这个宽度只影响
text 截断，不进入 Calculation value 或 JSON data envelope。

`--report` 的 text 面与 live view、static export 消费同一份 `ReportExecution`。Host 只显示每个 input 的 complete/partial 与 problem IDs，不替作者公式猜 observed/denominator。通过率等业务统计只有在 Calculation value 自己提供时才显示。unavailable、unsupported、invalid 与 execution-failed 必须保留状态及 problem reference，不能替换成零、空字符串或省略行。

Broken pipe 是正常 CLI 退出，其它 console failure 是 typed error，interruption 保持 Cause。

`show` 完成后退出，不 watch。

### 内建 Run membership 概览

一个或多个 `--run` 在没有显式 `--report` 时使用 `run-membership-overview`。它的固定页面是 `pageId: "run-membership"`、route `/`。页面以 bounded table 对齐 Sample Core、Run-owned membership provenance 与 Attempt Verdict；它不会读取 persisted raw action，也不会把一种事实修正成另一种。

稳定表的 column keys 是：

| key | 值域与含义 |
|---|---|
| `runId` / `slotId` | row identity。单 Run 与多 Run 都按 canonical `runId`、`slotId` 排序。 |
| `slotState` | `included \| not-recorded \| core-invalid \| excluded`。 |
| `memberRelation` | 只有 `included` 才是 `origin \| reference`；否则为 `null`。 |
| `sourceAttemptLocator` | 只有 `included` 才是 canonical `@1<12-character-body>`；否则为 `null`。 |
| `membershipState` | `available \| action-missing \| unavailable \| migration-required \| migration-unavailable \| unsupported \| invalid`。 |
| `membershipOutcome` | `carried \| accepted \| executed \| not-dispatched \| interrupted`；没有可读或匹配 action 时为 `null`。这是公开 projector 的 outcome，不是 persisted payload 的 raw `action` 字段。 |
| `verdictState` | `available \| not-read \| unavailable \| migration-required \| migration-unavailable \| unsupported \| invalid`。非 `included` slot 是 `not-read`。 |
| `verdict` | `passed \| failed \| errored \| skipped`；没有可读 Verdict 时为 `null`。 |

Membership Attachment 可读、但没有匹配这个 `slotId` 的 action 时显示 `action-missing`。不对应任何 Sample slot 的额外 action 计入确定性的 unmatched count。Attachment 的非 available 状态保持原值，schema、migration 或 issue 详情继续出现在页面与 host problem table；Report 不从 Core 猜 provenance，也不从 provenance 猜 Verdict。

表在 canonical 排序后最多显示 200 rows，并明确显示 omitted count。它是快速检查 Run membership 的 bounded summary，不承诺任意规模 Run 的穷尽查询；需要不同字段或更大切片时显式选择自定义 Report，并仍受 Report host limits 约束。自定义 Report 只继承 selection 与 `niceeval.report-show/v1` envelope，不继承上面的内建表契约。

人读输出示例：

```text
Report run-membership-overview
Sample: 1 run(s), 1 slot(s)

Page /
  Run membership overview
  Run membership
  Run | Slot | Slot state | Member relation | Source Attempt | Membership state | Membership outcome | Verdict state | Verdict
  7b8d2ea4-b840-4870-9840-f85a436a5527 | slot-00b400bd-ba81-4850-8803-09ba802896e5 | included | reference | @1K1P0VJAPVJ12 | available | accepted | available | passed
  [neutral] Omitted rows: 0
  [neutral] Unmatched membership actions: 0

Problems
  none
```

同一次 execution 的 `--json` 外层仍是 `niceeval.report-show/v1`。下列是 `pages[0].document` 中稳定审计表的相关子树；文案、section 顺序和其它节点可以增加或调整：

```json
{
  "caption": "Run membership",
  "columns": [
    { "key": "runId", "label": "Run" },
    { "key": "slotId", "label": "Slot" },
    { "key": "slotState", "label": "Slot state" },
    { "key": "memberRelation", "label": "Member relation" },
    { "key": "sourceAttemptLocator", "label": "Source Attempt" },
    { "key": "membershipState", "label": "Membership state" },
    { "key": "membershipOutcome", "label": "Membership outcome" },
    { "key": "verdictState", "label": "Verdict state" },
    { "key": "verdict", "label": "Verdict" }
  ],
  "rows": [
    {
      "memberRelation": "reference",
      "membershipOutcome": "accepted",
      "membershipState": "available",
      "runId": "7b8d2ea4-b840-4870-9840-f85a436a5527",
      "slotId": "slot-00b400bd-ba81-4850-8803-09ba802896e5",
      "slotState": "included",
      "sourceAttemptLocator": "@1K1P0VJAPVJ12",
      "verdict": "passed",
      "verdictState": "available"
    }
  ],
  "type": "table"
}
```

## `niceeval view`

```sh
niceeval view --report ./reports/summary.ts --port 4400
niceeval view --host 192.168.0.199
niceeval view --host # 显式监听全部 IPv4 接口
niceeval view --run 01H... --page /attempts/attempt-01h... --no-open
```

`view` 打开一个 scoped `ReportViewSession`。每个成功 revision 都是 host 私有的
`ViewRevisionClosure`，其中有来自同一份 frozen selection、Report、Config 与 Theme closure 的英语和简体中文 execution。classic 固定 sample pages 按作者声明顺序形成唯一 tablist；tab 的稳定 identity、标题、exact route 与导航可见性来自所选 locale 的 `ReportExecution`，不能从 page ID、route 排序或页面 DOM 反推。PageFamily 不进入 tablist，只提供已经闭合的详情 route。

完全省略 `--host` 时，server 只监听 `127.0.0.1`。显式地址交给 Node 绑定；具体 hostname / IP
只公布该地址，`0.0.0.0` 会公布 `127.0.0.1` 与启动时可见的非 internal IPv4 地址，`::` 则公布
`[::1]` 与可直接序列化的非 internal IPv6 地址。`--page` 应用到全部公布 URL，但自动打开浏览器只使用第一条。

非 loopback 监听是显式的网络暴露：它没有认证或 TLS，所有网络可达客户端都能读取报告、execution JSON 与
downloads。CLI 每次成功启动这种 listener 都在 stderr 警告；使用者必须自行保证网络可信。HTTP host 只接受本次
公布的 authority；只服务 `GET` / `HEAD`，其它 method 返回 `405`。这些限制不授权未来写端点；任何写端点都必须
重新设计认证与 CSRF 边界。

Record canonical ID 不能直接拼 route：Report 作者必须用 `reportInstanceKeyFromRecordId` 与 `reportRouteFromKeys` 形成 lowercase、domain-tagged route。CLI 中的 `attempt-01h...` 是 adapter 输出；Record 详情与页面正文仍显示原 uppercase `AttemptId`。

终端 Experiment Table 为了不让完整 `@AttemptId` 撑宽整张表，只显示带省略号的定宽标签；这是呈现摘要，不是可输入的 prefix locator。详情页、链接目标与需要复制的命令输入仍使用完整 `@AttemptId`。

### Classic 页面与语言

页面顶部由 package-owned NiceEval 品牌 chrome 和英语、简体中文语言控件组成。控件从当前
`ViewRevisionClosure` 选择对应 locale 的完整 document，并在同一 route 上原子切换页面标题和正文；它不改变
Sample、业务数值、详情 target 或 selection。
live 语言点击按最后一次点击获胜。后一次点击会作废仍在途中的 fragment 响应。
即使这次点击回到已经提交的语言，前一次响应也不得写入页面。
请求失败时保留上次成功提交的语言、URL、tab、焦点、disclosure 与筛选。

Hero 显示作者声明的 logo、标题、说明与外链。页面随后显示 Sample metadata、coverage、问题状态和主读数，
再以 `Bars`、`ExperimentScatter` 与 `ExperimentTable` 呈现相同的闭合业务数据。具名 Bars series 以与柱体
纹理、颜色一致的可访问图例出现。文字与表格必须承载图形
表达的数值、状态和实体关系。

`ExperimentTable` 的筛选只检查已渲染 hierarchy 的可见文本。匹配的行及其祖先留下；清空条件立即恢复完整
已渲染 hierarchy。没有匹配项时页面提供可访问的空结果。筛选不会修改 selection、Report execution、route
或 Record 读取。禁用 JavaScript 时筛选不会隐藏任何行，完整 hierarchy、原生 disclosure 与 href 保持可用。

窄屏按 chrome、Hero、metadata、读数、图形和表格的阅读顺序排布；主读数保持两列卡片，
横向 Bars 的标签、柱体与数值仍在同一行，其余主要区块单列展开。页面不能横向溢出；宽表只在自己的可访问滚动区域内横向滚动。

每个成功 revision 固定包含 Report / Config / Theme source snapshot、core-only `AnalysisSample`，以及同构的英语和简体中文 `ReportExecution`。
当没有可渲染的作者页面时，根 route 仍以同一套双语 semantic document 显示 Report problems；host 不得另建 text-only fallback。

watch 闭集是 Record root、Report module 及其项目内静态 import、Theme module 与 `niceeval.config.ts`。loader 与 watcher 的具体实现属于 Node host，本契约只声明行为：

- 每次 rebuild 在同一份 frozen inputs 上产生英语和简体中文 execution；
- 两份 execution 同构且完整成功后才替换 current revision，并显示新结果；
- 失败保留 last-good revision，并显示 bounded rebuild problem；
- 两种 locale 的 execution 与 built-in problems surface 都能形成时，才是成功 revision。Recorded data problem，或已隔离的 projector / author / tree / route execution problem，会发布新 revision 并显式显示；
- module / config / theme 无法 load、Record / selection global typed error、limit 或 execution envelope 无法形成时，保留 last-good 并产生 bounded rebuild summary。

HTTP request、页面打开、刷新、语言切换、筛选、tab、disclosure 与 dialog 不触发作者 callback 或新的 Record I/O。Record、Report 或影响选择的 Config 变化产生新的 execution；Theme-only 变化可以复用同一组 immutable execution，再发布新的 view revision。

web renderer 与 `show` 从同一棵 semantic tree 读取。图表、颜色与交互只能增强已有文字、表格、数值和状态，不能改变分母或发起新的 Attachment 读取。

Experiment Table 的 Experiment → group/eval → Attempt 父子拓扑也属于这棵 semantic tree。live 与 static 都输出原生、可聚焦的 disclosure；禁用 JavaScript 的 static 页面仍可用键盘展开。实体 target 只有在对应 PageFamily route 已进入当前 execution closure 时才成为普通 href，否则退化为纯展示，不生成死链接或 `#/attempt/...`。

live 中，tabs 与详情 dialog 是 package-owned progressive enhancement。点击 Experiment / Attempt 的 canonical href 时，dialog 呈现同一 revision、同一路由经唯一 web renderer 生成的文档；关闭后焦点、tab 与 disclosure 上下文恢复。直接请求、新标签页和 static export 继续沿相同 href 导航。rebuild 竞争不得把两个 revision 的触发页与详情混合。

## `niceeval view --out`

```sh
niceeval view --report ./reports/summary.ts --out ./report-site
niceeval view --run 01H... --out ./shared-site --no-open
```

`--out` 不启动 watcher 或长期 server。它在同一份 frozen inputs 上构造英语和简体中文 execution，验证同构后形成固定 `ViewRevisionClosure`，穷尽全部 PageFamily instances、routes、downloads 与 semantic trees，再导出自包含静态站。

export 只写这个 closure 的既有结果、当前 host-data、downloads、manifest 与内建精确 runtime。每条 ordinary canonical route 只生成一份英语 HTML；它是无 JavaScript 时的完整页面。runtime 只在原 route 切换到 closure 中的简体中文完整 document，并同步切换页面标题和正文；不生成 locale route 或复制 canonical 页面。

Report module 不能注入任意 script、style、font、worker、WASM、DOM 或文件 path。Hero 外链是唯一 URL 输入，只接受绝对 https；export 只把 href 序列化进页面，不 fetch，站内核心内容不依赖任何 URL 才能显示。

执行顺序：

1. preflight execution problems、semantic tree、route、download、limits 与 closure；任一 execution problem 整体不发布；
2. 向目标目录写出 HTML、host-data、downloads、manifest 与 built-in runtime；
3. 全部文件写出后，最后写入零字节 `complete` marker，再 sync 目录。

目标已存在返回 `report-export-target-exists`，不删除或替换既有内容。中断或失败可能留下没有 marker 的目录；host 提示用户删除后重试。本契约不承诺原子目录发布。

生成站点可在断网、禁 JavaScript 的浏览器中打开。浏览器只读取目录内的站点文件，不读取源 Record，也不要求之后安装 NiceEval。Recorded data problems 会成功导出并出现在不可关闭的 host problems 页面；即使所有作者页面都 data-unavailable，根页仍使用同一套双语 semantic document。

## Attachment 与 consumer 反馈

| 情况 | `show` | `view` | `--out` |
|---|---|---|---|
| 未请求的坏 Attachment | 不读取、不影响。 | 不读取、不影响。 | 不读取、不影响。 |
| requested `unavailable` | 显示不可用。 | 对应 consumer + problems surface 显示。 | 成功导出并显式显示。 |
| requested `migration-required` | 提示运行 `niceeval migrate`。 | 对应 consumer + problems surface 显示迁移提示。 | 成功导出并显式显示迁移提示。 |
| requested `migration-unavailable` | 只显示原因，不提示迁移命令。 | 对应 consumer + problems surface 显示原因。 | 成功导出并显式显示原因。 |
| requested `unsupported` | 显示 schema issue。 | 对应 consumer + problems surface 显示。 | 成功导出并显式显示。 |
| requested `invalid` | 按 completeness 形成 data-unavailable 或局部结果。 | 发布新 revision并显示问题。 | 成功导出并显式显示。 |
| consumer/projector defect | 显示 execution-failed。 | 发布新 revision、局部显示并保留其它页面。 | 整体不发布。 |
| rebuild failure | 不适用。 | 保留最后一个成功 revision。 | 不适用。 |

`migration-required` 与 `migration-unavailable` 在呈现中不能混淆：只有前者提示运行 `niceeval migrate`；后者表示明确没有无损 converter，只呈现 reason，不能反复提示迁移命令。

命令只把当前 Report definition 声明的 inputs 视为依赖。动态 PageFamily 可以按这些已经形成的 typed values 展开 routes，但不能追加 I/O。

## 相关阅读

- [Reports README](README.md)：范围与心智模型。
- [Architecture](architecture.md)：静态数据依赖、热重载与 semantic tree。
- [Library](library.md)：作者 DSL、Effect API 与错误。
- [Use case](use-case/README.md)：常见任务路径。
