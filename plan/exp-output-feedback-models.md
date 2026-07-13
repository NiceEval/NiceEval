# PLAN：重构 `niceeval exp` 的 Human / Agent / CI 反馈模型

> 状态：目标契约已定，代码尚未实现。
>
> 面向执行者：把本文件直接交给实现 agent。按依赖顺序完成全部 TODO；不要只换文案或给现有 Live 打补丁。
>
> 主契约：`docs/feature/experiments/cli.md`。如果本计划与主契约冲突，以主契约为准并同步修正本计划。

## 完成后的唯一产品形态

`niceeval exp` 不再把“TTY / 非 TTY”直接当产品模式，也不再用 `--quiet` 同时承载人、AI 与 CI 的不同需求。它提供三个明确反馈 profile：

```bash
niceeval exp compare --output human
niceeval exp compare --output agent
niceeval exp compare --output ci
```

默认 `--output auto`：

```text
stderr 是 TTY                    → human
CI=true 或常见 CI 环境标记存在   → ci
其它非 TTY                       → agent
```

三种 profile 只改变反馈，不改变选择、调度、判定、artifact 或结果 schema：

- **human**：有 TTY 时使用动态 dashboard；计划、失败、最终诊断和结果路径永久追加。没有 TTY 时退化成 human 文案的追加流，不输出 ANSI。
- **agent**：稳定 ASCII envelope；开始一次，连续 30 秒无永久事件才 heartbeat，失败带 locator，结束给有界 handoff block。
- **ci**：单一有序 stdout 事件流；连续 60 秒无永久事件才 heartbeat；退出码、JSON、JUnit 和快照是权威接口。

核心输出纪律：

```text
动态覆盖：elapsed、cost、reused / running / queued / completed、当前 active phase
永久追加：plan、失败/errored locator、重试耗尽、降级、budget 耗尽、中断、最终结果路径
永不逐条输出：spinner 帧、重复 waiting、中间 retry、passed attempt、每条原始 progress log
```

任何时刻都必须满足：

```text
total = reused + running + queued + completed
```

## 开始前必读

按顺序阅读，不能只读本计划：

1. `AGENTS.md`：直接在 `main` 协作、保护未知改动、公共行为同步和验证规则。
2. `docs/README.md`：`docs/` 是目标契约，不是当前实现说明。
3. `docs/feature/experiments/README.md`、`library.md`、`cli.md`：experiment 与本次反馈模型的正式契约。
4. `docs/runner.md`：矩阵、并发、首过即停、budget、缓存和退出码。
5. `docs/feature/results/README.md`、`architecture.md`、`library.md`：快照、attempt 落盘和 locator。
6. `docs/cli.md`：CLI → reporter → runner 的现有接线。
7. `memory/INDEX.md` 命中的以下正文：
   - `live-overflow-redraw-appends-frames.md`
   - `live-raw-stderr-write-desyncs-redraw.md`
   - `live-rows-fold-experiment-variants.md`
   - `live-who-key-mismatch-freezes-rows.md`
   - `live-carry-row-shows-waiting-forever.md`
   - `quiet-progress-result-stream-asymmetry.md`
   - `cli-exit-code-attempt-level-not-eval-level.md`
8. 当前实现：
   - `src/cli.ts`
   - `src/runner/run.ts`
   - `src/runner/attempt.ts`
   - `src/runner/types.ts`
   - `src/runner/report.ts`
   - `src/runner/reporters/{live,console,quiet,json,artifacts,table,shared}.ts`
   - `src/tty-line.ts`
   - `src/results/{writer,locator}.ts`
9. 当前测试：
   - `src/runner/reporters/live.test.ts`
   - `src/runner/reporters/quiet.test.ts`
   - `src/runner/attempt.test.ts`
   - `src/results/results.test.ts` 的 locator / writer 用例
   - `test/e2e-image-refusal.test.ts`
   - `test/e2e-sandbox-hooks.test.ts`

动代码前搜索全部 `process.stderr.write`、`process.stdout.write`、`console.log/error/warn`、`onProgress`、`ReporterEvent`、`runReporter`、`--quiet` 调用点。不要假设上述文件列表已经覆盖所有终端出口。

