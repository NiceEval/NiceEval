# CLI —— 内部架构

这一篇讲 `niceeval` 命令行**怎么实现**:入口模块怎么分层、一次调用的数据从 argv 到退出码怎么流转,以及调度核心为什么用 Effect-TS、用在哪几处。面向要改这部分代码的人。

这不是命令 / flag 参考——命令、flag、环境变量、退出码这些面向用户的行为契约,单源在 `src/cli.ts` 的 `FLAG_OPTIONS` 各项 JSDoc,由 `pnpm docs:reference` 生成进 [`docs-site/zh/reference/cli.mdx`](../docs-site/zh/reference/cli.mdx)(英文版 `docs-site/reference/cli.mdx`)——要查某个 flag 干什么,去那里,不要在这篇找。`show` / `view` 各自的命令行为与真实输出示例见 [`feature/reports/show.md`](feature/reports/show.md) / [`feature/reports/view.md`](feature/reports/view.md)。

## 模块地图

```text
src/cli.ts              入口:parseArgs → 按 command 分派 → main() 收尾(退出码 / 中断处理)
├─ runner/discover.ts    发现 evals/ 与 experiments/
├─ runner/run.ts         调度核心:两级并发闸、指纹携带、budget、reporter 编排(Effect)
│  └─ runner/attempt.ts  单个 attempt 生命周期:沙箱/OTel 资源、超时、评分(Effect)
├─ runner/feedback/*     反馈 coordinator:profile 解析、纯 reducer、human/agent/ci renderer、终端 sink
├─ runner/reporters/*    Artifacts(默认 required)/ JUnit / Json(显式指定则 required)/ Braintrust(best-effort)
├─ show/index.ts         只读路径:解析落盘 result.json,渲染终端证据切面(不经 run.ts)
└─ view/index.ts         只读路径:起本地 server 或 --out 静态导出(不经 run.ts)
```

`show` 与 `view` 不依赖 `niceeval.config.ts`,不发现 eval、不跑 agent——它们直接读 `.niceeval/` 下已经落盘的快照(见 [Results](feature/results/architecture.md)),所以不进入 `run.ts` / `attempt.ts` 这条 Effect 调度链,是两条独立的同步-为主读取路径。

## 数据流:argv → 退出码

```text
process.argv
  → parseArgs()          # node:util parseArgs,表驱动 FLAG_OPTIONS;--diff=<path> 在此之前预扫成 diffPath
  → { command, positionals, flags }
  → --help / --version 直接输出退出,不需要 config
  → command 分派:
      view  → resolveViewInput → startViewServer / buildView(--out)   # 只读路径
      show  → runShow(cwd, positionals, flags)                        # 只读路径
      clean / init / watch → 各自的一次性动作,直接退出
      sandbox → 留存沙箱的 list / stop(读写 .niceeval/sandboxes.json,按条目 provider 名路由 detached 销毁;
                不读 config、不发现 eval,行为契约见 feature/sandbox/cli.md)
      list  → loadConfig + discoverEvals,打印后退出
      exp   → loadConfig + discoverEvals + discoverExperiments
              → 展开成 AgentRun[](每个 experiment 一条,--agent/--model 在此处直接拒绝)
              → 解析 --output profile(resolveOutputProfile:显式值 → stderr 是 TTY → CI 环境变量存在 → agent 兜底)
              → --dry 时按解析出的 profile 调对应 plan renderer 打印预览,不调用 agent、不建 reporters
              → 规划携带(planCarry,读上次结果决定哪些 (experiment, eval) 可跳过;算出的 reusedByExperiment
                同时喂给 RunFeedbackPlan 与 runEvals,dashboard/envelope 的"携入"展示与真实调度共用同一次判断)
              → 建对应 profile 的 renderer(human / agent / ci 三选一)+ 一个 FeedbackCoordinator,
                coordinator.start(plan) —— run 激活后终端只有这一个协调者(见下「反馈 coordinator」)
              → 建 reporters(ReporterRegistration[]):默认 Artifacts 与显式 --json/--junit 标 required,
                config.reporters 标 best-effort(见下「required reporter」)
              → 注册 SIGINT/SIGTERM 三级响应(见下)
              → runEvals({ config, evals, agentRuns, reporters, signal, priorResults, carryPlan, … })  # 进入 Effect 调度核心
              → 收尾:stopAllSandboxes() 兜底强清(只清运行清理集合;--keep-sandbox 留存的沙箱已在
                verdict 定稿时移出集合并登记注册表,见 feature/sandbox/architecture.md)
                → coordinator.stopDynamic() → 把 coordinator 累计的诊断
                折成 RunCompletion → coordinator.finish({ summary, completion, paths, json, junit }) 打印
                最终摘要与快照路径 → 按 CompletionStatus 与 evalLevelStats 折叠的 verdict 统一计算退出码
```

