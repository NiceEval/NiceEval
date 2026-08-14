# Reports CLI

show、view 与 view --out 使用同一条 Record → Analysis → Report 管线。每次命令固定一份 Sample，再形成不可变的 ReportExecution；renderer 不会在之后重新读取事实。

## 共同选择项

```sh
niceeval show [selection] [report options]
niceeval view [selection] [report options]
niceeval view [selection] [report options] --out <directory>
```

| 选项 | 含义 |
|---|---|
| --record <root> | 选择 Record root；省略时使用 <cwd>/.niceeval/record。 |
| --run <run-id> | 可重复；精确选择历史 Run。 |
| --experiment <id> | 可重复；按完整 ExperimentId 收窄当前项目目标。 |
| --report <module> | 选择内建 Report 或受信任 Report module。 |
| --page <route> | 选择一个 exact route。 |
| --port <port> | view 的监听端口；默认 4173，只绑定 loopback。 |
| --no-open | 阻止 view 自动打开浏览器。 |
| --json | 让 show 输出固定 JSON。 |
| --out <directory> | 生成静态站，不启动 watcher 或长期 server。 |

不传 locator、--run 或 --experiment 时，命令按当前项目身份形成 Sample。它选择全部匹配的 published Run，不按时间缩成最后一个 Run，也不写回 Record。没有匹配结果时，命令形成空 Sample；度量用自己的 state、samples、total 和 issues 表达结果。

--experiment 不能与 --run 合用。多值 flag 不接受逗号列表。未知 Run、未知 Experiment、未知 route、不能规范 decode 的参数 route 和没有 root Page 时省略 --page 都是用法错误。

## niceeval show

```sh
niceeval show --run 01H... --report ./reports/summary.ts
niceeval show --run 01H... --run 01J... --page /comparison
niceeval show --experiment checkout --page /attempt/attempt-01h...
niceeval show --json
```

未传 --page 时，show 执行每个普通 Page，并按 route 输出。参数化详情页必须给出 exact route，避免一次终端命令意外枚举无限增长的详情集合。

传 --page 时，show 只执行该 Page instance。它对参数 key 执行 decode 和规范往返检查，再运行该实例的 load、render 和组件树。不存在的实例不会触发事实读取。

show 的 text 和 JSON 都从同一 ClosedReportTree、下载 metadata 和 problemTable 派生。--json 输出固定的 niceeval.report-show/v1：

- Report identity、Sample 摘要和所选 target；
- 普通 Page 与已执行参数实例的 route、状态和闭合树；
- 页面摘要、下载的 path、mediaType、byteLength 与 SHA-256；
- canonical problemTable。

JSON 不输出下载 raw bytes、Record payload、Sample capability、未执行页面或第二条数据读取路径。arrays 按 canonical order，object key 按 UTF-8 bytes 排序，stdout 是 UTF-8 canonical JSON。

Broken pipe 是正常 CLI 退出。其它 console failure 是 typed error，interruption 保持 Cause。show 完成后退出，不 watch。

## niceeval view

```sh
niceeval view --report ./reports/summary.ts --port 4400
niceeval view --run 01H... --page /attempt/attempt-01h... --no-open
```

view 打开 scoped ReportViewSession。没有 --page 时，它打开 root route /；Report 没有 root Page 时，用户必须显式传入 --page。导航只列当前成功 revision 中已经执行且 navigation 为真的普通 Page；详情 route 由页面内已闭合链接进入。

Record identity 不能直接拼 route。Page params 的 encode() 负责产生规范小写 key；CLI 只显示该 key，页面正文仍显示领域对象自己的原始 identity。

每次成功 rebuild 固定包含 Report、config、theme 的内容快照、Sample 摘要和 immutable ReportExecution。页面打开、HTTP request 与浏览器刷新都不会重新读取事实。

| rebuild 结果 | view 行为 |
|---|---|
| 新 execution 成功 | 原子替换 current revision，并清除上一条 rebuild problem。 |
| Page execution problem | 发布新 revision，保留其它成功页面和不可关闭问题面。 |
| Report module、config、选择、Analysis 或限额错误 | 保留 last-good revision，并显示有界 rebuild summary。 |
| 仅 theme 变化 | 可复用原 execution，仍发布新的 view revision。 |

watch 输入闭集是 Record root、Report module、其项目内静态 import、Theme module 和 niceeval.config.ts。loader、watcher、server 和 module cache 的实现细节属于 Node host。

Web 图形、颜色和交互只能增强已有 tree 的文字、表格、MetricValue 和状态。它们不能更改分母、打开路径或触发新的事实读取。

## niceeval view --out

```sh
niceeval view --report ./reports/summary.ts --out ./report-site
niceeval view --run 01H... --out ./shared-site --no-open
```

--out 不接受 --page。它建立一份静态 all-pages execution：运行每个普通 Page，调用每个参数化 Page 的 enumerate(sample)，并执行所有枚举出的实例。这样导出目录包含完整的 route 与下载 closure，而不是首个浏览器访问后才逐页补齐的网站。

执行完成后 exporter：

1. 检查所有闭合页面、route、下载、限额和 execution problem；
2. 唯一地准备一个此前不存在的目标目录；
3. 写出 HTML、host-data、downloads、manifest 和内建 runtime；
4. 在全部文件成功写完后，最后写零字节 complete marker；
5. sync 目录。

目标已存在时返回 report-export-target-exists，不删除或替换任何文件。中断或失败可能留下无 complete marker 的目录；Host 提示用户删除后重试。此命令不承诺原子目录发布。

生成站点可在断网、禁 JavaScript 的浏览器中打开。浏览器只读取目录内站点文件，不打开 Record、加载 Report module 或请求网络。

MetricValue 的 partial、empty、unsupported 和 failed 会随闭合树与问题面导出。参数、load、render、组件、树或路径冲突等 execution problem 则使整次 export fail closed。

## 路由、链接与下载

--page 接收 Report 声明的 exact route。普通 Page 使用自己的 path；参数化 Page 使用 path 和规范 key 组成的 route。未知或不规范 route 是用法错误，而非浏览器端的补读请求。

静态页映射、相对链接和下载路径由同一个 Host codec 产生：

```text
/              -> index.html
/quality       -> quality/index.html
/attempt/a1    -> attempt/a1/index.html
download x.csv -> downloads/x.csv
```

Host 在写出前检查所有 route、downloads、host-data、runtime 与 manifest 的 exact、大小写、前缀、device-name 和长度冲突。页面不得手写静态 href 或文件路径。

## 用户可见失败

| 情况 | 命令结果 |
|---|---|
| 定义无效、Analysis 全局 error 或限额超出 | 返回类型化 error，不形成 ReportExecution。 |
| unknown 或不规范 route | 用法错误，给出可选择的 route 或参数格式。 |
| MetricValue 有 partial、empty、unsupported 或 failed | 成功呈现状态、issues 和 refs。 |
| 单个 Page 或组件失败 | show / view 保留其它页面并显示 execution problem。 |
| 静态 execution 有任一 execution problem | 返回 report-export-execution-problem，不发布完整站点。 |
| 输出目录已存在 | 返回 report-export-target-exists，不改动目录。 |
| 写入失败 | 返回 report-export-write-failed，不泄露任意系统路径或内部 cause。 |

## 相关阅读

- [Report Library](library.md)：Page、参数、路径、问题和 typed error。
- [Architecture](architecture.md)：一次 execution、热重载与静态导出。
- [分享静态报告站](use-case/分享静态报告站.md)：团队分享的完整路径。
- [制作可访问页面](use-case/制作可访问页面.md)：text、web 与无 JavaScript 阅读。
