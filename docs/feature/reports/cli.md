# Reports CLI

show、show --json、view 与 view --out 使用一条 SSG-first 管线。每条命令先选择 Record，再由 Analysis Host 打开固定
Sample，再由 Report Host 用 ReportDefinition 调用 `buildSiteRevision()`。作者 Page 在这一步调用 `aggregate()`、
`rollup()` 或 `to*` 投影；命令的呈现阶段不再调用这些 API。

```text
CLI selection
  │
  ▼
analysisHost.openSample()
  │ fixed Sample
  ▼
reportHost.buildSiteRevision(ReportDefinition, Sample)
  │ full page enumeration, author callbacks, global validation
  ▼
ClosedSiteRevision
  ├─ show text
  ├─ show --json
  ├─ view HTTP
  └─ view --out files
```

CLI 不把 `--page` 交给 builder。当用户选择一个 page，Host 仍构建和验证全站；该选项只选择终端输出的页面或 view
初始打开的页面。

## 共同选择项

```sh
niceeval show [selection] [report options]
niceeval view [selection] [report options]
niceeval view [selection] [report options] --out <directory>
```

| 选项 | 含义 |
|---|---|
| `--record <root>` | 选择实际 Record root；省略时使用 `<cwd>/.niceeval/record`。 |
| `@<locator>` | 精确选择一个 immutable Attempt。 |
| `--run <run-id>` | 可重复；精确选择历史 Run。 |
| `--experiment <id>` | 可重复；按完整 ExperimentId 收窄不带 locator 或 `--run` 的当前项目选择。 |
| `--report <module>` | 选择内建 Report 或受信任的 Report module。 |
| `--page <route>` | 从已构建 revision 选择一个 exact route。 |
| `--port <port>` | `view` 监听端口；省略时由操作系统分配空闲端口。 |
| `--host <address>` | `view` 监听地址；省略时为 `127.0.0.1`。 |
| `--no-open` | 阻止 `view` 自动打开浏览器。 |
| `--json` | 让 `show` 输出固定 JSON。 |
| `--out <directory>` | 写入完整静态站，不启动 watcher 或长期 server。 |

不传 locator、`--run` 或 `--experiment` 时，命令按当前项目身份形成 Sample。它选择全部匹配的 published Run，
不按时间缩成最后一个 Run，也不写回 Record。没有匹配结果时仍形成空 Sample；度量以自己的 state、samples、total
和 issues 表达结果。

`--experiment` 只收窄当前项目选择，不能与 locator 或 `--run` 合用。多值 flag 不接受逗号列表。未知 Run、未知
Experiment、未知 route、无法规范解码的参数 route 和缺少根 Page 时省略 `--page` 都是用法错误。

### selector 与默认 Report

selector 先决定 Sample，默认 Report 再决定这个 Sample 要关闭哪些事实：

| selector | 没有显式 `--report` | 有显式 `--report` |
|---|---|---|
| 不带 selector 的 `project-current` | `niceeval.config.ts` 的 `report`；没有配置时用 `default-overview` | 显式 Report |
| 一个或多个 `--run` | 内建 `run-membership-overview` | 显式 Report |
| 精确 `@<locator>` | 内建 `attempt-overview` | 显式 Report |

`--report overview` 是显式选择通用 `default-overview`。`niceeval.config.ts` 仍提供 Theme、source snapshot 和 view
重建输入；内建 Run Report 的优先级只影响默认 Report 决议。

## `niceeval show`

```sh
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527
niceeval show --run 7b8d2ea4-b840-4870-9840-f85a436a5527 --page /overview
niceeval show @1K1P0VJAPVJ12
niceeval show --json
```

`show` 先调用 `analysisHost.openSample()`，再调用 `reportHost.buildSiteRevision()`。builder 会枚举所有参数 Page、
调用所有 Page 的 `load` 与 `render`、关闭组件与下载，并校验全站。最后 `show` 从 revision 的关闭页面投影生成 terminal
文本。

未传 `--page` 时，show 输出普通导航页面。传 `--page` 时，它只选择已经构建的那个 route 输出；参数 key 已在全站枚举与
规范检查中处理。它不会为了这次终端命令额外读取事实。

构建阶段在 stderr 显示项目与 Report 模块加载、Record 打开、Sample 签发、全站构建和最终投影的阶段反馈。`show --json`
的 canonical JSON 独占 stdout，阶段反馈不会进入机器输出。

### `niceeval show --json`

`show --json` 使用与 text 相同的完整 revision。内建报告输出领域机器文档 `niceeval.show`：

- `schemaVersion` 是机器合同版本；
- `view` 是 `leaderboard`、`attempt`、`source`、`execution` 或 `timing`；
- `sample`、canonical problem table（规范问题表）和 `data` 都来自同一份关闭结果。

调用方不需要遍历通用组件树，就能找到 Run、Attempt、评价、Evidence、Source、Trace 或 Timing。

显式加载自定义 Report 时，NiceEval 无法猜测作者的领域模型，因此退回通用 `niceeval.report-show/v1` 投影。它包含
Report 与 Sample identity（身份）、关闭 Page、下载摘要、canonical problem table，以及调用者用 `--page` 选择的阅读
目标。两种 JSON 都来自同一个完整 revision，不会另开一条数据读取路径。