`exp` 是唯一进入 Effect 调度核心(`run.ts` → `attempt.ts`)的分支;其余命令要么是一次性的同步动作,要么是只读路径,不需要结构化并发或资源生命周期管理,因而不用 Effect(见下节)。

## 反馈 coordinator:一个 run 只有一个终端协调者

`--output` 选出的 profile 只决定"终端展示",不进入调度核心,也不是一种 `Reporter`。`Reporter`
(`onEvent` / `onRunStart` / `onEvalComplete` / `onRunComplete`)只负责把完成结果写到别处(artifacts、
JSON、JUnit、Braintrust、用户自定义平台);`cli.ts` 不再构造 `Console` / `Live` / `Quiet` 这类兼职当展示层
的 reporter,三种 profile 各自的展示逻辑全部收在 `src/runner/feedback/`:

```text
runner/feedback/
├─ io.ts          可注入 FeedbackIO(stdout/stderr、isTTY/columns/rows、clock)——测试用假实现,不 monkey-patch 全局 process
├─ profile.ts     resolveOutputProfile() 纯函数:auto 检测(显式值 → TTY → CI 环境变量 → agent 兜底)
├─ reducer.ts     纯 reducer:RunFeedbackEvent → RunFeedbackState(total = reused + running + queued + completed 不变量)
├─ renderer.ts    FeedbackRenderer 接口(appendDurable 必需;clearDynamic / redrawDynamic / activity / onTick / onLifecycle 可选)
├─ human.ts       TTY dashboard + 非 TTY 追加流两种模式,共用同一份 renderDurableLines() 保证文案一致
├─ agent.ts       固定 ASCII envelope,30 秒空闲才 heartbeat,收尾给有界 handoff block
├─ ci.ts          单一有序 stdout 事件流,60 秒空闲才 heartbeat,computeCiExitCode() 统一算退出码
├─ sink.ts        底层模块调用的转发面(reportActivity / reportDiagnostic / reportAttemptLifecycle / …)
└─ coordinator.ts createFeedbackCoordinator():内部串行队列保证 clear → append → redraw 顺序;
                   stopDynamic()(停 tick、清 dashboard)→ finish()(reporter 收尾之后打印最终摘要)两阶段收尾
```

run 激活后(`coordinator.start(plan)` 之后),全部诊断——sandbox provisioning retry 耗尽、budget 不可执行、
reporter 失败、Ctrl+C 中断——都经 `sink.ts` 的 `reportActivity` / `reportDiagnostic` /
`reportAttemptLifecycle` 等函数转发给当前活跃的 coordinator,下层模块(`sandbox/*`、`runner/run.ts`、
`runner/report.ts`)不允许直接裸写 stdout/stderr。`sink.ts` 按调用栈维护"当前哪个 coordinator 活跃"
(而不是裸单例,给测试里同进程内多次 `runEvals()` 留出隔离空间),run 未激活或 coordinator 尚未构造时
回退到 `src/tty-line.ts` 的 bootstrap stderr 出口,保证 argv / config 解析错误仍然可见。

### required reporter

`cli.ts` 给每个 `Reporter` 实例包一层 `ReporterRegistration { reporter, name, required, target? }`:默认
`Artifacts`、显式 `--json` / `--junit` 标 `required: true`——它们是 agent / CI 读结果的唯一权威入口,写
失败必须让 completion / 退出码判红;`config.reporters` 标 `required: false`,失败只折成一条 diagnostic,
不影响 completion 也不阻断其它 reporter 收尾或在飞的 attempt。`src/runner/report.ts` 的 `runReporter()`
统一吞掉每次回调抛出的异常,按 `reg.name` 去重折叠成一条 `reporter-error:<name>` diagnostic;
`reg.required` 决定它是否写进最终 `RunCompletion.reporterErrors` 并让 completion 非 `complete`。

### locator 提前生成

