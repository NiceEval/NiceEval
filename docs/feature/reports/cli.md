# Reports CLI

`show`、`view` 与 `view --out` 使用同一条 Record→Sample→Report execution 管线。一次 execution 读取一个 frozen candidate set，形成完整分母与全部 requested projections，然后成为不再访问 Record 的 immutable value。

本机 `view` 可以长期观察输入变化，但每次成功 rebuild 都发布一个新的固定 execution；它不修改旧 execution。

## 共同选择项

```sh
niceeval show [selection] [report options]
niceeval view [selection] [report options]
niceeval view [selection] [report options] --out <directory>
```

| 选项 | 含义 |
|---|---|
| `--record <root>` | 选择 Record root；省略时使用项目默认 root。 |
| `--run <run-id>` | 可重复；使用 explicit analysis selection。 |
| `--latest` | 使用 latest analysis selection。 |
| `--experiment <id>` | 与 `--latest` 合用时给出完整目标集合；与 `--run` 合用时收窄已有 Sample。 |
| `--eval <id>` | 在既有 Sample 上收窄 Eval。 |
| `--report <module>` | 选择内建 Report 或受信任的 Report module。 |
| `--page <route>` | 选择一个已经展开的 exact route。 |
| `--port <port>` | `view` 监听端口；默认 4173，只绑定 loopback。 |
| `--no-open` | 阻止 `view` 自动打开浏览器。 |

`--run` 与 `--latest` 二选一，至少给出一个。多选 Run 或 Experiment 时重复对应 flag，不接受逗号列表。

不存在的 Run、空目标集合、任一目标 Experiment 没有 published Run、未知 route 或尚未展开的参数化 route 都是用法错误。命令不会猜测“最近的任意结果”。

旧 Record major 在执行选择或装载 Report 前以 `record-migration-required` 停止，并提示用户运行 `niceeval migrate`。

## `niceeval show`

```sh
niceeval show --run 01H... --report ./reports/summary.ts
niceeval show --run 01H... --run 01J... --page /comparison
niceeval show --latest --experiment checkout --page /overview
niceeval show --latest --json
```

`show` 构造一次 `ReportExecution`，再从 closed semantic report tree 渲染 terminal text。`--json` 输出 exact `niceeval.report-show/v1`：

- sample 摘要与每个 projection input 的 coverage；
- Calculation results、family summaries、页面与 bounded problem table；
- Download 的 path / mediaType / byteLength / SHA-256 metadata。

它不创建第二条 projection 或计算路径，不输出 Download raw bytes。
Host 只显示每个 input 的 complete/partial 与 problem IDs，不替作者公式猜 observed/denominator。通过率等业务统计只有在 Calculation value 自己提供时才显示。unavailable、unsupported、invalid 与 execution-failed 必须保留状态及 problem reference，不能替换成零、空字符串或省略行。

没有 `--page` 时 JSON 按 route 输出全部 pages；有 `--page` 时只输出 exact 选中页，但 sample / projection coverage、calculations、families、download metadata 与 problems 仍保留。arrays 与 keys 使用 canonical order，stdout 为 UTF-8 canonical JSON。Broken pipe 是正常 CLI 退出，其它 console failure 是 typed error，interruption 保持 Cause。

`show` 完成后退出，不 watch。

## `niceeval view`

```sh
niceeval view --latest --report ./reports/summary.ts --port 4400
niceeval view --run 01H... --page /attempts/attempt-01h... --no-open
```

`view` 打开一个 scoped `ReportViewSession`。导航只列出当前成功 revision 已经展开的 routes。

Record canonical ID 不能直接拼 route：Report 作者必须用 `reportInstanceKeyFromRecordId` 与 `reportRouteFromKeys` 形成 lowercase、domain-tagged route。CLI 中的 `attempt-01h...` 是 adapter 输出；Record 详情与页面正文仍显示原 uppercase `AttemptId`。

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
niceeval view --latest --report ./reports/summary.ts --out ./report-site
niceeval view --run 01H... --out ./shared-site --no-open
```

`--out` 不启动 watcher 或长期 server。它构造一个固定 `ReportExecution`，穷尽全部 PageFamily instances、routes、downloads 与 semantic trees，再导出自包含静态站。

export 只写这个 execution 的既有结果、当前 host-data、downloads、manifest 与内建精确 runtime。Report module 不能注入任意 script、style、font、worker、WASM、网络 URL、DOM 或文件 path。

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
| requested `unsupported` | 显示 schema/media type issue。 | 对应 consumer + problems surface 显示。 | 成功导出并显式显示。 |
| requested `invalid` / partial | 按 completeness 形成 data-unavailable 或局部结果。 | 发布新 revision并显示问题。 | 成功导出并显式显示。 |
| consumer/projector defect | 显示 execution-failed。 | 发布新 revision、局部显示并保留其它页面。 | 整体不发布。 |
| rebuild failure | 不适用。 | 保留最后一个成功 revision。 | 不适用。 |

`migration-required` 与 `migration-unavailable` 在呈现中不能混淆：只有前者提示运行 `niceeval migrate`；后者表示明确没有无损 converter，只呈现 reason，不能反复提示迁移命令。

命令只把当前 Report definition 声明的 inputs 视为依赖。动态 PageFamily 可以按这些已经形成的 typed values 展开 routes，但不能追加 I/O。

## 相关阅读

- [Reports README](README.md)：范围与心智模型。
- [Architecture](architecture.md)：静态数据依赖、热重载与 semantic tree。
- [Library](library.md)：作者 DSL、Effect API 与错误。
- [Use case](use-case/README.md)：常见任务路径。
