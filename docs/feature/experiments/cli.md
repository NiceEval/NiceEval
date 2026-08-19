# Experiments —— CLI 反馈模型

`niceeval exp` 选择已签入的 Experiment，建立一个 `invocationId`，并为每个选中的 Experiment 建立 Run。多个
Invocation 可以向同一 Record root 并发追加。命令结束时返回轻量的 `InvocationReceipt`；完整结果通过
receipt 的 `runIds` 从 Record 读取。

CLI 以 `experimentHost.list()`、`plan()` 与 `run()` 实现 `exp`，以具名只读 `experimentHost.debug()` 实现
`debug`，以 `experimentHost.accept()` 实现 `accept`。运行时 dispatch claim 与 Record lease 经
`coordinationHost`，Record I/O 经 `recordHost`。这些都是 CLI 的 Host composition；Experiment 作者 API
不取得这些协作或持久化能力。

Record 不保存可恢复的 Invocation、live session 或第二套聚合结果。运行中的面板只是当前进程内的反馈。

## 命令

```sh
niceeval exp [<experiment-prefix>] [<eval-prefix>] [flags]
niceeval exp list [<experiment-prefix>] [--json]
niceeval exp <experiment-prefix> --dry [--json]
niceeval debug <experiment-selector> <eval-selector> [--json]
```

`exp` 的位置参数先选择 Experiment ID 或路径前缀，再用后续 Eval ID 前缀收窄。它们只能缩小 Experiment 自己的 `evals` 选择，不能把未选中的 Eval 加回计划。

### `exp list`

`exp list` 只做发现和配置求值，不建立 Invocation、不取锁、不启动 Sandbox，也不写 Record。每行显示 Experiment、Agent、model、attempts、已选 Eval 数和 labels；不打印凭据或完整 flags。

精确 Experiment ID 优先。否则目录段精确匹配，最后一段允许前缀匹配。Experiment 零命中与 Eval 零命中都是具名错误，不降级为空 Invocation。

### `--dry`

`--dry` 用 shared read lease（共享读取租约）与 weak scan（弱扫描）运行 `project-target/v1`，展示 policy
identity、effective options，以及每个目标成员的 reuse 或 gap。完整人读形态见
[dry plan 输出案例](output/dry-plan.md)。

reuse planning 先精确比较当前与历史 Core expected slot 的组合 `executionIdentityDigest`，并要求历史 Core
Attempt outcome 为 `completed`。它从 Assertions 折叠可采用 Verdict，再从 Observability 读取完整真实 timing。

Assertions/Observability 缺失、partial、损坏或不支持，或 timing 超过当前 timeout，都会形成带真实 issues
的具名 gap。它不会猜成“从未运行”或 duration `0`。

`--dry` 不建立 Invocation、不写 Record，也不取得 append lease（追加租约）。它只看已发布 Run；并发封口的
Run 可以整体进入或留在本次扫描之外。

### `debug`

`debug` 通过具名只读 `experimentHost.debug()` 显示一个 `Eval × Experiment` 配对的生命周期命令计划。CLI
不直连 Runner，也不附带 dry matrix、reuse 或 carry。两个 selector 都必须唯一：精确 ID 优先，否则允许唯一
前缀；零命中或多命中会在 physical planning 前列出排序后的精确候选。

```sh
niceeval debug compare/codex memory/commit0
niceeval debug compare/codex memory/commit0 --json
```

Eval selector 只能在 Experiment 自己的 `evals` 封闭范围内匹配。选中 Group 的一个成员不会把同组其它 Eval 加回计划，但该成员仍处于 Group lane，Group author 与 Plugin lifecycle 会围住这次 selected slice。省略的成员不参与 cohort compatibility。

人读输出和 JSON 都来自同一棵 Experiment → lane → slot 树。下面这些步骤都留在真实包裹位置：

- Experiment、Group、Eval Plugin lifecycle 与 Sandbox Plugin lifecycle；
- author hook、prepare、Agent ensure/setup/teardown、test、cleanup 与 Provider finalizer。

