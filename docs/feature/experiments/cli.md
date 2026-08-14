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
identity、effective options，以及每个目标成员的 reuse 或 gap：

```text
PLAN
compare/codex  memory/commit0  ordinal 0  reuse/carried @1K1P0VJAPVJ12
compare/codex  memory/commit0  ordinal 1  gap: identity-mismatch
```

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

TTY 人读输出不把整棵树放入一个总框。总览、Experiment、lane、slot 与每个 lifecycle step 都分别使用全仓统一的圆角区域框；各框按计划顺序堆叠，框内列出 position、owner、label、template、命令或不可检查原因、条件与脱敏项。这样每个 Plugin occurrence 和每条 Shell 都有自己的可复制边界：

```text
╭─ COMMAND PLAN ───────────────────── PARTIAL · 8 opaque · 2 redacted ─╮
│ Guaranteed order is per lane.                                        │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.materialize ─────────────────────────────────────── OPAQUE ─╮
│ position: lane eval-group:group · physical lifecycle template enter  │
│ owner: provider:docker                                               │
│ template: docker:image                                               │
│ template owner: experiment:suite/one                                 │
│ configured locator: exact · image="node@sha256:cd849..."             │
│ reason: provider materialization is a runtime operation              │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.prepare ──────────────────────────────────────────── EXACT ─╮
│ position: lane eval-group:group · slot group/first #0                │
│ owner: eval:group/first                                              │
│ command: shell "printf fixture-ready"                                │
╰──────────────────────────────────────────────────────────────────────╯
```

多行 Shell 不折成带 `\n` 的单行 JSON 字符串。框内代码区显示原始行数，并用固定 gutter 保留缩进、空行和末尾换行。单行过宽时，续行仍从同一个 gutter 开始；tab、回车、ESC 与其它终端控制字符显示为转义文本：

```text
╭─ sandbox.prepare ──────────────────────────────────────────────────── EXACT ─╮
│ position: lane eval:group/first · slot group/first #0                        │
│ owner: eval:group/first                                                      │
│ command: shell · 5 lines                                                     │
│   │ set -eu                                                                  │
│   │   pnpm install                                                           │
│   │                                                                          │
│   │   pnpm test                                                              │
│   │                                                                          │
╰──────────────────────────────────────────────────────────────────────────────╯
```

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

## 结束反馈与 receipt

TTY 结束反馈显示 Invocation completion、Run ID、终态计数和下一步命令。它不持久化成另一份结果文档。

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

`runIds` 只包含已经以 `complete` 发布的 Run。一次 Invocation 没有总发布点。收到 `SIGINT` 时，含 reserved /
inflight Attempt（已预留 / 正在运行 Attempt）的 Run 保持 incomplete（未发布不完整）；其它已闭合 Run 仍可出现在
`completion: "interrupted"` receipt 中。正常收尾遇到 reserved / pending Attempt（已预留 / 待结算 Attempt）则严格失败，不能把它伪装成已发布结果。

## `--json`

`exp --json` 输出当前进程的 NDJSON 反馈，最后恰好一条 receipt：

```json
{"type":"progress","invocationId":"01J8...","message":"running","current":1,"total":3}
{"type":"diagnostic","invocationId":"01J8...","code":"sandbox-retry","level":"warning","message":"retrying"}
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

argv、配置发现或 selector 无法形成 Invocation 时，命令以非零状态输出 `error:` 与 `fix:`。因为尚未建立 `invocationId`，这类错误没有 receipt。

## 相关阅读

- [Architecture](architecture.md) —— Invocation、Run、Member 与 Coordination 分工。
- [缓存与携带](cache.md) —— carried / accepted 的资格和写入。
- [Record CLI](../record/cli.md) —— `show`、locator 与 Record 维护命令。
- [Record Library](../record/library.md) —— receipt、reader、writer 与固定 Attachment。