## 当前 gap

| 领域 | 当前实现 | 目标 |
|---|---|---|
| 模式选择 | `stderr.isTTY → Live`，否则 Console；另有语义含混的 `--quiet` | `--output auto\|human\|agent\|ci`，环境只负责 auto 选择 |
| Human Live | 每 80ms 靠 spinner 定时整帧重画；每 `(eval, experiment)` 预留一行 | 真实状态变化驱动、最多 4 fps；稳定 active slots；不为全矩阵预留行 |
| 永久事件 | 底层模块可裸写 stdout/stderr，依靠 `tty-line.ts` 通知 Live 清屏 | run 激活后所有反馈都进入同一事件/renderer 管线并保持顺序 |
| Human 完成页 | 清 Live 后打印完整 experiment + eval 大表 | 失败优先摘要、locator、下钻命令和快照路径；完整对比交给 show/view |
| Agent | 没有正式模式；`--quiet` 仍输出 raw attempt progress，缺 locator handoff | 30 秒空闲 heartbeat + 有界 handoff；不含 ANSI/表格/本地化字段名 |
| CI | 依赖非 TTY Console + 可选 JSON/JUnit；通过 attempt 逐条刷日志 | 单一 stdout 事件流；只打印失败/诊断；60 秒空闲 heartbeat |
| Locator | writer 落盘时生成；其它 reporter 并行收到的 `EvalResult` 通常还没有 locator | fresh result 在任何完成事件/reporter 前已有最终 locator，且与落盘完全一致 |
| Reporter 失败 | `runReporter()` 一律吞掉并写 diagnostic | 区分 required / best-effort；CI 指定的 JSON/JUnit、默认 artifacts 失败必须判红 |
| Budget 未完整覆盖 | 停止派发但 summary/退出码没有一等 incomplete 结论 | unstarted 数量进入 completion 状态；CI 不得伪装成完整通过 |
| JSON/JUnit 写入 | 直接覆盖目标文件 | 临时文件 + 同目录原子 rename；不会暴露半成品 |
| 结果写入 | attempt 已增量写，但 snapshot 身份与 runtime locator 生成未共用 | run 开始即确定每个 experiment 的 snapshot identity；attempt 增量写继续保留 |

## 承重设计

### 1. 反馈状态与永久事件分开

不要让 renderer 从任意字符串猜状态。Runner 产出语义事件，profile reporter 用纯 reducer 得到当前状态：

```ts
interface RunFeedbackState {
  total: number;
  reused: number;
  running: number;
  queued: number;
  completed: number;
  elapsedMs: number;
  estimatedCostUSD?: number;
  active: ReadonlyMap<AttemptKey, ActiveAttempt>;
  failures: readonly FailureNotice[];
  diagnostics: readonly DiagnosticNotice[];
}
```

状态计数必须在 reducer 层维护和断言，renderer 不自行推导第二份。`total = reused + running + queued + completed` 是 reducer 的不变量测试。

最后一栏不是自由文本日志。定义正式 attempt phase：

```ts
type AttemptPhase =
  | "sandbox-provision"
  | "sandbox-setup"
  | "workspace-setup"
  | "eval-setup"
  | "agent-setup"
  | "telemetry-setup"
  | "running"
  | "diff"
  | "scoring"
  | "trace"
  | "teardown";

interface ActiveAttempt {
  identity: AttemptIdentity;
  phase: AttemptPhase;
  phaseStartedAt: number;
  detail?: string;
}
```

- `waiting for a slot` 是 scheduler state，不是 phase。
- verdict、reused、early exit、budget-unstarted 是 outcome，不是 phase。
- phase 不是 provider/adapter 发出的公共事件，而是 reducer 把 runner 打开的 lifecycle operation 投影成 UI 状态。
- operation start 必须在对应异步工作开始前发出，不能工作做完才补一条“captured diff”。
- `running.detail` 可接短的 turn/tool progress；adapter 自由文本不能覆盖 phase。
- remote agent 和没有对应 hook/tracing 的 attempt 跳过不适用阶段，不伪造 sandbox/setup 行。
- `teardown` 覆盖 agent/eval/sandbox cleanup、hook teardown 和最终 sandbox stop；cleanup 抛错另发 durable diagnostic。

