# Reports CLI

三条查看命令都从 lock-free frozen `RecordReader` 得到 core-only `AnalysisSample`。它们随后形成 ReportPlan 与 ReportInput，再执行一次 Report。

reader Scope 持续到 `AnalysisSample`、ReportPlan 与 ReportInput 全部形成，期间不取得 writer lock，可以和 Run publish 并发。Scope 关闭后，ReportExecution 只从自包含内存输入形成；并发新发布的 Run 或 Report 文件变化只影响下一次调用，本机 server 和静态 export 都不再读取 Record。

## 共同选择项

```sh
niceeval show [selection] [report options]
niceeval view [selection] [report options] [server options]
niceeval view [selection] [report options] --out <directory>
```

| 选项 | 含义 |
|---|---|
| `--record <root>` | 选择 Record root；省略时使用项目的默认 root。 |
| `--run <run-id>` | 可重复；每次增加一个明确 Run，重复 identity 去重。 |
| `--latest` | 使用 `latest/v1` analysis projector。 |
| `--experiment <id>` | 可重复；与 `--latest` 合用时成为 projector 的完整目标集合，与 `--run` 合用时收窄已投影的 `AnalysisSample`。 |
| `--eval <id>` | 在既有选择上收窄 Eval。 |
| `--report <module>` | 选择内建 Report 或一个 Report module。 |
| `--page <id>` | 选择一个已计划页面；参数化页必须给出完整已计划 route。 |

`--run` 与 `--latest` 二选一，至少给出一个。多选 Run 或 Experiment 时重复对应 flag，不接受逗号列表。

不存在的 Run、目标集合为空、任一目标 Experiment 没有完成 Run、未知页面或未列出的参数化 route 都是用法错误。命令不会猜测“最近的任意结果”。

## `niceeval show`

```sh
niceeval show --run 01H... --report ./reports/summary.ts
niceeval show --run 01H... --run 01J... --page comparison
niceeval show --latest --experiment checkout --page overview
niceeval show --latest --json
```

`show` 在终端呈现同一份 ReportExecution 的 Calculation、页面文字等价内容与失败状态。`--json` 输出已经生成的页面宿主数据与状态；它不是另一条取数路径，也不会创建落盘格式。

partial 值必须同时显示 observed、denominator 和 `partial`。unavailable、unsupported 与 invalid 必须显示原因或 issue。终端不能把不可用读数替换成零、空字符串或省略行。

## `niceeval view`

    niceeval view --latest --report ./reports/summary.ts --port 4400
    niceeval view --run 01H... --page attempt-01H... --no-open

`view` 在本机提供已经生成的网页。`--port` 选择端口，`--no-open` 阻止自动打开浏览器。页面导航只列出 ReportPlan 已列出的 route。

本机服务器服务一次固定的 ReportExecution。它不观察 Record、Report module、样式或配置文件变化。需要查看编辑后的事实或页面时，结束这次命令并重新执行。

web 页面与 `show` 共享计算结果。图表、颜色和交互只能增强已存在的文字、表格与状态提示，不能改变分母或发起新的通道读取。

## `niceeval view --out`

    niceeval view --latest --report ./reports/summary.ts --out ./report-site
    niceeval view --run 01H... --out ./shared-site --no-open

`--out` 不启动长期服务器。它预渲染全部页面和参数化实例，并以自包含静态报告站写入目标目录。`--no-open` 在此模式下可省略，但不会改变 export 内容。

export 只写同一份 ReportExecution 的既有结果，并输出页面、当前宿主数据、下载项、内建精确 runtime 与 `StaticAssetManifest`。用户 Report 不能注入任意 script、style、font、worker、WASM、网络 URL 或文件路径。

`--out` 目标必须不存在；存在时命令以 `report-export-target-exists` 失败，不替换或删除。全部 consumer preflight 通过后，命令才在同级临时目录写文件，并以一次 rename 让完整目标出现。

生成的站点可在断网浏览器中打开。浏览器只读取站点自己的文件，不读取源 Record，也不要求之后安装 NiceEval。

## 通道反馈与退出状态

| 情况 | `show` | `view` / `--out` |
|---|---|---|
| 未请求的坏通道 | 不读取，也不影响输出。 | 不读取，也不影响页面或 export。 |
| 请求的 `unavailable` | 显示不可用原因。 | 显示不可用状态。 |
| 请求的 `unsupported` | 显示 reader 不支持该通道。 | 显示同样状态。 |
| 请求的 `invalid` | 输出具名 issue 并以失败状态结束目标页。 | 本机 view 只让该 route 失败；`--out` 不发布目标目录。 |
| 用户 consumer 执行失败 | 显示 execution-failed。 | 本机 view 局部显示；`--out` 整体失败。 |

命令只把被目标页面或 Calculation 请求的通道视为输入。其它报告、其它页面和其它 export 不因未请求的通道状态而失败。

## 相关阅读

- [Reports README](README.md)：范围与心智模型。
- [Architecture](architecture.md)：固定输入、页面与自包含站点。
- [Library](library.md)：公开类型、错误和 StaticAssetManifest。
- [Use case](use-case/README.md)：常见任务路径。