TTY 人读输出不把整棵树放入一个总框。总览、Experiment、lane、slot 与每个 lifecycle step 都分别使用全仓统一的圆角区域框；各框按计划顺序堆叠，框内列出 position、owner、label、template、命令或不可检查原因、条件与脱敏项。这样每个 Plugin occurrence 和每条 Shell 都有自己的可复制边界。完整形态见
[command plan 输出案例](output/debug-command-plan.md)。

多行 Shell 不折成带 `\n` 的单行 JSON 字符串。框内代码区显示原始行数，并用固定 gutter 保留缩进、空行和末尾换行。单行过宽时，续行仍从同一个 gutter 开始；tab、回车、ESC 与其它终端控制字符显示为转义文本。完整形态见
[多行 Shell 输出案例](output/debug-multiline-shell.md)。

非 TTY、`NO_COLOR` 或过窄终端按同一 Panel 契约逐框降级为无框的标题与正文；节点、字段和顺序不变。`--json` 不携带框线，继续输出同一棵计划树的机器形状。

Human 的 lane 顺序固定为 Group before-slots → physical enter → slots → physical exit → Group after-slots。Physical teardown 与 Provider finalizer 因而始终列在使用该实例的 slot 工作之后。

可声明的 `shell()` / `command()` 展开为具体命令；不能安全检查的 callback 标为 `opaque`。Direct Agent 显式显示没有 Sandbox 或 template，而不是省略 materialize 阶段。

每个真实 `sandbox.materialize` 节点还显示 template owner、provider、kind 与 configured locator。`Exact` 只表示逐字复述作者配置的非秘密起点。它不保证 image tag 已固定为 digest、远端资源或 Dockerfile / Compose 内容已冻结，也不代表 BuildKey 或最终实例字节。

内建 locator 字段是闭合集合：`image`、`context`、`file`、`target`、`workspaceService`、`template`、`snapshotId`、`dir`。远端 URL 的 userinfo、query 与 fragment 会先移除并登记 redaction。Docker image 只有保守的 credential-safe reference（可带标准 `sha256` digest）才显示 `Exact`。URL、非 digest userinfo 或其它不安全语法整项显示 `Opaque`，原字符串不进入输出。E2B template 与 Vercel snapshot ID 也是 Provider 管理的任意字符串，固定显示 `Opaque`。

作者提供的本地 path、`file:` URL、Dockerfile file 或 local dir 无法仅凭语法证明不含宿主用户名、私有目录或秘密片段，因此整个 locator 固定显示 `Opaque`，原路径不进入输出。只有 `localSandbox()` 未配置 `dir` 时使用的固定 `author-base-dir` 标签可以显示 `Exact`。

custom provider / case 也只显示 `Opaque`。build args、env value、credential、stdin 与 custom identity 不进入这个投影。

Human 输出在统一终端出口把 C0、C1、ESC 与 tab/carriage return 可见化为转义文本；这条规则作用于 panel 标题、metadata、template、owner、locator、label、condition 与 Shell 行。JSON 保留结构化原值，由 JSON string escaping 防止控制序列直接写入终端。

`--json` 输出单个 `{ format: "niceeval.debug-plan/v1", schemaVersion: 1, experimentId, evalId, commandPlan }` 文档。它不带 dry matrix、reuse、carry 或 Plugin audit 顶层字段。Locator 使用 `_tag: "Exact" | "Redacted" | "Opaque"`。前两种带非空、字段名唯一的 `fields`；`Redacted` 另带只指向已有字段的 `redactions`，`Opaque` 带结构化 `reason`。

`debug` 不执行 Experiment、Plugin、Sandbox 或 Agent 的运行期 setup、test、teardown、ensure、materialize 或 finalizer，也不创建 Invocation、Run、Record、锁、Sandbox 或 build。它会加载 `.env`、求值受信任定义与 Experiment 的 `evals` predicate；Provider planner 也可以读文件、调用只读 CLI、查询 Docker control plane 或远端 API。NiceEval 保证自己不发起资源变更，但不能保证受信任模块求值或远端服务不产生自身副作用、审计日志或缓存。