生命周期事件按所有权分层：

```ts
type LifecycleOperation =
  | { scope: "sandbox"; operation: "provision" | "setup" | "teardown" | "stop" }
  | { scope: "workspace"; operation: "prepare" | "diff" }
  | { scope: "eval"; operation: "setup" | "run" }
  | { scope: "agent"; operation: "setup" | "run" | "teardown" }
  | { scope: "telemetry"; operation: "configure" | "collect" }
  | { scope: "scoring"; operation: "evaluate" };

type LifecycleEvent =
  | { type: "operation:start"; attempt: AttemptIdentity; operation: LifecycleOperation; at: number }
  | { type: "operation:progress"; attempt: AttemptIdentity; operation: LifecycleOperation; progress: ProgressUpdate; at: number }
  | { type: "operation:complete"; attempt: AttemptIdentity; operation: LifecycleOperation; at: number }
  | { type: "diagnostic"; attempt?: AttemptIdentity; operation?: LifecycleOperation; diagnostic: Diagnostic; at: number };
```

Runner 是 operation start/complete 的唯一发布者。Sandbox provider、hook、adapter、eval 与 scoring 只拿 runner 绑定好的 scoped feedback：

```ts
interface ScopedFeedback {
  progress(update: { message: string; current?: number; total?: number }): void;
  diagnostic(input: {
    code: string;
    level: "warning" | "error";
    message: string;
    data?: Readonly<Record<string, JsonValue>>;
    dedupeKey?: string;
  }): void;
}
```

调用方不能传 scope/operation/phase，也不能写 ANSI/stdout/stderr。这样 provider/adapter 能表达内部细节，但不能越权改变 Attempt 状态机。

公共 context 归属：

- `CustomSandboxSpec.create` 的 opts 增加绑定到 `sandbox.provision` 的 feedback；内置 provider 与 `withProvisionRetry` 走同一接口。
- `SandboxSpec.setup/teardown` 改用 sandbox hook context，不再借用完整 `AgentContext` 表达环境层。
- `EvalDef.setup` 获得 eval setup context；`EvalDef.test` 的 `TestContext` 暴露同一 scoped progress/diagnostic 能力。
- `Agent.setup/send/teardown` 每次调用拿各自 operation 绑定的 `AgentContext`；session/flags/telemetry 等事实共享，但 feedback scope 不复用。
- 现有 `AgentContext.log(string)` 删除或降为不进终端的 debug artifact；不能作为 lifecycle 主通道保留。

持久化边界:

- `progress` 是短期状态,不写入 results;只保留正式 phase timing。
- attempt diagnostic 按 `dedupeKey` 折叠、有界后写入 `result.json` 的 `DiagnosticRecord[]`。
- 致命执行失败写成一个结构化 `AttemptError`:稳定 code、message、lifecycle operation,以及可选的有限 cause/stack;不再只保存终端自由字符串。
- trace 是可选的辅助证据,不是错误仓库:Sandbox provision 可能早于 telemetry,teardown 可能晚于 trace collect。
- cleanup、teardown 与 sandbox stop 都贡献完 diagnostic 后才能封口并原子写 attempt;封口前被 kill 的 attempt 保持未完成,不能留下伪完整结果。
- Results schema 升到 6;同步 reader、show/view/report、JSON/JUnit 对结构化 error 与 diagnostics 的投影。

永久事件至少包括：

```ts
type DurableFeedbackEvent =
  | { type: "plan"; ... }
  | { type: "failure"; locator: AttemptLocator; ... }
  | { type: "diagnostic"; key: string; severity: "warning" | "error"; ... }
  | { type: "budget-exhausted"; experimentId: string; spent: number; unstarted: number }
  | { type: "interrupted"; ... }
  | { type: "result"; ... };
```

attempt 的最近进度可以保留文本，但必须附着在 typed attempt identity 上，只服务 human active 行，不广播成 Agent/CI 日志。

