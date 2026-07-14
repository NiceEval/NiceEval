# Phase Timings 与安装基准

本机制由两部分组成：写入每个 Attempt 的阶段计时契约，以及直接调用单次 Attempt 引擎的安装基准工作台。`AttemptRecord.phases` 的持久化类型单归 [Results Format](../../feature/results/architecture.md)，本篇定义阶段边界语义与基准消费方式。

## 要回答的问题

横向对比 sandbox provider 与 adapter 的**安装速度**和**安装正确率**:docker / e2b / vercel 谁起得快、起得稳;codex / claude-code / bub 在各家沙箱里装 CLI 要多久、装挂的概率多大。这既是优化冷启动的前提(测不到就没法优化),也是超时归因的前提——一个 attempt 顶到 `timeoutMs`,到底是 agent 干活慢,还是 setup / 模型预热吃掉了预算,现在的数据回答不了。

Attempt 级总 `durationMs` 无法区分沙箱创建、环境钩子、依赖安装、CLI 安装、逐轮 send 与评分，也无法指出 errored 结果终止在哪个阶段。进度 `log()` 是人读的临时反馈，不构成可持久化、可聚合的机器口径。

设计分两层:**① 契约层** —— 每个 attempt 落盘 per-phase 计时(`phases` 字段),让每一次正常的 eval 运行都自动是一次采样;**② 基准层** —— `bench/` 直接调用 runner 内部单次 attempt 引擎的一组脚本,与单元测试、CI 门禁都无关,本地随手可跑:优化安装路径时改一版实现、跑一轮基准、和上一轮快照对比。

## 契约:`AttemptRecord.phases`

`result.json` 的 `AttemptRecord`（同时是内存里的 `EvalResult`）包含一个可选字段：

```typescript
interface AttemptRecord {
  // …既有字段不变…
  /** 阶段计时,按执行顺序;只记实际发生的阶段。缺失 = 旧数据或非 runner 产出。 */
  phases?: PhaseTiming[];
}

interface PhaseTiming {
  /** 阶段名,取全仓唯一的 LifecyclePhase 闭集(见下表)。 */
  name: LifecyclePhase;
  /** 该阶段耗时;failed 条目计到抛错 / 超时中断那一刻。 */
  durationMs: number;
  /** 该阶段抛错或超时中断。主链至多一条,其后无主链条目;收尾阶段各自独立标记。 */
  failed?: true;
  /** Runner 直接观察到的时间树(hook / turn / command / provider operation);不参与聚合。 */
  children?: TimingNode[];
}
```