计划把 Experiment 配置的全部 attempts 都列成候选 dispatch slot。这不是实际运行保证：正常 `exp` 仍可能因 carry、首过即停、预算、fail-fast 或取消而阻止某个 slot 启动。`debug` 只接受 `--json`；`--help` 与 `--version` 仍由全局 CLI 处理。

Sandbox reuse lane 的 `id` 只是在同一份计划内关联 slot 的 opaque digest。调用方不应按格式拆解它；前缀与跨版本值都不稳定，输出也不会展开 digest 输入。

## `niceeval accept`

```sh
niceeval accept @1K1P0VJAPVJ12
niceeval accept @1K1P0VJAPVJ12 @1MEMY3VCQ6B5B
```

accept 对全部 locator 与当前 target 做完整预检：它使用 Core combined execution identity、真实 Attempt outcome 加 Assertions 的 Verdict 折叠，以及 Observability 的完整 timing。任一项失败都零业务写入，不能降级成 execution gap。通过后为关联 Experiment 建立 Run，以 Core reference Member 引用源 Attempt，并以 Core `accepted` action 持久复核路径；执行事实不复制。

| 错误 | 反馈 |
|---|---|
| `malformed-locator` | 要求规范 `@1` 加 12 个大写 Crockford 字符；不接受空白、大小写折叠或旧 `@UUID` |
| `locator-not-found` | 当前 Record 没有该 Attempt |
| `accept-ineligible` | 列出 Verdict、timeout、配置或计划的阻断条件 |
| `duplicate-accept-member` | 指出重复的目标 slot |

动态 query、差异类别和隐含批量 accept 都不支持。

## 运行中反馈

Runner 从当前进程内的事件流维护 TTY 面板：progress 可以替换，阶段与计数可以更新。持久业务事实只能进入 Core 或 NiceEval 固定的 Attachment；没有通用持久化 writer。

| 信息 | 当前进程 | Record |
|---|---|---|
| counters、active Attempt、短 detail | 更新 | 不单独保存 |
| `progress()` | 合并或丢弃 | 不保存 |
| diagnostic、运行时观测、phase event | 显示 | 只有 NiceEval 已发布 collector 支持的值才进入 Observability |
| assertion、Verdict、usage | 显示摘要 | Core outcome 加固定 Assertions / Observability |
| Invocation 结束 | 显示终态 | API 返回 receipt |

进程退出后不能用后台监看或 session 查询重建这块 live 状态。需要长期查看的内容必须已经通过 NiceEval 已发布 collector 进入固定 Record 事实；第三方任意值不会自动持久化或查询。需要分享则生成静态 Report。

### Attempt 阶段

Runner 只投影实际生命周期阶段，Adapter、Sandbox provider 与用户 Hook 不能伪造 phase：

| phase | Human 文案 |
|---|---|
| `sandbox.queue` | waiting for sandbox |
| `sandbox.create` | creating sandbox |
| `sandbox.prepare.*` | preparing sandbox |
| `agent.ensure` | preparing agent |
| `agent.setup` | agent setup |
| `eval.run` / `agent.run` | running eval |
| `workspace.diff` | capturing diff |
| `assertions.evaluate` | evaluating assertions |
| `sandbox.cleanup` / `sandbox.stop` | releasing sandbox |

Experiment `setup` 与 `teardown` 显示为 Run 范围活动。同一 Record root 的其它写 Invocation 可以继续追加自己
的 Run。执行去重、同一 Experiment 的 dispatch claim 与并发名额由 Coordination 处理，而不是由 Record
writer 互斥。只读命令只惰性读取已发布 Run。

### 协调等待与恢复

有效 owner 持有 Experiment 并发槽时，等待方以 `i gate-lease-waiting` 显示当前运行状态。该信息不改变
completion 或退出码。名额释放或 owner heartbeat 过期后，调度器继续派发。

过期协调状态被原子接管时，当前 Invocation 产生 info 级 `coordination-recovered` notice。成功接管不形成
warning，也不写入 Run diagnostic。Human 只说明 NiceEval 已恢复中断运行留下的状态并继续执行，不展示
lease、lock 或协调器内部计数；机器流为每次接管保留结构化 notice。完整形态见
[协调恢复输出案例](output/coordination-recovery.md)。