### 2. 一个 run 内只有一个终端协调者

run 激活后，底层 sandbox、budget、reporter、Ctrl+C 与 adapter 诊断不得直接写 stdout/stderr。它们发 typed diagnostic 给 feedback coordinator；coordinator 负责：

1. human：撤下动态区域 → 永久写一行 → 在下方重建；
2. agent：按 envelope 追加；
3. ci：按 stdout 事件追加；
4. 去重相同 warning；
5. 应用 failure 展开上限并输出 suppressed 计数。

`src/tty-line.ts` 可以保留为 run 启动前/崩溃兜底的 bootstrap 出口，但不能继续成为“通知 Live 后仍允许任意模块裸写”的主架构。

### 3. Locator 必须在 result 发布前确定

Human/Agent/CI 都要求失败发生时立即给 `@locator`。当前 locator 在 results writer 中生成太晚，且 reporter 是并行调用，不能通过“把 Artifacts reporter 放第一位”修补。

一次 invocation 在调度前确定 `snapshotStartedAt`。不同 experiment 可以共享同一个时间锚，因为 locator 身份还包含 `experimentId`。fresh attempt 完成后、发出任何 `eval:complete` / `failure` / reporter 回调前：

```ts
result.locator = encodeAttemptLocator({
  experimentId,
  snapshotStartedAt,
  evalId: result.id,
  attempt: result.attempt,
});
```

Artifacts writer 必须使用同一个 `snapshotStartedAt` 写 `snapshot.json`，不能继续以“该 experiment 第一条完成 result 的 attempt startedAt”另选身份锚。carry result 原样保留旧 locator，不按当前 invocation 重算。

不要把 snapshot startedAt 和 attempt startedAt 合并：前者是快照/locator 身份，后者是 attempt 的墙钟事实，两者继续分别保存。

### 4. Reporter 的失败语义显式化

CLI 内部注册 reporter 时携带策略：

```ts
interface ReporterRegistration {
  reporter: Reporter;
  name: string;
  required: boolean;
  target?: string;
}
```

- 默认 Artifacts reporter：required。
- CLI 显式 `--json` / `--junit`：required。
- 用户 `config.reporters` / eval reporter：默认 best-effort，失败进入 diagnostic，不终止其它 attempt。
- required reporter 在 attempt 增量写或 run 收尾失败：继续做能做的清理与其它 reporter 收尾，但最终 completion/exit 必须失败。

不要在第一个 reporter 抛错时中断在飞 attempt；也不要像现在一样所有 reporter 失败都只警告后退出 0。

### 5. 运行完成状态不只看 verdict 计数

在 `RunSummary` 或紧邻的 run completion 类型中显式表达：

```ts
type CompletionStatus = "complete" | "incomplete" | "interrupted";

interface RunCompletion {
  status: CompletionStatus;
  unstarted: number;
  reporterErrors: readonly ReporterError[];
}
```

budget 耗尽且仍有 unstarted → `incomplete`。用户中断 → `interrupted`。required reporter 失败 → 非成功 completion。CI 退出码不能只看 `failed/errored`。

首过即停造成的 unstarted 不属于 incomplete：它是已知 verdict 下主动省略的计划次数，单独计入 `earlyExitUnstarted` 或等价字段。

## 一步到位 TODO

以下按依赖顺序执行，但不是可长期保留的半成品阶段。全部完成、旧 reporter 清理、公开文档同步和测试通过后才算交付。

### A. 固化类型与状态 reducer

