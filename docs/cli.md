# CLI —— 内部架构

`niceeval` 把命令输入分到运行、读取与恢复三条路径。面向用户的命令和选项由各 Feature 的 CLI 页定义；本页只定义入口模块的责任边界。

- [Experiments CLI](feature/experiments/cli.md) 定义 `exp`、`debug`、`accept`、机器反馈和 Invocation receipt。
- [Record CLI](feature/record/cli.md) 定义 Record root、只读命令、clean 与 migrate。
- [Reports CLI](feature/reports/cli.md) 定义 `show`、`view` 与静态 export 的输入和输出。
- [Sandbox CLI](feature/sandbox/cli.md) 定义留存 Sandbox 与 provider-specific 管理入口。
- [Docker Profile CLI](feature/sandbox/docker-profiles/cli.md) 定义 Docker profile 的诊断；Docker cache 与 BuildKit
  管理命令由 [Provider cache Roadmap](roadmap/README.md) 定义。
- [Getting Started](getting-started.md) 定义 `init` 建立项目入口后的第一条使用路径。

## 模块边界

| 区域 | 职责 |
|---|---|
| `src/cli/` | 聚合冻结 contribution、定位 root、应用级 help/version、信号、最终退出状态与唯一 runtime。 |
| 各 Feature 的 `cli/` | 自己命令的 option schema、command help、参数组合、呈现与领域退出判定。 |
| `experimentHost` | `exp`、`--dry`、只读 `debug` 与 `accept` 的发现、计划、运行、采用和命令计划操作。 |
| `recordHost` | Record 的打开、创建、封口、clean 与 migrate 操作。 |
| `analysisHost` | 由已打开 reader 和选择签发 Scope-bound Sample。 |
| `reportHost` | `show` 的单目标读取，以及 `serve` / `export` 的完整站点构建。 |
| `runner/`、`record/reader/` | 各自 Host 后的内部调度和读取实现，不是 CLI 直连面。 |

`src/cli/` 只做根路由、应用 capability、进程信号接线和退出码交付。它不定义 Record 文件语义，
不计算报告读数，也不把终端文本当作业务事实。领域 contribution 不直接构造 Runner、reader、Sample、
页面或物理路径，只调用所属 Host 的闭合 operation。

| root command | contribution owner | Host / capability owner |
|---|---|---|
| `list` | Eval catalog CLI | `evalHost.catalog` |
| `check`、`exp`、`debug`、`accept`、`session` | Experiment Host CLI | `experimentHost`；session 是 ephemeral Invocation status，不是可恢复 Record |
| `show`、`view` | Report Host CLI | `reportHost`，并显式调用 Record migration 与 Experiment project-current operation |
| `clean`、`migrate` | Record Host CLI | `recordHost` typed maintenance operations |
| `sandbox` | Sandbox CLI | Sandbox registry、detached provider 与 provider 自己的能力 |
| `docker` | Docker CLI | Docker profile、image cache 与 BuildKit；不降格成通用 Sandbox API |
| `init` | Project CLI | `projectHost.initialize` 与窄 filesystem/manifest capability |

## 根路由与 option 所有权

bootstrap 组合各 contribution 的冻结 schema。根 parser 只用聚合 schema 取得 token 的原始索引；第一个
positional token 是 root，路由只删除它。root 前后的 option、值与 `--` 不重排。随后 contribution 必须用
自己的 schema 再检查投影 argv 的语法，所以“聚合层认识一个 option”不等于“每个命令都接受它”。

```console
$ niceeval --json exp list
{"format":"niceeval.experiments","schemaVersion":1,"experiments":[]}

$ niceeval sandbox list --json
niceeval error: Unknown option '--json'
```

第二条在读取 `.env`、求值 config 或连接任何 Sandbox Provider 之前失败。不存在 compatibility-only option、
中央 shadow schema 或静默忽略的跨命令 flag。应用级 help/version、最终 failure/exit、OS signal 与唯一 runtime
留在 CLI core；command help 与领域错误属于对应 contribution。

## 从发现到查看的 command ownership