`LifecyclePhase` 闭集与 `PhaseTiming` / `TimingNode` 的类型定义单归 [Results Format](../../feature/results/architecture.md#resultjson),这里不复写第二份;本篇定义各阶段的边界语义与消费方式。

### 阶段边界

阶段边界与[沙箱生命周期](../../feature/sandbox/architecture.md#沙箱在生命周期里的位置)的固定调用链一一对应:

| name | 覆盖 | 何时缺席 |
| --- | --- | --- |
| `sandbox.queue` | 等待容器创建信号量(并发限流)的排队时间 | remote agent |
| `sandbox.create` | provider 起沙箱(`createSandbox`) | remote agent |
| `sandbox.setup` | `SandboxSpec.setup()` 钩子链,phase 级合计一条,`children` 逐 hook 并继续展开沙箱命令 | remote agent / 没挂钩子 |
| `workspace.baseline` | git init + 空基线 commit | remote agent |
| `eval.setup` | `EvalDef.setup` | 没定义 |
| `agent.setup` | `Agent.setup`(装 CLI、写主配置;**安装基准的主角**) | 没定义 |
| `telemetry.configure` | tracing 出口配置(file-based OTLP) | 没配 tracing |
| `eval.run` | 整段 `test(t)`,含所有 `send` 与手工命令;`children` 保存手工命令与逐 session/turn 包络 | 从不缺席 |
| `agent.run` | 嵌套在 `eval.run` 内的 adapter send 窗口;只作错误/诊断归因,不单列计时条目 | (不出现在 `phases`) |
| `workspace.diff` | 采 `git diff`(`captureGeneratedFiles`) | remote agent / skipped |
| `scoring.evaluate` | 断言 finalize + 判定,含 judge 调用 | skipped 时为空集但仍记 |
| `telemetry.collect` | OTLP receiver settle / collect(有固定的落地等待窗口) | 没起 receiver |
| `eval.teardown` | `EvalDef.setup` 返回的 cleanup 函数 | setup 没返回 cleanup |
| `agent.teardown` | `Agent.teardown` | 没定义 |
| `sandbox.teardown` | `SandboxSpec.teardown()` 钩子链,phase 级合计一条,`children` 逐 hook 并继续展开沙箱命令 | remote agent / 没挂钩子 |
| `sandbox.stop` | provider 销毁沙箱(`sandbox.stop()`) | remote agent |

`sandbox.queue` 到 `telemetry.collect` 是**主链**,覆盖到判定与主证据收集完成;`eval.teardown` / `agent.teardown` / `sandbox.teardown` / `sandbox.stop` 是**收尾段**,主链成败都执行,顺序与 setup 对称颠倒(eval 先收、环境层最后收)。最终 `AttemptRecord` 在两段都结束后才组装,但 `durationMs` 的计量终点仍是主链末端。语义规则:

- **只记实际发生的阶段**。没跑到、不适用(remote agent 的 `sandbox.*`)、没定义(可选钩子)都不落条目——缺席本身就是信息,不用 0 占位制造二义。主链在某一步抛错时,该步之前已经执行的收尾动作照常记录(如 `sandbox.create` 失败则整个收尾段缺席——沙箱从未存在)。
- **顺序即执行序**,与生命周期文档的调用链一致;收尾段总排在主链条目之后。
- **错误归因**:主链阶段抛错时,该条目以抛错时刻封口并标 `failed: true`,其后无主链条目。errored 结果「死在哪一步」= 主链最后一条 `failed` 条目,不设单独的 `failedPhase` 字段(可从数组一行推导的东西不重复落盘)。收尾阶段的 `failed` 各自独立:teardown 失败是 diagnostic、不改判定,所以一个 passed attempt 也可以带一条 `failed` 的 `sandbox.teardown`。
- **超时归因**:计时收集器在阶段开始时即登记 open 条目,attempt 总超时(`Effect.timeoutTo`)中断整段 body 时,超时路径构造的结果同样携带已收集的 phases,in-flight 阶段以中断时刻封口并标 `failed`——「顶到 timeoutMs 的 attempt 卡在哪」直接可读。
- **`durationMs` 口径**:`durationMs` 只覆盖主链,不含收尾——teardown 失败只是 diagnostic、不改判定,跨实验的判定耗时不该被收尾拖长。因此 ∑ 主链 phases ≤ `durationMs`(差值为阶段间粘合代码);收尾段条目在这个口径之外单独可读——「判定早已确定、进程还在等收尾」这类问题(teardown 钩子回存状态慢、provider stop 卡住)的归因数据就在这里。最终 record 虽在 Scope release 后才组装,也不把收尾反加进 `durationMs`。
- **`sandbox.queue` 单列**:容器创建被信号量限流,并发下排队等待可以远大于创建本身。混进 `sandbox.create` 会让「provider 起沙箱要多久」这个被测量被实验的并发度污染;单列后 create 的口径跨实验可比。
- **钩子链 phase 级合计、时间树逐层展开**:钩子是匿名用户代码,没有稳定标识,跨实验的聚合与对比只在 phase 层进行——`sandbox.setup` / `sandbox.teardown` 各合计一条。`children` 按链序逐 hook(具名函数用函数名,匿名用 `setup#<i>` / `teardown#<i>`),hook 内所有经 `Sandbox.runCommand()` / `runShell()` 发出的命令继续成为 child。时间树只回答单 attempt「慢在哪一层」,不做跨 attempt / 跨实验聚合。
- **所有沙箱命令统一捕获**:Sandbox 创建成功后只包一层中性接口,因此 `workspace.baseline`、`eval.setup`、`agent.setup`、`telemetry.configure`、`eval.run`、`workspace.diff` 与收尾阶段都能记录自己发出的公开 command。provider 内部 `runCommand`→`runShell` 的实现转调不重复记；Agent CLI 内部工具不经过该接口,仍由 events + OTel 提供。
- **turn 是 runner 包络,OTel 是轮内细节**:`eval.run.children` 的 turn 用 runner 单调时钟量 `send` 端到端耗时,并保存 session/turn 身份、`traceId` 与归属方式。消费方按 `traceId` 从 `trace.json` 临时挂接 agent/model/tool spans；没有 OTel 时 turn 耗时仍可用。
- **并发不可求和**:`startOffsetMs` 恢复 sibling 的先后与重叠。hook、command、turn 与 OTel span 都可能包含或并发,children duration 不可简单相加后同父节点比较。
- **命令证据有界且脱敏**:时间树只保存 command display、状态与 exit code；display 截断并脱敏,env value 和 stdout/stderr 不进入 `result.json`。安装期间的人读进度与诊断仍走 `ctx.progress` / `ctx.diagnostic`(见 [Experiments · 生命周期代码怎样向这次运行反馈](../../feature/experiments/library.md#生命周期代码怎样向这次运行反馈))。
- **Scope release 后封口**:`sandbox.stop` 与 receiver close 属于 Effect finalizer,共用 attempt timing recorder；Scope release 完成后才组装最终结果。finalizer 失败写 timing/diagnostic,不能让 body 先封口而丢失收尾事实。

### 形状与落点的裁决

- **为什么是有序数组而不是固定字段 record**:顺序天然携带「死在哪一步之前」;缺席语义干净(没跑 = 没条目,不用在 0 / undefined 之间选);新增阶段不改类型形状。聚合侧按 `name` 分组,和 record 一样是一行代码。
- **为什么住 `result.json` 而不是 OTel trace**:trace 是条件产物(agent 配了 tracing、receiver 起了才有),而 runner phase/hook/command/turn 计时必须无条件产出。phases 是判定记录旁的运行事实,家在权威记录里；`show --timing` 可以按 `traceId` 把两者组合成一个视图,但不因此把 runner 节点伪造成 OTel span,也不把 span 复制进 phases。
- **为什么不给进度行加时间戳再挖掘**:进度行是人读的 UI 文案,把它变成机器口径意味着改文案就破坏数据管道;计时和展示各自独立,共享的只是阶段边界这几个代码位置。
- **兼容性**:纯增量的可选字段与闭集增补,读取面「忠实磁盘、忽略未知字段」的契约不变,`schemaVersion` 不升。读取器读到闭集之外的阶段名时原样透传、渲染面按未知阶段列在末尾,不报错。携带条目(`--resume`)的 phases 随 `result.json` 原样携带。

### 消费边界

普通 `niceeval exp` 由 runner 写入 `phases`，`niceeval/results` 读取面原样透传。消费面有四个:

- **`niceeval show`**:attempt 首页的 `timing:` 行给主链分解与收尾合计;`--timing` 切面给 phase → hook/turn → command → OTel 的统一时间树。契约见 [Show](../../feature/reports/show.md#--timing整个-attempt-的统一时间树)。
- **`niceeval view`**:Attempt 详情的阶段耗时区,同一份 phases 的图形面。契约见 [View](../../feature/reports/view.md)。
- **结果读取 API**:`niceeval/results` 原样透传,聚合脚本按 `name` 分组。
- **`bench/`**:不经过 CLI,也不写 `.niceeval/result.json`;它直接调用 runner 的单次 Attempt 引擎,从内存返回值读取同一份 `phases`。与 CLI 路径共享阶段名和计时语义,只在是否经过 discover、是否持久化上不同。

Runner 时间树不写入 OTel trace,也不混入独立的 Traces 瀑布图——span 仍来自被测 agent(见 [Observability](../../observability.md)),phases 是 runner 侧运行事实。`show --timing` 与 Attempt 时间详情会在读取时按 turn `traceId` 组合两条数据；这只是展示投影,两类 artifact 仍各有各的家。

## 基准:`bench/` 直接调用的内部脚本

安装基准是仓库常备的**优化工作台**,与单元测试(`pnpm test`)和 CI 门禁都独立:目标读者是「正在优化冷启动 / checkpoint 缓存 / 安装脚本的人」,工作流是改一版实现 → 重跑基准 → 与上一轮快照对比,要的是「跑一次、当场看到数字」,不是「跑完再另开一步生成报告页」的两段式流程。因此 `bench/` **不是**一个 niceeval 项目——没有 `niceeval.config.ts`,没有 `evals/`/`experiments/` 走 CLI discover,也不吃 [Reports](../../feature/reports/README.md) 积木出页面。它是几个纯 TS 脚本,直接调用 runner 内部单次 attempt 的执行引擎,一条命令跑完直接把耗时表打印到终端:

```text
bench/
  probes.ts        # 每个 adapter 的「装完能不能用」探测命令(codex --version / uv tool list 等)
  stats.ts         # min/median/max、首个/后续分列、三类失败计数、noise-aware 对比判据——纯函数,无 IO
  run.ts           # 入口:tsx bench/run.ts <provider> [--runs 10],跑完直接打印
  compare.ts       # 入口:tsx bench/compare.ts <old.json> <new.json>,打印 regression/improvement/noise 判定
  .snapshots/      # run.ts 写的统计快照(本地数据,不进 git)
  README.md        # 跑法与运行纪律
```

不新建独立 package.json、不新增 package.json 命令:`bench/*.ts` 用仓库已有的 `tsx` 直接跑(`npx tsx bench/run.ts docker`),依赖解析走仓库根 `node_modules`,和其余「同目录写几行脚本直接执行」的仓库内部工具(如 `scripts/generate-reference.ts`)是同一类东西。

### 复用点:直接调 runner 的单次 attempt 引擎,不重新拼装顺序

单次 attempt 的执行序——沙箱就绪 → `sandbox.setup` 钩子链 → git baseline → `eval.setup` → `agent.setup` → `tracing.configure` → `send`(见[沙箱生命周期](../../feature/sandbox/architecture.md#沙箱在生命周期里的位置))——已经封在 `runAttemptBody`(`src/runner/attempt.ts`)里,包括错误处理、超时中断、teardown-on-error 这些容易漏的细节。`bench/` 与其在脚本里重新手搭 `AgentContext`(`session`/`log`/`signal`/`flags` 这些字段漏一个就是隐蔽 bug),不如直接从 `../src/runner/attempt.ts` 相对导入调用它——这和 `e2e/` 允许自己触达 niceeval 内部机制、不受制于对外发布的包边界是同一类「仓库内部工程工具的特权」:[E2E CI](../e2e-ci/README.md) 的 `verify.mjs` 黑盒起 CLI 子进程验证外部可观察行为,`bench/` 反过来直接调用内部函数拿第一手耗时——两者都不是"包外用户能做的事",都只在同一个仓库、同一次提交里和 runner 保持同步,`pnpm run typecheck` 天然守住调用签名不漂移。

探测 eval 用 `defineEval`(公开 API)在脚本里就地内联构造,不落 `.eval.ts` 文件、不经过 discover:

```typescript
// bench/probes.ts(节选)
import { defineEval } from "niceeval";

export const codexProbe = defineEval({
  description: "codex 装完能跑",
  async test(t) {
    const r = await t.sandbox.runCommand("codex", ["--version"]);
    if (r.exitCode !== 0) throw new Error(`codex --version exit ${r.exitCode}`);
  },
});
```

探测 **从不调用 `t.send()`**:`agent.setup`(装 CLI、写配置)由 `runAttemptBody` 在 `test(t)` 之前自动执行,耗时落在 `agent.setup` 阶段;`test(t)` 里只做正确性探测,零模型调用意味着零 token 成本,基准的开销只剩沙箱计算本身。正确率因此天然拆成三类,`run.ts` 分别计数:

- `sandbox.create` 阶段抛错 → **provider 起不来**(可靠性)。
- `agent.setup` 阶段抛错 → **安装脚本挂了**。
- 探测命令跑起来但 exitCode 非 0 → **装完但不可用**。

### `run.ts`:循环调用、当场打印

```sh
npx tsx bench/run.ts docker            # 本地快速迭代,免云凭据、免钱
npx tsx bench/run.ts e2b               # 需 E2B_API_KEY
npx tsx bench/run.ts docker --runs 10  # 默认也是 10(见下)
```

对给定 provider 下的每个 adapter,`run.ts` 直接 `for` 循环调用 `runAttemptBody`(sandbox 由该 provider 的 `dockerSandbox()` / `e2bSandbox()` / `vercelSandbox()` 构造),串行执行、不并发——串行让排队等待恒近 0、attempt 序号与冷 / 热次序一一对应。每次调用拿到的结果里带逐阶段耗时(对齐上节「契约:`AttemptRecord.phases`」的阶段名与语义);循环跑完,`stats.ts` 里的纯函数当场算出 min/median/max、首个 / 后续 attempt 分列、三类失败计数,`console.table` 直接打到终端——没有「先跑再另开一步 show --report」这一步。

默认 `--runs 10` 而不是更省事的个位数:装 CLI 零模型调用,10 次相对 5 次的沙箱开销可忽略,但对下节「新一轮中位数是否落在历史波动范围外」这类判读有实质影响——个位数样本的包络基本等于裸的 min/max,统计支撑太薄。

首个 attempt 与后续 attempt 分列打印,不报单一均值:bub 的 `ensureBub` 有进程内共享安装锁与 checkpoint 缓存回填,同一轮里只有首个 attempt 付冷装成本,`agent.setup` 呈冷 / 热双峰,均值在双峰下没有意义;分列直接读出缓存省了多少。

### `compare.ts`:两份快照的 noise-aware 判据

`run.ts` 顺手把算好的统计量(不是完整 attempt 记录)写一份 JSON 到 `bench/.snapshots/<provider>-<agent>-<timestamp>.json`,格式是 bench 自己的私有格式,不是 `.niceeval/` 的 Results Format。`compare.ts` 读两份快照、直接打印判定,同样是"调用即打印"的脚本,不经过任何渲染层:

```sh
npx tsx bench/compare.ts bench/.snapshots/docker-codex-<old>.json bench/.snapshots/docker-codex-<new>.json
```

判据是非参数的、按 (agent × phase × 首个/后续) 每个 cell 独立算,不假设正态分布(小样本、真实延迟分布本来就不正态):只有同时满足「效应量过阈值」(`|median_new − median_old| / median_old` ≥ 默认 10%)与「超出历史包络」(当前中位数落在 baseline 样本 `[min, max]` 之外)两条,才判定为 regression / improvement;否则打印「噪声范围内,不下结论」。两条门槛都保守偏「宁可漏报、不可误报」——`bench/` 是单人本地迭代工具,不是拦截合并的 CI 门禁,不引入 Mann-Whitney U 或其他假设检验:`min/max` 包络 + 效应量阈值这种可以口算复核的规则,比一个需要解释 p-value 含义的检验更适合这个场景。

`compare.ts` 顺带打印一次**缓存卫生检查**:如果当前快照「首个 attempt」(理应走冷装)的 `agent.setup` 耗时反而落进了历史「后续 attempt」(热装)的包络内,打一行警告——这是下面「运行纪律」里「忘清宿主缓存」这条人工纪律唯一能被机器兜住的信号,不保证抓全,但把「静默污染一整轮数据」变成「至少有一行警告可看」。

### 运行纪律

- **真冷装先清宿主缓存**。bub 的 checkpoint / uv 缓存落在宿主侧,跨进程存活;不清缓存跑出的「首个 attempt」是进程冷、宿主热。清哪些路径写在 `bench/README.md`;`compare.ts` 的缓存卫生检查是这条人工纪律的机器兜底,不是替代品。基准不引入显式 cold / warm 标记；首个 / 后续分列与按需清缓存共同定义冷、热口径。
- **`sandbox.create` 的读数只测容器起停,不测镜像拉取**。跑 bench 之前统一 `docker pull` 预热用到的基础镜像(或固定 digest,保证跨快照镜像层缓存状态一致),不把「这次要不要拉镜像」设计成第二组冷 / 热变量——那会让 `sandbox.create` 失去跨快照可比性。真要测镜像拉取速度是另一个问题,不在这份基准范围内。
- **一个矩阵一个进程**。全矩阵逐 provider 串行跑,绝不并行多个 `run.ts` 进程指向同一批 provider(避免无意义的资源争抢和难以复现的抖动)。
- **结果不进 git**:`bench/.snapshots/` 是本地测量数据。
- **与 e2e 的边界**:[E2E CI](../e2e-ci/README.md) 的沙箱矩阵管适配层**回归门禁**(nightly、真实任务、真模型);bench 管安装路径的**优化迭代**(本地随手跑、不调模型)。互不依赖,bench 不进任何 CI,也不进 `pnpm test`——vitest 层守护的是计时机制本身(见下节),`bench/*.ts` 本身和 e2e 一样不受这条约束。

## 框架自测:计时机制的 vitest 守护

复用 `test/fixtures/sandbox-hooks` 这条既有 e2e 流水线(内存假 sandbox + mock send + 真实 CLI,全程不联网、不起容器)——它已经覆盖 setup 全序与抛错路径,phases 是同一条流水线的另一个观察面,新增断言不新增 fixture:

1. **全序与闭集**:成功 attempt 的 `result.json` 里 phases 顺序与生命周期一致,阶段名全部落在 `LifecyclePhase` 闭集内且不含 `agent.run`,`durationMs ≥ 0` 且 ∑ 主链 phases ≤ 总 `durationMs`;收尾段条目总排在主链之后。
2. **错误归因**:`sandbox.setup` 抛错的 fixture,主链止于 `sandbox.setup` 且该条 `failed: true`,其后无主链条目(`agent.setup` 从未出现);已创建沙箱的收尾段照常有条目。
3. **remote 无沙箱阶段**:remote agent 的结果不含任何 `sandbox.*` / `workspace.*` 条目。
4. **收尾独立 failed**:teardown 钩子抛错的 fixture,`sandbox.teardown` 条目标 `failed: true`、`sandbox.stop` 照常记录,verdict 不因此改变。
5. **时间树与命令归属**:挂多个 setup 钩子的 fixture,`sandbox.setup.children` 逐 hook 有条目、顺序与链序一致；每个 hook 发出的 `runCommand` / `runShell` 只出现一次并挂在正确 hook 下。`agent.setup`、`workspace.baseline` 与 teardown 命令同样落在各自 phase。
6. **并发与单调时钟**:两个并发 command 的 `startOffsetMs` 可以重叠,不能被串成虚假的顺序；wall-clock 跳变不产生负 duration。
7. **turn 与 OTel 关联**:多 session、多 turn fixture 产生 `s1/t1`、`s2/t1` 等结构化身份；有 traceparent 时保存 traceId/attribution,无 OTel 时 turn duration 仍存在。
8. **归因与计时同词表**:构造一个 send 内抛错的 fixture,`error.phase` 为 `agent.run`、`phases` 主链止于 `eval.run`——两个字段取值都在同一个 `LifecyclePhase` 闭集内。

## 相关阅读

- [Sandbox · 沙箱在生命周期里的位置](../../feature/sandbox/architecture.md#沙箱在生命周期里的位置) —— phases 阶段边界的出处,也是 `runAttemptBody` 执行序的出处。
- [Results Format](../../feature/results/architecture.md) —— `result.json` 的权威记录契约与 `phases` 字段。
- [E2E CI](../e2e-ci/README.md) —— 回归门禁侧的沙箱矩阵,与 bench 的分工见「运行纪律」;`bench/` 触达 runner 内部函数与 e2e 触达 CLI 子进程是同一类仓库内部特权。
- [Observability](../../observability.md) —— 为什么 phases 不走 OTel trace。
