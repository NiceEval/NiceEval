# Reports CLI

`show`、`view` 与 `view --out` 使用同一条 Record→Sample→Report execution 管线。一次 execution 读取一个 frozen candidate set，形成完整分母与全部 requested projections，然后成为不再访问 Record 的 immutable value。

本机 `view` 可以长期观察输入变化，但每次成功 rebuild 都发布一个新的固定 execution；它不修改旧 execution。

## 共同选择项

```sh
niceeval show [selection] [report options]
niceeval view [selection] [report options] [server options]
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
| `--host <address>` | `view` 监听地址；默认只能是 loopback。 |
| `--allow-network-view` | 与显式 non-loopback `--host` 同时给出才允许网络监听；Config 无权开启。 |

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

`show` 构造一次 `ReportExecution`，再从 closed semantic report tree 渲染 terminal text。`--json` 输出exact `niceeval.report-show/v1`，包含：

- sample 与每个 projection input 的 coverage；
- Calculation generic data、family summaries 与页面；
- bounded problem table；
- Download 的 path、mediaType、byteLength 与 SHA-256 metadata。

它不创建第二条projection或计算路径，不输出Download raw bytes，也不声称恢复author-specific TypeScript value。

Host只显示每个input的complete/partial、`ProjectionCoverage`与problem IDs，不替作者公式猜observed/denominator。通过率等业务统计只有在Calculation value自己提供时才显示。unavailable、unsupported、invalid与execution-failed必须保留状态及problem reference，不能替换成零、空字符串或省略行。

没有`--page`时JSON按route输出全部pages；有`--page`时只输出exact选中页，但global sample/projection coverage、calculations、families、download metadata与problems仍保留。arrays与keys使用canonical order，stdout为UTF-8 canonical JSON；`REPORT_SHOW_JSON_BYTES_MAX`在stream累计中执行。Broken pipe是正常CLI退出，其它console failure是typed error，interruption保持Cause。

`show` 完成后退出，不 watch。

## `niceeval view`

```sh
niceeval view --latest --report ./reports/summary.ts --port 4400
niceeval view --run 01H... --page /attempts/attempt-01h... --no-open
```

`view` 打开一个 scoped `ReportViewSession`。`--port` 选择端口，`--no-open` 阻止自动打开浏览器。导航只列出当前成功 revision 已经展开的 routes。

Record canonical ID不能直接拼route：Report作者必须用`reportInstanceKeyFromRecordId`与`reportRouteFromKeys`形成lowercase、domain-tagged route。CLI中的`attempt-01h...`是adapter输出；Record详情与页面正文仍显示原uppercase `AttemptId`。

每个成功 revision 固定包含：

- Report/Config/Theme source snapshot；
- core-only `AnalysisSample`；
- 一个 immutable `ReportExecution`；
- loaded Theme。

watch 闭集是：

- Record root；
- Report module 及其项目内静态 import；
- Theme module；
- `niceeval.config.ts`。

`fs.watch` 只提供 hint；host 在 hint、rename/overflow、periodic reconciliation 与 manual refresh 后核对完整 stat+digest closure。每个候选 revision 使用 fresh one-shot Worker；成功 transfer 或失败后立即关闭 Worker、ports、temporary bundle 与 handles。

能形成 exact `ReportExecution` + built-in problems surface 就是成功 revision。Recorded data problem，或已隔离的 projector/author/tree/route execution problem，会发布新 revision并显式显示。module/config/theme无法load、Record/selection global typed error、limit、Worker crash/timeout或wire envelope无法验证时，保留last-good并产生bounded rebuild summary。

HTTP request、页面打开与刷新不触发新的 Record I/O。Record、Report 或影响选择的 Config 变化产生新的 execution；Theme-only 变化可以复用同一个 immutable execution，再发布新的 view revision。

web renderer 与 `show` 从同一棵 semantic tree 读取。图表、颜色与交互只能增强已有文字、表格、数值和状态，不能改变分母或发起新的 Channel 读取。

View 默认绑定 `127.0.0.1` / `::1`。Non-loopback 必须同时给出 `--host` 与 `--allow-network-view`；Theme/Config 不能偷偷开启。Server 验证 Host 与 Origin、默认拒绝 CORS，并把 session capability 放进不可预测 URL。Refresh 由本地 session 控制，不暴露无保护 HTTP mutation。

## `niceeval view --out`

```sh
niceeval view --latest --report ./reports/summary.ts --out ./report-site
niceeval view --run 01H... --out ./shared-site --no-open
```

`--out` 不启动 watcher 或长期 server。它构造一个固定 `ReportExecution`，穷尽全部 PageFamily instances、routes、downloads 与 semantic trees，再导出自包含静态站。

export 只写这个 execution 的既有结果、当前 host-data、downloads、manifest 与内建精确 runtime。Report module 不能注入任意 script、style、font、worker、WASM、网络 URL、DOM 或文件 path。

目标必须不存在。exporter 在目标同级 owner-specific staging directory 写入并 sync 完整 closure，然后调用平台 atomic no-replace directory publish 并 sync parent：

- 目标存在：`report-export-target-exists`；
- staging 与 target 跨卷：`report-export-cross-device`；
- 平台或文件系统不能证明 atomic no-replace：`report-export-atomic-publish-unsupported`。

不得 fallback 到 `exists + rename`、copy 或替换既有目标。失败不会修改既有目标。

生成站点可在断网、禁 JavaScript 的浏览器中打开。浏览器只读取 manifest 中的站点文件，不读取源 Record，也不要求之后安装 NiceEval。Recorded data problems 会成功导出并出现在不可关闭的 host problems 页面；任一 execution problem则整体不发布。

## Channel 与 consumer 反馈

| 情况 | `show` | `view` | `--out` |
|---|---|---|---|
| 未请求的坏 Channel | 不读取、不影响。 | 不读取、不影响。 | 不读取、不影响。 |
| requested `unavailable` | 显示不可用。 | 对应 consumer + problems surface 显示。 | 成功导出并显式显示。 |
| requested `unsupported` | 显示 schema/media type issue。 | 对应 consumer + problems surface 显示。 | 成功导出并显式显示。 |
| requested `invalid` / partial | 按 completeness 形成 data-unavailable 或局部结果。 | 发布新 revision并显示问题。 | 成功导出并显式显示。 |
| consumer/projector defect | 显示 execution-failed。 | 发布新 revision、局部显示并保留其它页面。 | 整体不发布。 |
| rebuild failure | 不适用。 | 保留最后一个成功 revision。 | 不适用。 |

命令只把当前 Report definition 声明的 inputs 视为依赖。动态 PageFamily 可以按这些已经形成的 typed values 展开 routes，但不能追加 I/O。

## 相关阅读

- [Reports README](README.md)：范围与心智模型。
- [Architecture](architecture.md)：两阶段 planning、热重载与 semantic tree。
- [Library](library.md)：作者 DSL、Effect API 与错误。
- [Use case](use-case/README.md)：常见任务路径。