`runEvals()` 在展开/调度任何 attempt 之前就确定好本次 invocation 的 `snapshotStartedAt`;每个 fresh
attempt 完成后,在广播 `eval:complete` 或触发任何 reporter 回调之前,`run.ts` 立即算出
`result.locator = encodeAttemptLocator({ experimentId, snapshotStartedAt, evalId, attempt })` 并写回
`EvalResult`。Artifacts writer 落盘时经 `RunShape.snapshotStartedAt` 拿到同一个锚点,不再各自按"该
experiment 第一条完成 result 的 attempt startedAt"猜——reporter 的 `onEvalComplete`、feedback
coordinator 的 `failure` 事件与 `niceeval show` 读到的 `result.json` 看到的都是同一个最终 locator。
携带(`--resume` 合入)条目原样保留旧 locator,不按当前 invocation 重算。

## flag 解析:表驱动,单源

`FLAG_OPTIONS`(`src/cli.ts`)是 `node:util` `parseArgs` 的 options 表,每一项的 JSDoc 注释就是它在生成的 CLI 参考页 flag 表里的说明——改 flag 语义只改这条注释,不用碰生成脚本(`scripts/generate-reference.ts`)。`--no-x` 形式的负向 flag 显式声明成独立表项(而不是依赖 `parseArgs` 的 `allowNegative`,后者要求 Node 20.14+,而 `engines` 只保证 >=18)。`strict: true` 让未知 flag 直接报错,不静默吞掉后面的位置参数。

表驱动解析之外唯一的机制例外是**可选值 flag 预扫**:`--diff` 与 `--keep-sandbox` 都是布尔 flag(裸 `--diff` = 文件级摘要,裸 `--keep-sandbox` = 留存 failed/errored 现场),各自的 `=<value>` 形式(`--diff=<path>`、`--keep-sandbox=always`)必须在喂给 `parseArgs` 之前统一预扫出来。空格分隔的 `--diff <path>` 里 `<path>` 会被当成位置参数 = eval id 前缀,这是刻意的,不是 bug;`--keep-sandbox` 同理。

## Effect-TS 用在哪、为什么

Effect 只用在调度核心——`runner/run.ts`、`runner/attempt.ts`、`sandbox/resolve.ts` 的 `createSandbox`——不用在 `cli.ts` 本身,也不用在 `show` / `view` 的只读路径。三个具体问题决定了这条边界画在哪:

### 1. 两级并发闸,不是简单的信号量

`run.ts` 用 `Effect.forEach(attempts, ..., { concurrency: "unbounded" })`:每个 attempt 立刻有自己的 fiber,真正的并发上限由两级 `Effect.Semaphore` 把守(全局 `globalSem` + 可选的实验级 `runSem`)。关键设计是 preflight/body 两段拆分:

```typescript
const preflight = Effect.gen(function* () { /* 首过即停、budget 检查——不持有任何 semaphore */ });
const body      = Effect.gen(function* () { /* 真正跑 attempt——占 globalSem 一个 permit */ });
const gated     = Effect.gen(function* () {
  const proceed = yield* preflight;
  if (!proceed) return;
  yield* globalSem.withPermits(1)(body);
});
return runSem ? runSem.withPermits(1)(gated) : gated;
```

preflight(要不要跑这个 attempt)不占 permit——它是即时返回的判断,占着全局并发槽位空等没有意义。`runSem`(实验级 `maxConcurrency`)包住整个 `gated`,因为它是该实验的私有资源,串行化"必须串行"的实验(如跨 eval 累积记忆状态)不该占用别的实验的并发位。获取定序恒为 `runSem → globalSem`,不会死锁。

### 2. 资源生命周期:`Effect.scoped` + `acquireRelease` 保证释放

一次 attempt 要创建再停掉沙箱、要开再关 OTel 接收器。这两样用 `Effect.acquireRelease` 包住:

```typescript
// sandbox/resolve.ts
Effect.acquireRelease(
  Effect.promise<Sandbox>(async () => /* create */),
  (sb) => Effect.promise(() => stopSandbox(sb)),
);
```

`attempt.ts` 把整个 attempt body 包进 `Effect.scoped(...)`:无论 body 成功、抛错,还是被中断(Ctrl+C),`Scope` 的 finalizer 都保证跑完——容器一定会被 `stop()`,OTel 接收器一定会被 `close()`。这是"不留孤儿沙箱"承诺的实现机制,不是靠 `try/finally` 手写覆盖每条退出路径。

### 3. 取消是一等信号,不是事后检查

`cli.ts` 的 SIGINT/SIGTERM 处理器创建一个 `AbortController`，在收到信号后调用 `abort()`，再把 `ctrl.signal` 作为 `runEvals()` 的输入交给 runner。`src/runner/run.ts` 负责把这个 signal 传给 `Effect.runPromiseExit`；这一层才完成从 Node `AbortSignal` 到 Effect fiber 中断的桥接：

