# Agent 数据契约

core 只依赖中性的 `Agent`、`AgentContext`、`AgentSession`、`TurnInput` 与 `Turn`，不识别供应商名称或协议。
Agent 作者面只有 Effect-native API；以下 callback 的错误通道是 `unknown`，所需服务恒为 `never`。

## Agent 与 Turn

```ts
type Agent = SandboxAgent | DirectAgent;

interface SandboxAgent {
  readonly name: string;
  readonly kind: "sandbox";
  /** Adapter 常态证据覆盖声明；六类证据面必填，可用 completeEvidenceCoverage。见 evidence.md。 */
  readonly evidenceCoverage: EvidenceCoverage;
  /** Agent CLI 与所需运行时是否达到声明 identity；每条 probe 只读、可重复调用。 */
  readonly ensure: AgentEnsure | readonly AgentEnsure[];
  setup?(sandbox: Sandbox, ctx: SandboxAgentContext): Effect.Effect<void, unknown, never>;
  tracing?: AgentTracing;
  spanMapper?: SpanMapper;
  send(input: TurnInput, ctx: SandboxAgentContext): Effect.Effect<Turn, unknown, never>;
  /** 可选 send 执行失败分类器；只补 FailureClass，受理证据门另行决定能否重试。 */
  classifySendFailure?: SendFailureClassifier;
  teardown?(sandbox: Sandbox, ctx: SandboxAgentContext): Effect.Effect<void, unknown, never>;
}

interface DirectAgent {
  readonly name: string;
  readonly kind: "direct";
  readonly evidenceCoverage: EvidenceCoverage;
  setup?(ctx: AgentContext): Effect.Effect<void, unknown, never>;
  tracing?: Omit<AgentTracing, "configure">;
  spanMapper?: SpanMapper;
  send(input: TurnInput, ctx: AgentContext): Effect.Effect<Turn, unknown, never>;
  classifySendFailure?: SendFailureClassifier;
  teardown?(ctx: AgentContext): Effect.Effect<void, unknown, never>;
}

interface TurnInput {
  readonly text: string;
  readonly files?: readonly InputFile[];
  readonly responses?: readonly InputResponse[];
}

interface Turn {
  readonly events: StreamEvent[];
  readonly data?: JsonValue;
  readonly status: "completed" | "failed" | "waiting";
  readonly usage?: Usage;
  /** 相对 Agent.evidenceCoverage 的本轮降级(只降不升);省略 = 沿用 Agent 默认。字段契约与消费规则见[断言证据与完整性](evidence.md)。 */
  readonly evidenceCoverage?: TurnEvidenceCoverage;
}
```

`kind` 由 `defineAgent` / `defineSandboxAgent` 固定写入。
`direct` 描述 runner 直接调用 Adapter，不描述目标进程的位置。
进程内函数和远程 HTTP 服务都属于 Direct Agent，不形成第三种运行器分支。

`usage` 的 token 桶按恒互斥口径落值:`inputTokens` 是未缓存输入。
OpenAI 系协议报的「含缓存输入总量」要先扣掉缓存命中子集再落桶(契约与理由见 [Record · Architecture](../../run/architecture.md))。
各协议的原生口径与扣减明细见各 adapter 的 cost 文档。
网关实测成本只经 `usage.costUSD` 显式带回,core 从不从 token 反推。