根 CLI 的职责是把 token 交给正确的 contribution，不把相邻命令合并成一个含糊入口。`list` 与 `exp list`
都只读，但前者列 Eval，后者列可运行的 Experiment；`check` 验证 Experiment 与 Sandbox 的选择和 link，
`exp --dry` 才继续形成不派发的运行计划。

```console
$ niceeval list --tag smoke
Discovered 2 evals:
  onboarding/tool-first  — installs the tool before the first request
  onboarding/tool-retry  — retries after a transient tool failure

$ niceeval exp list compare/codex
compare/codex  codex · gpt-5.6 · 3 attempts · 12 evals

$ niceeval check compare/codex --tag smoke
Sandbox layers linked: 2 pairs.
```

Docker 的 profile、image cache 和 BuildKit 是 Docker contribution 的完整领域，不是 Sandbox 的最小公分母。
因此 rich command 仍留在 `docker` 下；`sandbox` 只负责已留存实例与 orphan 的检查、进入和回收。

```console
$ niceeval docker cache inventory --json
{
  "format": "niceeval.cache-inventory",
  "schemaVersion": 1,
  "scope": { "kind": "domains" },
  "domains": [],
  "providerObservations": []
}

$ niceeval sandbox list --json
niceeval error: Unknown option '--json'
```

第一个命令由 Docker 自己定义 JSON 文档。第二个命令由 Sandbox schema 在任何 Provider I/O 前拒绝；它不会因
另一个 contribution 使用同名 option 而接受它。

## 三条数据路径

### 运行

```text
argv
  ↓
experimentHost.plan / run
  ↓
Runner（Host 内部）→ recordHost.createRun
  ↓ validate + flush
complete marker
  ↓
InvocationReceipt
```

`exp` 为每个选中的 Experiment 建立 Run 和 expected slots。CLI 只调用 `experimentHost`；Host
内部的 Runner 再使用 `recordHost` 封口 Attempt 的固定事实，并用 Member 把 slot 连接到精确
Attempt。

reuse 与 explicit adoption 形成 reference Member，实际执行形成 origin Attempt。Member 的 action
说明采用或执行的原因；它不是单独的 durable family。

Run 全部内容 flush 后，writer 最后创建零字节 `complete` 完成标识。命令只返回
`InvocationReceipt`。调用方按 receipt 的 `runIds` 从已发布 Record 读取 Verdict、用量、耗时和详情。

### 生命周期命令计划

```text
argv
  ↓
experimentHost.debug()
  ↓
唯一 Experiment × Eval 选择 → link → physical planning
  ↓
commandPlan
  ↓
debug terminal / JSON
```

`niceeval debug` 只调用具名只读 `experimentHost.debug()` 操作。Host 在内部完成发现、选择、link
与 physical planning；CLI 只接收闭合的 commandPlan，不构造或直连 Runner。该操作不创建
Invocation、Run、Record、lease、Sandbox 或 build。

### 查看与导出

```text
opaque Record
  ↓
recordHost.openRead
  ↓
analysisHost.openSample
  ↓ aggregate / 具名 DomainView 投影
ClosedRows / DomainView
  ↓ reportHost
  ├─ show：选中一个 Page → 私有 ResolvedPage → terminal / target JSON
  └─ view / static：枚举全部 Page → ClosedSiteRevision → HTTP / 文件
```

`show` 与 `view` 只调用 `reportHost`。Report Host 在内部按需进入 Record Host 的 reader Scope，
再由 Analysis Host 签发固定 Sample。`show` 只执行选中 Page 的 `load`、`render` 和组件回调，短存私有
`ResolvedPage` 后交付 text 或机器文档。它不枚举参数页，也不形成 `ClosedSiteRevision`。

`view` 与 `view --out` 执行全部普通 Page 和参数 Page 实例，校验路线与资源闭包后形成完整
`ClosedSiteRevision`。HTTP 和静态目录只读取这一个 revision 的 bytes。reader 与 selection handle 不从包导出，
也不会成为 Report 作者输入。

Report runtime 从不打开 Record path，也不自行读取 family bytes。它只消费 Analysis 交付的闭合结果。

