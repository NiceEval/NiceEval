# CLI —— 内部架构

`niceeval` 把命令输入分到运行、读取与恢复三条路径。面向用户的命令和选项由各 Feature 的 CLI 页定义；本页只定义入口模块的责任边界。

- [Experiments CLI](feature/experiments/cli.md) 定义 `exp`、`debug`、`accept`、机器反馈和 Invocation receipt。
- [Record CLI](feature/record/cli.md) 定义 Record root、只读命令、clean 与 migrate。
- [Reports CLI](feature/reports/README.md) 定义 `show`、`view` 与静态 export 的输入和输出。

## 模块边界

| 区域 | 职责 |
|---|---|
| `src/cli.ts` | argv、命令分派、信号与退出状态。 |
| `experimentHost` | `exp`、`--dry`、只读 `debug` 与 `accept` 的发现、计划、运行、采用和命令计划操作。 |
| `recordHost` | Record 的打开、创建、封口、clean 与 migrate 操作。 |
| `analysisHost` | 由已打开 reader 和选择签发 Scope-bound Sample。 |
| `reportHost` | Report execution、show、serve 与 export。 |
| `runner/`、`record/reader/` | 各自 Host 后的内部调度和读取实现，不是 CLI 直连面。 |

`src/cli.ts` 只做 argv 读取、工作目录确定、Host 调用、进程信号接线和退出码交付。它不定义
Record 文件语义，不计算报告读数，也不把终端文本当作业务事实。CLI 不直接构造 Runner、reader、
Sample、页面或物理路径。

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
  ↓ aggregate / query
ClosedRows / SemanticFrame / DomainView
  ↓ reportHost.execute
ReportExecution / ClosedReportTree
  ↓
show / view / static export
```

`show` 与 `view` 只调用 `reportHost`。Report Host 在内部按需进入 Record Host 的 reader Scope，
再由 Analysis Host 签发 Sample；它根据 Page 的 `load`、`render` 和组件回调闭合有限数据依赖，
形成一次 immutable `ReportExecution`。reader 与 selection handle 不从包导出，也不会成为 Report
作者输入。

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

argv、配置或 selector 无法建立 Invocation 时，CLI 输出 `error:` 和 `fix:`，以非零状态结束；此时没有 receipt。

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
