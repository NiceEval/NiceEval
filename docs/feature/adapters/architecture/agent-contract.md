# Agent 数据契约

core 只依赖中性的 `Agent`、`AgentContext`、`AgentSession`、`TurnInput` 与 `Turn`，不识别供应商名称或协议。

## Agent 与 Turn

```ts
interface Agent {
  readonly name: string;
  readonly kind: "sandbox" | "remote";
  /** Adapter 常态证据覆盖声明;省略 = 全通道 unknown(保守),官方适配器显式声明(可用 completeCoverage 常量)。见 evidence.md。 */
  readonly coverage?: EvidenceCoverage;
  setup?(sandbox: Sandbox, ctx: AgentContext): Promise<void | Cleanup> | void | Cleanup;
  tracing?: AgentTracing;
  spanMapper?: SpanMapper;
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?(sandbox: Sandbox, ctx: AgentContext): Promise<void> | void;
}

interface TurnInput {
  readonly text: string;
  readonly files?: readonly InputFile[];
  readonly responses?: readonly InputResponse[];
}

interface Turn {
  readonly events: StreamEvent[];
  readonly data?: unknown;
  readonly status: "completed" | "failed" | "waiting";
  readonly usage?: Usage;
  /** 相对 Agent.coverage 的本轮降级(只降不升);省略 = 沿用 Agent 默认。字段契约与消费规则见[断言证据与完整性](evidence.md)。 */
  readonly coverage?: EvidenceCoverage;
}
```

`kind` 由 `defineAgent` / `defineSandboxAgent` 固定写入。进程内调用仍属于 remote kind，不形成第三种运行器分支。

## AgentContext

```ts
interface AgentContext {
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<Record<string, unknown>>;
  readonly sandbox: Sandbox;
  readonly session: AgentSession;
  readonly telemetry?: Telemetry;
  readonly experimentId?: string;
  progress(update: { message: string; current?: number; total?: number }): void;
  diagnostic(input: DiagnosticInput): void;
}
```

`ctx` 是驱动 Agent 的低层上下文，eval 的 `t` 是运行器构造的断言视图。二者共享 experiment 输入、signal 与作用域反馈能力，但只有 `ctx` 暴露 Agent 会话状态，只有 `t` 暴露断言和 judge。

runner 为 `setup`、每次 `send` 与 `teardown` 分别构造上下文,所以同名 `progress/diagnostic` 会自动绑定到当前 `agent.setup`、`agent.run` 或 `agent.teardown` operation。Adapter 不能传 phase/scope,也不能把上下文保存到另一个回调复用。`progress` 是 Human active 行可覆盖的短期状态;`diagnostic` 是永久 warning/error,但不改变 Turn status 或 attempt verdict。完整用法见 [Adapter Library · 向运行反馈进度与诊断](../library.md#向运行反馈进度与诊断)。

## 配置归属不变量

| 配置 | 所有者 |
|---|---|
| 鉴权、base URL、CLI 参数、transcript 位置 | Adapter |
| Skills、MCP、原生 Plugin、原生 `settings` | 用户经 Agent factory 声明，Adapter 安装、落位与校验 |
| model、reasoning effort、flags | Experiment，经 `ctx` 透传 |
| runs、early exit、evals、sandbox、budget | Experiment / runner |

Agent 只配置怎样连接自己；运行条件不固化在 Agent 中。被测 CLI 的原生行为开关经 `settings` 以该 CLI 自己的配置词汇声明（见[扩展边界](coding-agent-extensions.md)），core 不为单个行为需求在 factory 上铸语义字段。

## 能力由构造证明

Agent 没有声明式 capabilities：会话能力来自 `ctx.session` 的使用，HITL 来自 waiting + request + resume，行为断言来自事件，负断言可信度来自完整性证据，Sandbox 能力来自 sandbox kind，trace 来自 telemetry 配置。`coverage` 不是能力位的例外——它是完整性证据的载体（诚实义务的声明），core 不据它启用或禁用任何行为，只用它折叠断言可信度。

只有 Sandbox 设置运行时守卫。其它能力缺失时由返回数据自然表现，core 不按 Agent 名字分支。

## 生命周期不变量

Agent setup 负责连接 Agent 自身并且每 attempt 只执行一次；环境预置属于 SandboxSpec，任务 fixture 属于 eval。setup 基础设施失败抛出为 errored，Agent 运行结果通过 Turn 表达。

沙箱型 Agent 的 `send()` 返回时，Agent 侧可能写 workdir 的进程必须已退出、或已进入可证明不再写 workspace 的静止态（HITL waiting 挂起等输入即属此类）——`send()` 的返回就是 diff 归因的窗口边界，后台残留写入会落在窗口外、被错记成 eval 归因（见 [Sandbox · 变更归因](../../sandbox/architecture.md#变更归因send-窗口与分类账)）。
