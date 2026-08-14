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
| `--page <route>` | 选择一个已经展开的 exact route。 |
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
| 不带 selector 的 `project-current` | `niceeval.config.ts` 的 `report`；没有配置时使用 `default-overview` | 显式 Report |
| 一个或多个 `--run` | 内建 `run-membership-overview` | 显式 Report |
| 精确 `@<AttemptId>` | 内建 `attempt-overview` | 显式 Report |

`--report overview` 是显式选择通用 `default-overview`，不会改成 `run-membership-overview`。`niceeval.config.ts` 仍是 Theme、source snapshot 与 `view` rebuild 的输入；表中的“内建 Run Report 优先”只表示配置里的 Report 不参与这次默认 Report 决议，不表示命令完全不加载 Config。

`--run` 不是“取最后一次结果”，也不是因为同一命令预计会产生不同答案。Run 是一次固定的 expected-slot 分母与 membership 决定边界；两个 Run 即使引用同一个 immutable Attempt，也可能分别是 `origin`、自动沿用的 `carried`，或人工采用的 `accepted`。因此单个 `--run` 用来回答“这一轮纳入了什么、怎样纳入”，多个 `--run` 用同一表形状比较这些历史边界；已知 Attempt 的业务事实则用 `show @<AttemptId>` 下钻。

Run ID 有两个公开取得方式：

- `exp --json` 最后一条 `InvocationReceipt.runIds` 是机器稳定出口；TTY 完成反馈也显示同一批 Run ID。
- `accept` 当前在成功反馈中显示新 Run ID，供操作者复制；它不是 JSON receipt，也不承诺把人读句子作为自动化输入契约。

## `niceeval show`

```sh
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --run 91b07bde-e00a-441b-a4c0-cf78c374204a
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --report ./reports/summary.ts
niceeval show --experiment checkout --page /overview
niceeval show @91ddc61b-ae96-4a23-8578-ddc1b83306dc
niceeval show --json
```

`show` 构造一次 `ReportExecution`，再从 closed semantic report tree 渲染 terminal text。

项目没有配置 `report` 时，不带选项的 `show` 与 `view` 使用 `standard`：经典 Hero、Sample summary、
Experiment scatter、Experiment table 与详情页面。`overview` 是显式选择的 Record slot 诊断面，
不会作为零配置用户界面回退。`--report standard` 可按次忽略项目自定义 Report，回到内建经典报告。

公开 `show --report` 与 `show --json` 互斥：报告树表达「怎么看」，`--json` 表达「是什么」。两者同时出现时，命令在任何 Record I/O 或报告装载之前以 i18n 用法错误退出。

`--json` 单独使用时输出 `niceeval.show` 数据信封（`view` 为 leaderboard / attempt / source / timing 等），而不是 classic 报告树。公开 show 的机器面只有 `niceeval.show`；`niceeval.report-show/v1` 只给内部 host 与 static export 使用。

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
| `sourceAttemptLocator` | 只有 `included` 才是 `@<AttemptId>`；否则为 `null`。 |
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
  7b8d2ea4-b840-4870-9840-f85a436a5527 | slot-00b400bd-ba81-4850-8803-09ba802896e5 | included | reference | @91ddc61b-ae96-4a23-8578-ddc1b83306dc | available | accepted | available | passed
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
      "sourceAttemptLocator": "@91ddc61b-ae96-4a23-8578-ddc1b83306dc",
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

`view` 打开一个 scoped `ReportViewSession`。导航只列出当前成功 revision 已经展开的 routes。

完全省略 `--host` 时，server 只监听 `127.0.0.1`。显式地址交给 Node 绑定；具体 hostname / IP
只公布该地址，`0.0.0.0` 会公布 `127.0.0.1` 与启动时可见的非 internal IPv4 地址，`::` 则公布
`[::1]` 与可直接序列化的非 internal IPv6 地址。`--page` 应用到全部公布 URL，但自动打开浏览器只使用第一条。