- [ ] 在 `src/runner/types.ts` 定义 `OutputProfile`、反馈计划/attempt identity/diagnostic/completion 所需类型；公共类型避免 `any` 和断言逃生。
- [ ] 定义上述 `AttemptPhase` 与 `ActiveAttempt`；phase 和 detail 是两个字段，不再把 raw progress string 当状态。
- [ ] 定义 discriminated `LifecycleOperation`、`LifecycleEvent`、`ScopedFeedback`；operation 的 scope/operation 组合必须类型安全，不接受任意 string phase。
- [ ] 扩充 `ReporterEvent` 或新增明确命名的内部 `RunFeedbackEvent`；不要让 profile reporter解析 i18n 文本。
- [ ] 事件能表达 plan、carry/reuse、attempt queued/start、operation start/progress/complete、early exit 未派发数、budget unstarted、typed diagnostic、summary、saved。
- [ ] 建纯 reducer：事件 → `RunFeedbackState`；计数、active map、cost、failure/diagnostic 去重只在这里计算。
- [ ] reducer 按固定映射从 lifecycle operation 算 `AttemptPhase`；profile renderer 不各自维护映射。
- [ ] 给 reducer 加表驱动测试：普通运行、carry、并发完成、early exit、errored、budget、interrupt；每一步都断言守恒公式。
- [ ] 加 phase 顺序测试：sandbox 与 remote 两条路径、各 setup 可选组合、tracing 有无、skip、timeout、setup 抛错、teardown 诊断；长阶段必须在开始前已可见。
- [ ] `runWho()` 继续作为展示 label，不作为 identity key；identity 必须包含 experimentId、evalId、attempt。

### A2. 给 provider、hook、adapter scoped feedback

- [ ] 在公共类型中定义最小 `ProgressUpdate` / `Diagnostic` / `ScopedFeedback`，字段可序列化、无 ANSI、无 renderer/i18n 依赖。
- [ ] `createSandbox` 在调用 provider 前打开 `sandbox.provision`;内置 Docker/E2B/Vercel 与 custom provider 都收到绑定后的 feedback。
- [ ] `withProvisionRetry` 用 progress 表达 retry/backoff（attempt/current delay），耗尽才发 diagnostic；不再裸写或静默睡眠。
- [ ] Docker image pull、E2B template/snapshot、Vercel session allocation/rotation 报 activity；只有失败/降级报 diagnostic。
- [ ] 为 `SandboxSpec.setup/teardown` 引入最小 hook context，包含 signal、experimentId、flags、sandbox 与 scoped feedback；不要继续复用完整 AgentContext。
- [ ] `EvalDef.setup` 增加 setup context，`TestContext` 增加 eval.run scoped feedback。
- [ ] Runner 为 Agent setup/run/teardown 分别构造绑定不同 operation 的 context，同时复用同一 session/identity/telemetry 事实。
- [ ] 迁移内置 claude-code/codex/bub/ai-sdk adapter 的 `ctx.log`;安装/配置/turn/tool 分别改 progress，真实 warning/error 改 diagnostic。
- [ ] 删除或重新定义 `AgentContext.log`:如果保留 debug log，它只进 attempt debug artifact/timeout recent logs，不进入 profile renderer。
- [ ] 给 custom provider、sandbox hook、eval setup、agent adapter 各写一个编译与运行测试，证明它们能报告 detail/diagnostic，但不能指定 phase/scope 或直接控制终端。

### B. 提前建立 snapshot identity 与 locator

- [ ] `runEvals()` 开始时建立本 invocation 的 `snapshotStartedAt`，通过 run context / feedback plan 传到 Artifacts writer。
- [ ] fresh `EvalResult` 在任何 reporter/event 之前写入最终 locator。
- [ ] carry result 保留原 locator；若 carry 数据缺 locator，按 Results 现有兼容规则处理，不能用当前快照锚静默重算成另一身份。
- [ ] `createResultsWriter` / `Artifacts` 接口显式接收 snapshot identity，不再从首个完成 result 的 attempt startedAt 猜。
- [ ] 保留 attempt startedAt 的独立落盘与展示语义。
- [ ] 测试 locator 在 `eval:complete`、`onEvalComplete`、agent/ci failure 行和 `result.json` 中完全相同。
- [ ] 测试多 experiment 同一 snapshotStartedAt 不碰撞；同 eval 多 attempt、carry、并发完成顺序均稳定。

### C. 建统一 feedback coordinator