机器 notice 的稳定字段如下；`resource` 决定资源专属字段是否存在：

```ts
interface CoordinationRecoveredNotice {
  event: "notice";
  code: "coordination-recovered";
  level: "info";
  message: string;
  resource: "concurrency-slot" | "case-lock";
  experimentId: string;
  evalId?: string;
  slot?: number;
  previousPid?: number;
  previousHost?: string;
}
```

完整恢复路径见[恢复中断运行留下的协调状态](use-case/并发/恢复中断运行.md)。

## 结束反馈与 receipt

TTY 结束反馈显示 Invocation completion、Run ID、终态计数、`RESULTS` 和下一步命令。它不持久化成另一份结果文档。
完整的通过场景见[正常完成输出案例](output/completed-run.md)。

结果标题是人类结果摘要，不是 `InvocationReceipt.completion` 的别名。正常发布后的优先级固定为：

1. 有 execution error：`ERRORED`；
2. 有未被满足的结果缺口：`INCOMPLETE`；
3. 纯 Pass：有未通过时 `FAILED`，否则 `PASSED`；
4. 纯 Score：`SCORED`；
5. mixed：有未通过的 Pass Eval 时 `FAILED`，否则 `COMPLETED`。

预算耗尽和无法解释的 `not-dispatched` 是结果缺口；已满足契约的 early exit 不是缺口。受控中断
显示 `INTERRUPTED`，Record 发布失败显示 `FAILED TO PUBLISH`，两者不冒充正常结果摘要。标题不替代退出码：
Pass 未通过、execution error、结果缺口、中断和发布失败均保持非零退出；完整 Score 结果即使 earned 为 `0`
仍是成功的 `SCORED`。

`RESULTS` 以 run configuration 为一个有界 row/block，按 plan 稳定排序。Pass Eval 显示通过读数；Score Eval
按 Eval 分 cell 或续行，显示 complete attempts 的 earned mean 与 `complete / total`。partial 只显示已知下界，
unavailable 不制造数字。

Attempt 已经创建时，断言不通过仍可按稳定失败形态聚合；execution error 不按 phase、code 或 Provider 类型
合并。每条 execution error 显示这一条 Attempt 自己的、安全封口后的 `error:`，并紧跟精确的
`details: niceeval show @<locator>`。错误文本先按既有敏感值 provenance 脱敏、剥除终端控制字符，再按单条
摘要预算收口并在送进 panel 前按显示宽度折行；“真实错误”指这个不经 renderer 推测或改写的安全消息，不是未经
安全处理的原始字节。完整形态见 [Attempt 失败输出案例](output/attempt-failures.md)。

Human 最多显示五个 run configuration block；其余项显示准确省略数，并在 `NEXT` 给出能包含被省略 Run 的精确
`niceeval show --run <runId>` 命令。
合法零分必须显示成 `0 score · complete`，不能省略或当成 unavailable。

Attempt 创建前的共享构建失败另列 `ERRORS`。Human 显示所属 run configuration、没有启动的 Attempt 数量、
安全有界的真实错误正文与精确下钻命令，不展示 phase key、NiceEval 内部错误码、failure ID 或共享机制名称。

`not-dispatched` 仍是机器 membership，不能替代错误原因；后续 `niceeval show --run <runId>` 以用户可理解的
Attempt 和错误说明呈现完整上下文。
这组事实复用现有 Run-owned Observability diagnostic，不改变 Record 或 attachment schema；历史 Run 没有采集时
继续只显示 membership，不能补造错误原因。

shared failure identity 只供内部关联同一次物理失败，不是错误码或用户概念。Human 不展示 `n1`、BuildKey、
timing node、failureId 或共享机制名称。Attempt 创建前不存在 locator，不能伪造 `show @<locator>`；只有 Run
正式进入 receipt 后，`NEXT` 才按 run configuration 配对显示 `details: niceeval show --run <runId>`，不能使用
尚未发布的 draft Run ID。