JSON 不输出下载 raw bytes、Record payload、Sample capability 或第二条数据读取路径。object key 按 UTF-8 bytes 排序，
arrays 按 canonical order 排序，stdout 是 UTF-8 canonical JSON。

Broken pipe 是正常 CLI 退出。其它 console failure 是类型化错误；中断按 Cause 传播。show 完成后退出，不 watch。

### 内建 Run 概览与 Attempt 详情

一个或多个 `--run` 在没有显式 `--report` 时使用 `run-membership-overview`。固定页面为 route `/`，并列显示
Sample Core 和关闭的 Attempt Evidence。表的稳定列是 `runId`、`slotId`、`slotState`、`memberAction`、
`memberRelation`、`sourceAttemptLocator` 和 `evidenceState`。

精确 `show @<locator>` 在没有显式 `--report` 时使用 `attempt-overview`。它在全站构建中关闭 Evidence、
Observability 与 File Changes。Source、Trace 和 Diff 由已生成详情 Page 或 revision 文件提供，不在终端显示后再读取。

## `niceeval view`

```sh
niceeval view --report ./reports/summary.ts --port 4400
niceeval view --host 192.168.0.199
niceeval view --run 01H... --page /attempt/attempt-01h... --no-open
```

`view` 初始时先按同一条 Analysis 和 Report API 链构建完整 ClosedSiteRevision，再启动 HTTP server。没有 `--page` 时，
浏览器打开 `/`；带 `--page` 时打开指定的已构建 route。导航只列 revision 内已经生成且 `navigation` 为真的 Page。

每个 HTTP request 在开始时固定 current revision。Host 原样提供该 revision 的 HTML、静态文件与下载 bytes。浏览器导航、
刷新、Source、Trace、Diff 与下载都不会调用 Page callback、Analysis 或 Record。

view 监听 Record root、Report module、项目内静态 import、Theme module 和 `niceeval.config.ts`。每次变化形成 build intent：

| rebuild 结果 | view 行为 |
|---|---|
| 最新完整构建成功 | 原子替换 current revision，并清除上一条 rebuild 问题。 |
| 旧 candidate 在较新 intent 后结束 | 废弃结果，不发布。 |
| 新 candidate 可中断 | 中断后不发布。 |
| 模块、配置、选择、Analysis 或全站校验失败 | 保留 last-good，并显示有界 rebuild 问题。 |

刷新通知只提示浏览器有新版本。它不携带 Analysis 数据，也不要求 JavaScript 才能读取站点。

完全省略 `--host` 时，server 只监听 `127.0.0.1`。非 loopback 监听没有认证或 TLS；CLI 必须在 stderr 警告，
使用者自行保证网络可信。HTTP 只服务 `GET` / `HEAD`；其它 method 返回 `405`。

## `niceeval view --out`

```sh
niceeval view --report ./reports/summary.ts --out ./report-site
niceeval view --run 01H... --out ./shared-site --no-open
```

`--out` 不接受 `--page`。它先调用 `analysisHost.openSample()`，再调用 `reportHost.buildSiteRevision()`；这个 builder 与
show、JSON 和 view 完全相同。全站验证成功后，exporter 原样把 revision 的页面、静态文件和下载 bytes 写入目标目录。

目标目录必须不存在。存在时返回 `report-export-target-exists`，Host 不删除或替换其中的文件。构建或写入失败返回类型化
错误，不发布一个宣称完整的站点。

生成目录不需要 Record、NiceEval 安装或网络。禁用 JavaScript 后，浏览器仍读取正文、导航、详情、完整度、问题和下载。
同一路由的静态 body bytes 与 `view` HTTP body bytes 相同。

## 路由、链接与下载

`--page` 接收 Report 声明并已构建的 exact route。普通 Page 使用自己的 path；参数化 Page 使用 path 与规范 key 组成 route。
未知或不规范 route 是用法错误，不是浏览器端的补读请求。

静态映射与相对链接由同一个 Host codec 生成：

```text
/              -> index.html
/quality       -> quality/index.html
/attempt/a1    -> attempt/a1/index.html
download x.csv -> downloads/x.csv
```

Host 在构建时检查 route、download、静态文件和 manifest 的 exact、大小写、前缀、device-name 与长度冲突。Page 不手写
静态 href 或文件路径。

## 用户可见失败

| 情况 | 命令结果 |
|---|---|
| 定义无效、Analysis 全局错误或限额超出 | 返回类型化错误，不形成 revision。 |
| 参数枚举、Page、组件、关闭页面或路径冲突失败 | 返回全站构建错误；view 保留 last-good。 |
| MetricValue 是 partial、empty、unsupported 或 failed | 成功呈现状态、issues 与 refs。 |
| 未知或不规范 route | 用法错误，给出可选择的 route 或参数格式。 |
| 输出目录已存在 | 返回 `report-export-target-exists`，不改动目录。 |
| 写入失败 | 返回 `report-export-write-failed`，不泄露任意系统路径或内部 cause。 |

## 相关阅读

- [Report Library](library.md)：Page、Sample、组件与 Host 边界。
- [Architecture](architecture.md)：完整 builder、revision 和 latest-intent-wins。
- [分享静态报告站](use-case/分享静态报告站.md)：团队分享的离线路径。
- [制作可访问页面](use-case/制作可访问页面.md)：text、Web 与无 JavaScript 阅读。