- [ ] 新建聚合模块（建议 `src/runner/feedback/`），负责 profile 解析、state reducer、sink、时钟与 terminal coordination；不要把三种模式继续堆进 `src/cli.ts`。
- [ ] 定义可注入 `FeedbackIO`（stdout/stderr、isTTY、columns、rows、clock/timers），测试不得全靠 monkey-patch 全局 process。
- [ ] run 激活前的 argv/config 错误可继续走 bootstrap stderr；run:start 之后的诊断全部走 coordinator。
- [ ] 迁移 `sandbox/registry.ts`、`sandbox/docker.ts`、`sandbox/vercel.ts`、`runner/run.ts`、`runner/report.ts`、中断处理与其它搜索到的裸写点。
- [ ] coordinator 消费 scoped lifecycle events；禁止根据 message 正则猜 “setup / scoring / trace” 阶段。
- [ ] 同一种 warning 用稳定 key 去重；retry 中间态只更新 active state，retry 耗尽/降级才发永久 diagnostic。
- [ ] 明确 sink 关闭顺序：停 heartbeat / redraw → 清 dashboard → reporter 收尾 → 最终 result / paths；结束后不允许 timer 再写一帧。

### D. 实现 Human renderer

- [ ] 用静态 `●` / `·` 等状态符号，不用 spinner 帧驱动重画。
- [ ] 真实 state 变化合并渲染，最多 4 fps；elapsed 最多每秒变化一次；rendered frame 与上一帧相同则不写。
- [ ] dashboard 高度以 `stderr.rows` 为硬上限，宽度以 `stderr.columns` 为硬上限；窄终端先减 active slots，再截断消息，不产生软换行。
- [ ] active slots 稳定：可见 attempt 完成前不因其它 attempt 更新而换位，完成后才补下一项。
- [ ] active 行最后一栏由 `AttemptPhase` 本地化；只有 `running.detail` 作为次要文本附着，sandbox/setup/diff/scoring/teardown 都有稳定展示。
- [ ] dashboard 只含命令、elapsed、守恒计数、cost 和 active slots；失败/诊断不做会消失的 `RECENT PROBLEMS` 区块。
- [ ] 永久事件到来时原子执行 clear → append → redraw；禁止外部裸写破坏光标位置。
- [ ] failed/errored 默认展开前 10 条；超过后追加一次 suppressed 提示并持续维护总数，完整结果不丢。
- [ ] 完成页不再调用完整 `renderRunReport()` 大表；实现失败优先摘要、locator、`show`/`view` 下一步和快照路径。
- [ ] 全通过时不显示空 failures 区块；结果路径多时折叠，不把一组几十个快照逐行刷满。
- [ ] 显式 human + 非 TTY：无 ANSI，start + 永久事件 + 30 秒空闲 heartbeat，结束仍用 human 摘要。

### E. 实现 Agent renderer

- [ ] 固定 ASCII envelope 和字段顺序；字段值需要空格时使用 JSON string 转义，不依赖 locale。
- [ ] start 立即追加；仅连续 30 秒无永久事件才 heartbeat；failure/warning 后重置 heartbeat 时钟。
- [ ] 不输出 active phase、waiting 明细、passed result、raw progress 或表格。
- [ ] failed/errored 立即输出 locator；默认最多展开 5 条，之后输出 suppressed 总数。
- [ ] 最终 stdout handoff 有界：status、verdict summary、快照、最多 5 个失败、每个失败的一层原因与可执行的 `show` 下钻命令。
- [ ] handoff 不内联 transcript、trace、源码或 diff；这些只通过 locator 按需读取。
- [ ] `--dry --output agent` 输出稳定 PLAN envelope，不运行、不落盘。

### F. 实现 CI renderer

- [ ] CI 正常事件全部走一个 stdout sink，避免 stdout/stderr 分开缓冲导致乱序；只有 run 未启动前的 argv/config 错误走 stderr。
- [ ] 固定 English/ASCII key=value 行，不受 `NICEEVAL_LANG` 改变字段名。
- [ ] start 立即追加；仅连续 60 秒无永久事件才 heartbeat；failure/diagnostic 后重置时钟。
- [ ] passed 不逐条打印；failed/errored 立即打印 locator；默认展开上限 50，完整清单由 JSON/JUnit 保存。
- [ ] 最后一条 result 行独立说明 status、verdict counts、reused、unstarted、duration；随后打印实际生成的 JSON/JUnit/快照路径。
- [ ] budget unstarted → incomplete + 非零；required reporter 失败 → 非零；用户中断 → 130。
- [ ] PR、nightly `--no-early-exit`、budget incomplete 三类集成测试覆盖文档示例。