```typescript
const exit = await Effect.runPromiseExit(
  Effect.forEach(attempts, ..., { concurrency: "unbounded", discard: true }).pipe(
    Effect.catchAllCause((cause) =>
      Cause.isInterrupted(cause) ? Effect.void : Effect.failCause(cause),
    ),
  ),
  { signal: ctrl.signal },
);
```

`runPromiseExit`（而非 `runPromise`）返回一个 `Exit` 而不抛错，让 runner 把“用户按了 Ctrl+C”当成正常的部分结果收尾（用已完成的 results 出一份汇总），而不是让中断变成一条看起来像 bug 的崩溃栈。`catchAllCause` 把中断类的 `Cause` 咽下、非中断的意外照常上抛——这两类必须分开处理，否则一次 Ctrl+C 要么被误判成真缺陷，要么真缺陷被误当成正常中断吞掉。

每个 attempt 自己还有硬性的超时边界(`Effect.timeoutTo`),独立于外层的用户中断信号:到点中断整段 body、触发 `Scope` release(停容器),产出一条 `errored` 结果——即便 adapter 完全无视传给它的 signal 也能被这层拦下来,这是"一个卡死的 attempt 不会挂起整批"承诺的硬边界,`run.ts` 层面的两级并发闸解决不了这个问题(它只管发不发新 attempt,不管已经在飞的会不会卡死)。

### 为什么 `cli.ts` 本身不用 Effect

`cli.ts` 的职责到 `runEvals({ ..., signal: ctrl.signal })` 这一次调用为止就结束了——它构造 `AbortController`、组装调度所需的数据(`AgentRun[]`、reporters、并发上限),然后把控制权和一个 `AbortSignal` 交给调度核心,自己不持有任何需要跨越成功/失败/中断都保证释放的资源。`show` / `view` 同理:读一份落盘的 JSON、渲染、退出,没有需要结构化并发或跨路径资源清理的场景。Effect 在这里买的是两样东西——"资源释放不看退出路径"和"结构化取消"——只在真正有并发 attempt、真正持有沙箱/网络资源的调度核心才用得上这两样;把这套机制铺到线性的 argv 解析或一次性的同步读取路径上,只是仪式,不解决任何问题。

## 中断:三级响应

```text
第 1 次 Ctrl+C   → ctrl.abort() → Effect 收到中断信号 → 各 attempt 的 Scope 跑 release(优雅停容器)
                   同时起 12s 看门狗:到点若仍有存活沙箱,直接强清
第 2 次 Ctrl+C   → 立即强清(stopAllSandboxes,带超时)后退出,不再等优雅路径
第 3 次 Ctrl+C   → 硬退(process.exit),此时多半已无可清理的
```

目标是任何情况下都不留**无主**沙箱:每个沙箱要么在本次 run 的清理集合里——退出前必被 stop,第 1 次 Ctrl+C 给 Effect 的 Scope finalizer 一个机会走优雅路径,用户等不及时第 2 次直接兜底强清,`main()` 的顶层 `.catch()` 对真·崩溃路径同样先 `stopAllSandboxes()` 再退出,三条路径共用同一个兜底函数;要么已按 [`--keep-sandbox`](feature/sandbox/cli.md) 在 verdict 定稿时移出清理集合、登记进留存注册表(`niceeval sandbox list` 可见、`stop` 可清)。不存在第三种状态。中断时刻尚无 verdict 的 attempt 拿不到留存授予,照常被清。

## 相关阅读

- [Experiments · CLI 反馈模型](feature/experiments/cli.md) —— human / agent / ci 三种 profile 的完整行为契约(什么时候动态覆盖、什么时候永久追加、示例输出)——这篇讲行为,本篇讲 coordinator/reporter 的接线方式。
- [Runner](runner.md) —— 调度行为的契约(并发、首过即停、budget、完成状态、退出码、指纹缓存)——这篇讲行为,本篇讲这些行为背后的 Effect 机制。
- [Sandbox · Architecture](feature/sandbox/architecture.md) —— `acquireRelease` 在 provider 创建上的另一处用法、provisioning 重试如何临时归还并发槽位。
- [Show](feature/reports/show.md) / [View](feature/reports/view.md) —— 这两条只读命令各自的行为与真实输出。
- [docs-site CLI 参考](../docs-site/zh/reference/cli.mdx) —— 面向用户的命令 / flag / 环境变量文档。