`--run` 映射到 `explicit-runs` analysis selection。不带 locator 或 `--run` 的 `show` / `view` 使用 `project-current`，从默认 Record 的全部 Run 中保留身份仍匹配当前项目的结果。CLI 不按目录名、时间或显示文本猜测对象，也不改写历史 Run。`view --out` 写出自包含站点；浏览器只读取站点自己的文件。

### 恢复

中断发生在完成标识创建前时，不发布该 Run。reader 忽略它的目录并给出 `incomplete-run` warning；用户用 `niceeval clean` 删除。Record 没有按 orphan 猜测的 clean、局部 edit 或 delete 命令。

`niceeval migrate --record <root>` 通过 `recordHost.maintenance()` 取得 exclusive maintenance lease，
并把已知可迁移的 source major 原地转换到 current major。普通 Record open 遇到可迁移的 source
major 时返回 `record-migration-required` 并指向这条命令；它不是某个 family 的读取状态。

迁移没有 compat read、output root 或 rollback command。Git 与用户备份负责回退。

## 输出与反馈

一次 Invocation 的 TTY 面板、NDJSON progress 和诊断只服务当前进程。它们可替换、合并或丢弃，不能成为 Record 的持久化协议。

持久化的业务事实由 Experiment Host 内部的 Runner 写入 Record Core 或五个固定 family。终端与
`--json` 可以显示这些事实的当前摘要，但不得从反馈文本反向形成 Record 数据。

`exp --json` 的最后一条机器输出是 receipt。调用方以进程退出状态和该 receipt 判断调用是否结束，再用 `show --json` 与 `runIds` 读取业务数据。

## 运行时与中断

调度与 Record I/O 使用 Effect 管理有界并发、资源、typed error 与中断；纯选择和状态折叠仍保持普通值。reader、writer lock、文件与流由 Scope 持有，内部调用链不自行启动 Effect runtime。

收到 `SIGINT` 或 `SIGTERM` 后，CLI 请求 Runner 中断。Runner 完成能够完成的收尾，保留已经发布的完整 Run；没有完成标识的未完成目录留给 `niceeval clean` 删除。命令返回 `completion: "interrupted"` 的 receipt；用户中断不是新的 Attempt 业务事实。

argv、配置或 selector 无法建立 Invocation 时，CLI 输出 `error:`，以非零状态结束；此时没有 receipt。
只有有限且确定的命令语法错误才附 `usage:`，有对应公开说明时可以附 `docs:`。CLI 不猜测 Provider、凭据、
网络或宿主运行条件的修复办法。

所有命令组和默认 Report 的 Human 输出遵守 [CLI Human 输出设计](feature/experiments/CLI-DESIGN.md)。机器 code、
内部身份和状态机字段只进入 JSON、Record 或明确的开发者诊断面，不能直接成为默认终端文案。

## 退出码

退出码结合本次 Invocation completion 与已知 Verdict 计算。业务判定来自本次运行已经发布的 Record 数据，不能由终端颜色、进度行或一个宽摘要代替。

`niceeval exp` 只有一份有优先级的退出码契约，Roadmap 功能不得为自己的 failure 另占状态码：

| 优先级 | 退出码 | 条件 |
|---:|---:|---|
| 1 | `130` | 收到中断信号；受控收尾可以交付 receipt，但不把中断改写为其它结果。 |
| 2 | `2` | 未捕获异常或 rejection 使 CLI 无法按受控路径结算。 |
| 3 | `1` | argv、配置或 selector 未能建立 Invocation；或 Invocation incomplete、required reporter 失败、存在 `failed` / `errored` Verdict 或其它受控执行失败。 |
| 4 | `0` | Invocation 完整结算，required reporter 成功，且没有 `failed` / `errored` Verdict。 |

同一调用命中多项时取表中更高优先级。功能自己的 receipt、diagnostic 与 typed failure 保存细分原因；退出码不复制第二套领域分类。

有关 budget、首过即停、失败停止派发和细分错误的规则，见 [Runner](runner.md) 与 [执行失败分类](feature/error-classification/README.md)。

## 相关阅读

- [Runner](runner.md)
- [Record](feature/record/README.md)
- [Sample](feature/sample/README.md)
- [Reports](feature/reports/README.md)