### G. CLI 接线与旧模式删除

- [ ] `FLAG_OPTIONS` 新增 `--output`，解析仅接受 `auto|human|agent|ci`；错误值给明确用法。
- [ ] auto 检测集中成纯函数并测试：显式值 > CI env > TTY > agent fallback。列出实际支持的 CI env，不写不可测试的“常见环境”。
- [ ] 删除 `--quiet` flag、`QuietReporter`、相关 i18n、测试和注释；beta 不保留隐式别名造成第四种模式。
- [ ] `src/cli.ts` 只负责解析 profile、构造 coordinator/reporters、运行和退出；展示逻辑不留在 CLI 分支里。
- [ ] 保留 `--json` / `--junit` 为正交机器出口；不因 profile 自动猜用户想要的文件路径。
- [ ] `--dry` 走所选 profile 的 plan renderer，但不创建 Artifacts/JSON/JUnit reporter。
- [ ] 把 `test/e2e-image-refusal.test.ts`、`test/e2e-sandbox-hooks.test.ts` 等 `--quiet` 调用迁到明确 profile。

### H. Required reporter 与原子文件

- [ ] 内部 reporter registration 区分 required / best-effort；不破坏用户实现 `Reporter` 的公共形状。
- [ ] 继续串行化 reporter 生命周期边界，单个 reporter 失败不终止其它 reporter 的必要收尾。
- [ ] required failure 收集进 completion，并由三种 profile 给出对应诊断；CI 非零退出。
- [ ] 为 JSON/JUnit 实现同目录 temp → write → rename 的原子替换 helper；成功后不留 temp。
- [ ] 写入失败保留旧目标文件或明确不产生新目标，不能留截断 JSON/XML。
- [ ] Artifacts 继续逐 attempt 增量落盘；中断测试证明已完成 attempt 可由 `openResults()` 读取。
- [ ] 默认 Artifacts writer 失败视为 required failure；结果路径只打印真正创建成功的快照。

### I. 文档、参考与 memory 收口

- [ ] 更新 `src/cli.ts` flag JSDoc 后运行 `pnpm docs:reference`，不要手改 GENERATED flag 表。
- [ ] 同步 `docs/cli.md` 的 reporter 选择与数据流：auto profile、feedback coordinator、required reporter、locator 提前生成。
- [ ] 同步 `docs/runner.md`：completion status、budget incomplete、feedback events；不要继续描述与代码不符的 budget 预扣/并发语义。
- [ ] 同步公开 `docs-site/zh/reference/cli.mdx` 及相关英文页；补 Human / Agent / CI 推荐命令。
- [ ] 如果 `RunSummary` / reporter 公共契约变化，更新对应 TSDoc、docs feature 与 source map。
- [ ] 删除文档和源码里把 `--quiet` 当当前能力的内容。
- [ ] 新增 memory，记录“spinner 定时重画 → 状态变化驱动”和“TTY/非 TTY → consumer profile”的设计翻案，并更新 `memory/INDEX.md`。

## 测试矩阵

### 纯状态与 renderer 单测

- [ ] reducer：每个事件后守恒，carry / early exit / error / budget / interrupt 不出现负数或悬空 running。
- [ ] Human：相同 frame 不写、4 fps 合并、elapsed 1 Hz、active slot 稳定、窄高终端折叠、failure clear/append/redraw、结束无残留 timer。
- [ ] Human 非 TTY：零 ANSI、零光标控制、30 秒空闲 heartbeat。
- [ ] Agent：30 秒空闲规则、durable event 重置、转义、failure cap、handoff token/行数预算。
- [ ] CI：60 秒空闲规则、单一 stdout 顺序、failure cap、最后 result 行、固定字段不本地化。
- [ ] Diagnostic 去重：19 个并发 attempt 报同一 warning，只永久输出一次并保留受影响计数。
- [ ] Failure storm：超过 profile 上限时只出现一次 suppressed 提示，summary/artifacts 保留全部失败。