共享失败的 Human 摘要以 `error:` 展示安全有界的真实错误正文，并按 panel 显示宽度折行，不能因为原始 stderr
没有换行而在关键信息出现前截断。摘要不增加 `cause:` 包装，也不枚举 `fix:`；Provider 返回的凭据、配额、网络或
宿主运行条件错误必须原样保留其可理解部分，再通过 `details:` 引导下钻。typed Provider error 的公开 `message`
是 Human `error:` 的取值；`cause` 不回退进 Human，其内部保留与持久化仍服从既有错误契约。
完整形态见[共享 Sandbox 构建失败输出案例](output/shared-sandbox-build-failure.md)。

```ts
interface InvocationReceipt {
  readonly invocationId: string;
  readonly runIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly completion: "completed" | "interrupted" | "failed";
}
```

receipt 不复制 locator、Verdict、usage、cost 或 Attempt 计数。需要这些值时，以 `runIds` 运行 `explicit-runs` analysis selection，或调用 `niceeval show --run <runId>`。

`runIds` 只包含已经以 `complete` 发布的 Run。一次 Invocation 没有总发布点。收到 `SIGINT` 时，Runner 关闭已完成 Attempt、把仍在飞的 reserved Attempt 记为 `interrupted`，并把未 reserved slot 记为 `interrupted` Member。成功 seal 的 Run 出现在 `completion: "interrupted"` receipt 中；收尾写入失败的 Run 保持 incomplete。正常收尾遇到没有 execution outcome 的 reserved / pending Attempt 则严格失败，不能把它伪装成已发布结果。

## `--json`

`exp --json` 输出当前进程的 NDJSON 反馈，最后恰好一条 receipt：

```json
{"type":"progress","invocationId":"01J8...","message":"running","current":1,"total":3}
{"event":"warning","code":"sandbox-retry","level":"warning","message":"retrying"}
{"type":"receipt","receipt":{"invocationId":"01J8...","runIds":["01J9..."],"startedAt":"2026-08-09T10:00:00.000Z","completedAt":"2026-08-09T10:01:00.000Z","completion":"completed"}}
```
progress 与 diagnostic 形状服务当前 Invocation，不是 Record 解码协议。机器调用方以进程退出状态和最后的 receipt 判断命令是否结束，再用 Record reader 读取业务数据。

CI 用退出状态判断门禁，使用 `--junit` 输出平台注解。JUnit 由临时文件原子替换生成，不成为 Record 的事实 owner。

## 参数影响

| 类别 | 参数 | 作用 |
|---|---|---|
| 选择 | 位置参数 | 收窄 Experiment 与 Eval |
| 调度 | `--attempts`、`--max-concurrency`、`--budget` | 影响本次派发 |
| timeout | `--timeout` | 进入本次 project-target policy，可能使目标 slot 形成 gap |
| 采用 | `--rerun` | 进入本次 policy，决定哪些 Verdict 可以形成 reuse |
| Sandbox | `--keep-sandbox` | 进入本次 policy，让全部目标 slot 形成 gap |
| 输出 | `--json`、`--junit` | 改变交付形式，不改业务事实 |

argv、配置发现或 selector 无法形成 Invocation 时，命令以非零状态输出 `error:`。有限且确定的语法错误可以附
`usage:`，有对应公开说明时可以附 `docs:`；不输出猜测性的 `fix:`。因为尚未建立 `invocationId`，这类错误没有 receipt。

## 相关阅读

- [输出案例索引](output/README.md) —— 每个公开反馈场景的完整 Human 或 JSON 形态。
- [CLI Design](CLI-DESIGN.md) —— Human 输出的语言边界、错误呈现与下钻契约。
- [Architecture](architecture.md) —— Invocation、Run、Member 与 Coordination 分工。
- [缓存与携带](cache.md) —— carried / accepted 的资格和写入。
- [Record CLI](../record/cli.md) —— `show`、locator 与 Record 维护命令。
- [Record Library](../record/library.md) —— receipt、reader、writer 与固定 Attachment。