Adapter 只负责把行为落进 `events` 单源，`send` 返回的 `Turn` 不含消息便利字段；core 在把结果交给 eval 作者前，把本轮 assistant `message` 事件的文本按序折叠成便利字段 `turn.message` 补上（作者面字段表见 [Context · 读取结果](../../eval/library/context.md#读取结果)）。
`thinking`、`compaction`、`context.injected` 不获得同类便利字段，按 `type` 过滤 `events` 读取（见[标准事件模型](events.md#派生事实)）。

`send()` 返回 Turn 还是 reject failure，必须由协议事实决定：

- `completed` / `waiting` 是正常终态；
- `failed` 是协议已经给出完整、可信、可评分的任务失败，例如 Agent 明确结束并报告无法完成；它不是 transport error，也不自动触发重试；
- CLI 非零退出、signal、transport 中断、无法辨认终态，或协议没有给出可信终态时，`send()` 必须 reject `SendFailure`，不能伪造 `failed` Turn；
- Eval 若要求任务必须完成，显式写 `await turn.succeeded().orStop()`；框架不提供把执行错误和领域失败混在一起的 `expectOk()`。

`SendFailure` 必须携带受理事实 `acceptance: "rejected" | "started" | "unknown"`，并尽可能保存 events、usage、进程状态与正规化后的 `ExternalCause`。只有协议能证明输入未被受理时才写 `rejected`；空事件、非零退出或一句 “retry later” 都不能独自证明未受理。完整分类与重试门见[执行失败分类](../../error-classification/architecture.md)。

## AgentContext

```ts
interface AgentContext {
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<Record<string, JsonValue>>;
  readonly session: AgentSession;
  readonly telemetry?: Telemetry;
  readonly experimentId?: string;
  progress(update: { message: string; current?: number; total?: number }): void;
  diagnostic(input: DiagnosticInput): void;
  log(msg: string): void;
}

interface SandboxAgentContext extends AgentContext {
  readonly sandbox: Sandbox;
}
```

`AgentContext` 不是 Record writer。Adapter 不取得任意 JSON 的 durable 写入、family、schema、blob、查询或 migration 权限。
运行时观测只有通过 NiceEval 已发布的 typed collector 或 Adapter 能力，且符合该能力的既有语义时，才能进入对应的固定 family。raw transport、SDK frame 与 OTLP 不进入 Record。
未发布 collector 的第三方值不自动持久化或查询。

`ctx` 是驱动 Agent 的低层上下文,eval 的 `t` 是运行器构造的断言视图。
二者共享 experiment 输入、signal 与作用域反馈能力,但只有 `ctx` 暴露 Agent 会话状态,只有 `t` 暴露断言和 judge。

- runner 为 `setup`、每次 `send` 与 `teardown` 分别构造上下文,同名 `progress/diagnostic` 会自动绑定到当前 `agent.setup`、`agent.run` 或 `agent.teardown` operation。
- Adapter 不能传 phase/scope,也不能把上下文保存到另一个回调复用。
- `progress` 是 Human active 行可覆写的短期状态;`diagnostic` 是结构化 warning/error,但不改变 Turn status 或 attempt verdict。
- `log(msg)` 是显式 timeout breadcrumb。它也更新 Human active 行，但最近若干条会并入 timeout error。
  Adapter 不能用 `log` 承载 user message、tool input 或其它只应在运行中显示的文本。
完整用法见 [Adapter Library · 向运行反馈进度与诊断](../library.md#向运行反馈进度与诊断)。

## 配置归属不变量

| 配置 | 所有者 |
|---|---|
| 鉴权、base URL、CLI 参数、transcript 位置 | Adapter |
| Skills、MCP、原生 Plugin、官方原生配置文件 | 用户经 Agent factory 声明，Adapter 安装、落位与校验 |
| model、reasoning effort、flags | Experiment，经 `ctx` 透传 |
| attempts、early exit、evals、sandbox、budget | Experiment / runner |

Agent 只配置怎样连接自己；运行条件不固化在 Agent 中。
被测 CLI 的原生行为开关直接写进该 CLI 的官方配置文件（见[扩展边界](coding-agent-extensions.md)），core 不为单个行为需求在 factory 上铸语义字段。

## 能力由构造证明

Agent 没有声明式 capabilities：会话能力来自 `ctx.session` 的使用，HITL 来自 waiting + request + resume，行为断言来自事件，负断言可信度来自完整性证据，Sandbox 能力来自 sandbox kind，trace 来自 telemetry 配置。
`evidenceCoverage` 不是能力位的例外——它是完整性证据的载体（诚实义务的声明），core 不据它启用或禁用任何行为，只用它折叠断言可信度。
`classifySendFailure` 同理——它只补充 Adapter 已经 reject 的 `SendFailure` 的分类精度，策略（次数、退避、停止重试）对所有 Agent 一致（见[执行失败分类](../../error-classification/architecture.md)）。

只有 Sandbox 设置运行时守卫。
其它能力缺失时由返回数据自然表现，core 不按 Agent 名字分支。

## 生命周期不变量

Sandbox Agent 的 CLI 与所需运行时只由 `ensure` 和 identity 匹配的 Installer 安装。
`setup` 只连接 runtime、注入鉴权、写运行配置与扩展，并且每 Attempt 只执行一次。
准备逻辑属于 Eval / Experiment layer 的 `prepare()`，任务 Fixture 属于 `test(t)`。
setup 基础设施失败产生 `errored`，Agent 运行结果通过 Turn 表达。

`setup` / `teardown` 遵循成对语义：`teardown` 当且仅当本 Attempt 走到过 agent setup 时点才执行，`setup` 抛错不豁免。
Sandbox Agent 的两个 Hook 接收 `(sandbox, ctx)`；Direct Agent 的两个 Hook 只接收 `ctx`，不创建也不伪造 Sandbox。
并发状态以 `ctx.session` 或 Adapter 自有的 Attempt 键管理。
完整顺序见[三方准备时序](../../sandbox/lifecycle.md)。

一次逻辑 `send` 的边界横跨首次物理调用与全部重试。最终成功或 failure 的证据必须先写入重试条目；相关命令树也必须已经终结，或进入可证明不再写 workdir 的静止态，Effect 才能完成。

HITL `waiting` 可以保留等待输入的 Agent 状态，但它必须静止。把日志写到 workdir 外，或把路径加入 `diff.ignore`，都不能代替静止证明。

正常命令执行成功后，关闭 transport / PTY / 会话本身不得顺带杀死作者启动的任务服务。反过来，命令 timeout、取消、Attempt interruption 或 Agent runtime cancellation 时，Provider 必须在 Effect 完成前确认**该受管命令树**已终止；若 Provider 无法精确终止命令树，就退休并停止整个 Sandbox。只关闭输出流后宣称取消成功是非法实现。

setup、send 与 teardown 的 callback 由 Attempt fiber 直接执行。
运行器不保存 Promise compatibility registry，也不提供 fallback。

`Effect.fail(unknown)` 在 Session 的 send choke point 规范化。
defect 保留为 Cause，不能伪装成可重试 `SendFailure`。

setup 与 send 的 `ctx.signal` 合并当前 callback fiber interruption 与 Attempt signal。
fetch / SDK Promise 只在叶子通过 `Effect.tryPromise` 接收它。

teardown 使用 Runner 的独立 cleanup deadline，不继承已取消的 Attempt signal。
cleanup failure 只形成 teardown diagnostic，不会取代原始失败。

正常 keep 或 Sandbox 复用不要求清掉任务自己有意保留的服务；Agent teardown 则必须保证 Agent driver 不会继续发模型请求。异常路径优先保证不再执行：无法证明 driver 与命令树已静止时，不能把 Sandbox 作为可安全复用或可交互的成功现场留下（见 [Sandbox 生命周期](../../sandbox/architecture.md)）。