### Runner / Results 集成

- [ ] reporter 收到 result 时 locator 已存在，并与落盘 result.json 相同。
- [ ] carry locator 原样保留；fresh 多 experiment locator 用统一 snapshotStartedAt 生成且无碰撞。
- [ ] budget unstarted、early-exit unstarted 分开计数，只有前者导致 incomplete。
- [ ] required/best-effort reporter 同时失败时：其它 reporter 仍收尾，completion 精确列出失败，退出码符合 profile。
- [ ] JSON/JUnit 原子写成功和失败路径；失败不留下半文件。
- [ ] 中断后已经完成的 attempt artifacts 可读，snapshot 明确 incomplete/interrupted。

### CLI spawn 验收

- [ ] `--output agent` 和 `--output ci` 全程无 ANSI。
- [ ] CI stdout 行顺序稳定，普通 failure 不落 stderr。
- [ ] `--output human` 在伪 TTY 中动态覆盖，不把 frame 追加进 scrollback。
- [ ] `--output human | cat` 自动使用 human plain fallback，不写 ANSI，也不改成 Agent handoff。
- [ ] auto：TTY、CI env、普通 pipe 三条路径分别选 human/ci/agent。
- [ ] `--dry` 在三 profile 下不创建 `.niceeval`、JSON、JUnit。
- [ ] `--quiet` 明确报未知 flag；仓库内无残留调用。

## 最终验收命令

仓库内：

```bash
pnpm run typecheck
pnpm test
pnpm docs:reference
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```

真实项目至少准备一个小矩阵和一个长矩阵，分别执行：

```bash
niceeval exp local --output human --force
niceeval exp compare --output human --max-concurrency 19 --force
niceeval exp compare --output agent --force >agent.out 2>agent.progress
CI=true NICEEVAL_LANG=en niceeval exp ci --output auto --strict \
  --json .niceeval/ci-summary.json --junit .niceeval/junit.xml >ci.log 2>ci.err
```

人工检查：

- Human 长矩阵停留至少 2 分钟，scrollback 没有重复 dashboard frame；失败永久行仍在。
- Agent progress 只有 start / 空闲 heartbeat / durable event，handoff 给出的 locator 可直接 `niceeval show @...`。
- CI 普通运行事件都在 `ci.log` 且顺序正确，`ci.err` 为空；JUnit/JSON 可解析。
- 故意制造 JSON 无权限、budget 耗尽、Ctrl+C，分别验证 required failure、incomplete、130。

## 删除与搜索验收

完成后搜索并逐项解释剩余命中：

```bash
rg -n "--quiet|QuietReporter|setInterval\(.*80|SPINNER|process\.stderr\.write|process\.stdout\.write|console\.(log|error|warn)" src test docs docs-site
```

允许保留的裸写只应位于：

- feedback sink 自己；
- run 尚未建立前的 CLI bootstrap 错误；
- 与 `exp` 无关且有自己输出契约的 `show` / `view` / `list` 等命令入口。

## 不接受

- 只给现有 `live.ts` 再补一个 ANSI 光标修复，而不建立状态/永久事件边界。
- 继续用 spinner interval 当主要重画时钟。
- 每个矩阵项预留一行，再靠终端高度截断掩盖规模问题。
- Agent/CI 解析 human 文案、i18n 字符串或表格列宽。
- 用 reporter 顺序让 Artifacts 先改写 result，从而“碰巧”给后续 reporter locator。
- 重新计算 carry locator，或混淆 snapshot startedAt 与 attempt startedAt。
- 底层模块在 active run 期间绕开 coordinator 裸写 stdout/stderr。
- required reporter 写失败仍退出 0。
- budget 未覆盖全部计划却输出 PASSED。
- 为兼容 `--quiet` 保留第四套反馈语义。
- JSON/JUnit 每个 attempt 后整文件重写，或写失败留下截断目标。
- 测试只比大段 ANSI snapshot，不单测 reducer 不变量、时钟和事件顺序。