非 loopback 监听是显式的网络暴露：它没有认证或 TLS，所有网络可达客户端都能读取报告、execution JSON 与
downloads。CLI 每次成功启动这种 listener 都在 stderr 警告；使用者必须自行保证网络可信。HTTP host 只接受本次
公布的 authority；只服务 `GET` / `HEAD`，其它 method 返回 `405`。这些限制不授权未来写端点；任何写端点都必须
重新设计认证与 CSRF 边界。

Record canonical ID 不能直接拼 route：Report 作者必须用 `reportInstanceKeyFromRecordId` 与 `reportRouteFromKeys` 形成 lowercase、domain-tagged route。CLI 中的 `attempt-01h...` 是 adapter 输出；Record 详情与页面正文仍显示原 uppercase `AttemptId`。

终端 Experiment Table 为了不让完整 `@AttemptId` 撑宽整张表，只显示带省略号的定宽标签；这是呈现摘要，不是可输入的 prefix locator。详情页、链接目标与需要复制的命令输入仍使用完整 `@AttemptId`。

每个成功 revision 固定包含 Report / Config / Theme source snapshot、core-only `AnalysisSample` 与一个 immutable `ReportExecution`。

watch 闭集是 Record root、Report module 及其项目内静态 import、Theme module 与 `niceeval.config.ts`。loader 与 watcher 的具体实现属于 Node host，本契约只声明行为：

- 每次 rebuild 产生一份新的 fixed `ReportExecution`；
- 完整成功后才替换 current revision，并显示新结果；
- 失败保留 last-good execution，并显示 bounded rebuild problem；
- 能形成 exact `ReportExecution` + built-in problems surface 就是成功 revision。Recorded data problem，或已隔离的 projector / author / tree / route execution problem，会发布新 revision 并显式显示；
- module / config / theme 无法 load、Record / selection global typed error、limit 或 execution envelope 无法形成时，保留 last-good 并产生 bounded rebuild summary。

HTTP request、页面打开与刷新不触发新的 Record I/O。Record、Report 或影响选择的 Config 变化产生新的 execution；Theme-only 变化可以复用同一个 immutable execution，再发布新的 view revision。

web renderer 与 `show` 从同一棵 semantic tree 读取。图表、颜色与交互只能增强已有文字、表格、数值和状态，不能改变分母或发起新的 Attachment 读取。

## `niceeval view --out`

```sh
niceeval view --report ./reports/summary.ts --out ./report-site
niceeval view --run 01H... --out ./shared-site --no-open
```

`--out` 不启动 watcher 或长期 server。它构造一个固定 `ReportExecution`，穷尽全部 PageFamily instances、routes、downloads 与 semantic trees，再导出自包含静态站。

export 只写这个 execution 的既有结果、当前 host-data、downloads、manifest 与内建精确 runtime。Report module 不能注入任意 script、style、font、worker、WASM、DOM 或文件 path。Hero 外链是唯一 URL 输入，只接受绝对 https；export 只把 href 序列化进页面，不 fetch，站内核心内容不依赖任何 URL 才能显示。

执行顺序：

1. preflight execution problems、semantic tree、route、download、limits 与 closure；任一 execution problem 整体不发布；
2. 向目标目录写出 HTML、host-data、downloads、manifest 与 built-in runtime；
3. 全部文件写出后，最后写入零字节 `complete` marker，再 sync 目录。

目标已存在返回 `report-export-target-exists`，不删除或替换既有内容。中断或失败可能留下没有 marker 的目录；host 提示用户删除后重试。本契约不承诺原子目录发布。

生成站点可在断网、禁 JavaScript 的浏览器中打开。浏览器只读取目录内的站点文件，不读取源 Record，也不要求之后安装 NiceEval。Recorded data problems 会成功导出并出现在不可关闭的 host problems 页面。

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
