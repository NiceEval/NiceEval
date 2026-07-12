# Phase Timings 与安装基准

落地时 [Results Format](../results-format.md) 的 `AttemptRecord` 小节按本文重写。分期见文末。

## 要回答的问题

横向对比 sandbox provider 与 adapter 的**安装速度**和**安装正确率**:docker / e2b / vercel 谁起得快、起得稳;codex / claude-code / bub 在各家沙箱里装 CLI 要多久、装挂的概率多大。这既是优化冷启动的前提(测不到就没法优化),也是超时归因的前提——一个 attempt 顶到 `timeoutMs`,到底是 agent 干活慢,还是 setup / 模型预热吃掉了预算,现在的数据回答不了。

现状的缺口:`EvalResult` 只有 attempt 级总 `durationMs`,沙箱创建、环境钩子、装依赖、装 CLI、逐轮 send、评分全部糊在一个数里;errored 结果也没有「死在哪个阶段」的归因。阶段边界在 `runAttemptBody` 里以进度 `log()` 行的形式早已存在,但进度行是给人看的、只保留最近 20 条、不落盘,不构成机器口径。

设计分两层:**① 契约层** —— 每个 attempt 落盘 per-phase 计时(`phases` 字段),让每一次正常的 eval 运行都自动是一次采样;**② 基准层** —— `bench/` 直接调用 runner 内部单次 attempt 引擎的一组脚本,与单元测试、CI 门禁都无关,本地随手可跑:优化安装路径时改一版实现、跑一轮基准、和上一轮快照对比。

## 契约:`AttemptRecord.phases`

`result.json` 的 `AttemptRecord`(同时是内存里的 `EvalResult`)新增一个可选字段:

```typescript
interface AttemptRecord {
  // …既有字段不变…
  /** 阶段计时,按执行顺序;只记实际发生的阶段。缺失 = 旧数据或非 runner 产出。 */
  phases?: PhaseTiming[];
}

interface PhaseTiming {
  /** 阶段名,闭集(见下表)。 */
  name: PhaseName;
  /** 该阶段耗时;failed 条目计到抛错 / 超时中断那一刻。 */
  durationMs: number;
  /** 该阶段抛错或超时中断。至多一条,总在数组末尾;它之后的阶段没有跑。 */
  failed?: true;
}
```

### 阶段名闭集

阶段边界与[沙箱生命周期](../sandbox.md#沙箱在生命周期里的位置)的固定调用链一一对应:

| name | 覆盖 | 何时缺席 |
| --- | --- | --- |
| `sandbox.queue` | 等待容器创建信号量(并发限流)的排队时间 | remote agent |
| `sandbox.create` | provider 起沙箱(`createSandbox`) | remote agent |
| `sandbox.setup` | `SandboxSpec.setup()` 钩子链,全链合计一条 | remote agent / 没挂钩子 |
| `baseline` | git init + 空基线 commit | remote agent |
| `eval.setup` | `EvalDef.setup` | 没定义 |
| `agent.setup` | `Agent.setup`(装 CLI、写主配置;**安装基准的主角**) | 没定义 |
| `agent.tracing` | `tracing.configure`(file-based OTLP 配置) | 没配 tracing |
| `test` | 整段 `test(t)`,含所有 `send` 与手工命令 | 从不缺席 |
| `diff` | 采 `git diff`(`captureGeneratedFiles`) | remote agent / skipped |
| `score` | 断言 finalize + 判定,含 judge 调用 | skipped 时为空集但仍记 |
| `trace` | OTLP receiver settle / collect(有固定的落地等待窗口) | 没起 receiver |

语义规则:

- **只记实际发生的阶段**。没跑到、不适用(remote agent 的 `sandbox.*`)、没定义(可选钩子)都不落条目——缺席本身就是信息,不用 0 占位制造二义。
- **顺序即执行序**,与生命周期文档的调用链一致。
- **错误归因**:阶段抛错时,该条目以抛错时刻封口并标 `failed: true`,其后无条目。errored 结果「死在哪一步」= 数组最后一条 `failed` 条目,不设单独的 `failedPhase` 字段(可从数组一行推导的东西不重复落盘)。
- **超时归因**:计时收集器在阶段开始时即登记 open 条目,attempt 总超时(`Effect.timeoutTo`)中断整段 body 时,超时路径构造的结果同样携带已收集的 phases,in-flight 阶段以中断时刻封口并标 `failed`。这样「顶到 timeoutMs 的 attempt 卡在哪」直接可读,不再靠最近进度行猜。
- **口径与 `durationMs` 对齐**:phases 覆盖到结果构造为止,teardown 不计——`durationMs` 本就不含 teardown,且 teardown 失败只是 diagnostic、不改判定;两个字段保持同一时间口径,∑ phases ≤ `durationMs`(差值为阶段间粘合代码)。
- **`sandbox.queue` 单列**:容器创建被信号量限流,并发下排队等待可以远大于创建本身。混进 `sandbox.create` 会让「provider 起沙箱要多久」这个被测量被实验的并发度污染;单列后 create 的口径跨实验可比。
- **`sandbox.setup` 钩子链合计一条**:钩子是匿名用户代码,没有稳定标识,分列的条目名跨实验不可比;钩子内部需要细分时自己 `log()`。

### 形状与落点的裁决

- **为什么是有序数组而不是固定字段 record**:顺序天然携带「死在哪一步之前」;缺席语义干净(没跑 = 没条目,不用在 0 / undefined 之间选);新增阶段不改类型形状。聚合侧按 `name` 分组,和 record 一样是一行代码。
- **为什么住 `result.json` 而不是 OTel trace**:trace 是条件产物(agent 配了 tracing、receiver 起了才有),而阶段计时必须无条件产出;且 [Observability](../observability.md) 的契约是 span 只来自被测 agent、只喂瀑布图——runner 自己的阶段 span 混进去会污染跨 agent 对比语义。phases 是判定记录旁的运行事实,家在权威记录里。
- **为什么不给进度行加时间戳再挖掘**:进度行是人读的 UI 文案,把它变成机器口径意味着改文案就破坏数据管道;计时和展示各自独立,共享的只是阶段边界这几个代码位置。
- **兼容性**:纯增量的可选字段,读取面「忠实磁盘、忽略未知字段」的契约不变,`schemaVersion` 不升。携带条目(`--resume`)的 phases 随 `result.json` 原样携带。

### 消费面(一期范围)

一期只落数据:runner 写入 + `niceeval/results` 读取面透传(`AttemptRecord` 加字段即自动读回),这是常规 `niceeval exp` 跑法(经 CLI、落 `result.json`)的消费路径。下节 `bench/` 是另一条更直接的消费路径:它不经过 CLI、不落 `.niceeval/result.json`,而是直接调用 runner 内部单次 attempt 引擎,`phases` 随返回值在内存里原样拿到——两条路径吃的是同一份 `phases` 字段,只是落盘与否、经不经过 discover 不同。`show` / `view` 的内建阶段分段展示不在本提案内,等基准跑出真实数据、知道哪种聚合视图有用之后再设计。

## 基准:`bench/` 直接调用的内部脚本

安装基准是仓库常备的**优化工作台**,与单元测试(`pnpm test`)和 CI 门禁都独立:目标读者是「正在优化冷启动 / checkpoint 缓存 / 安装脚本的人」,工作流是改一版实现 → 重跑基准 → 与上一轮快照对比,要的是「跑一次、当场看到数字」,不是「跑完再另开一步生成报告页」的两段式流程。因此 `bench/` **不是**一个 niceeval 项目——没有 `niceeval.config.ts`,没有 `evals/`/`experiments/` 走 CLI discover,也不吃 [Reports](../reports.md) 积木出页面。它是几个纯 TS 脚本,直接调用 runner 内部单次 attempt 的执行引擎,一条命令跑完直接把耗时表打印到终端:

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

单次 attempt 的执行序——沙箱就绪 → `sandbox.setup` 钩子链 → git baseline → `eval.setup` → `agent.setup` → `tracing.configure` → `send`(见[沙箱生命周期](../sandbox.md#沙箱在生命周期里的位置))——已经封在 `runAttemptBody`(`src/runner/attempt.ts`)里,包括错误处理、超时中断、teardown-on-error 这些容易漏的细节。`bench/` 与其在脚本里重新手搭 `AgentContext`(`session`/`log`/`signal`/`flags` 这些字段漏一个就是隐蔽 bug),不如直接从 `../src/runner/attempt.ts` 相对导入调用它——这和 `e2e/` 允许自己触达 niceeval 内部机制、不受制于对外发布的包边界是同一类「仓库内部工程工具的特权」:[E2E CI](e2e-ci.md) 的 `verify.mjs` 黑盒起 CLI 子进程验证外部可观察行为,`bench/` 反过来直接调用内部函数拿第一手耗时——两者都不是"包外用户能做的事",都只在同一个仓库、同一次提交里和 runner 保持同步,`pnpm run typecheck` 天然守住调用签名不漂移。

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

- **真冷装先清宿主缓存**。bub 的 checkpoint / uv 缓存落在宿主侧,跨进程存活;不清缓存跑出的「首个 attempt」是进程冷、宿主热。清哪些路径写在 `bench/README.md`;`compare.ts` 的缓存卫生检查是这条人工纪律的机器兜底,不是替代品。一期不做显式 cold / warm 标记:标记需要扩展 adapter 契约(由谁上报「这次走了 checkpoint 恢复」),而「分列 + 按需清缓存」已覆盖判读需要。
- **`sandbox.create` 的读数只测容器起停,不测镜像拉取**。跑 bench 之前统一 `docker pull` 预热用到的基础镜像(或固定 digest,保证跨快照镜像层缓存状态一致),不把「这次要不要拉镜像」设计成第二组冷 / 热变量——那会让 `sandbox.create` 失去跨快照可比性。真要测镜像拉取速度是另一个问题,不在这份基准范围内。
- **一个矩阵一个进程**。全矩阵逐 provider 串行跑,绝不并行多个 `run.ts` 进程指向同一批 provider(避免无意义的资源争抢和难以复现的抖动)。
- **结果不进 git**:`bench/.snapshots/` 是本地测量数据。
- **与 e2e 的边界**:[E2E CI](e2e-ci.md) 的沙箱矩阵管适配层**回归门禁**(nightly、真实任务、真模型);bench 管安装路径的**优化迭代**(本地随手跑、不调模型)。互不依赖,bench 不进任何 CI,也不进 `pnpm test`——vitest 层守护的是计时机制本身(见下节),`bench/*.ts` 本身和 e2e 一样不受这条约束。

## 框架自测:计时机制的 vitest 守护

复用 `test/fixtures/sandbox-hooks` 这条既有 e2e 流水线(内存假 sandbox + mock send + 真实 CLI,全程不联网、不起容器)——它已经覆盖 setup 全序与抛错路径,phases 是同一条流水线的另一个观察面,新增断言不新增 fixture:

1. **全序与闭集**:成功 attempt 的 `result.json` 里 phases 顺序与生命周期一致,阶段名全部落在闭集内,`durationMs ≥ 0` 且 ∑ phases ≤ 总 `durationMs`。
2. **错误归因**:`sandbox.setup` 抛错的 fixture,phases 止于 `sandbox.setup` 且该条 `failed: true`,其后无条目(`agent.setup` 从未出现)。
3. **remote 无沙箱阶段**:remote agent 的结果不含任何 `sandbox.*` / `baseline` / `diff` 条目。

## 分期

1. **一期(契约落地)**:runner 计时收集器 + `phases` 落盘 + results lib 类型透传 + 上节 vitest 断言;`docs/results-format.md` 的 `AttemptRecord` 小节按本文重写。
2. **二期(基准落地)**:建 `bench/`(`probes.ts` + `stats.ts` + `run.ts` + `compare.ts`,直接调用 `runAttemptBody`),产出首份 agent × provider 安装速度 / 正确率榜;此后凡动冷启动、checkpoint、安装脚本的优化,以 bench 前后快照对比为验证手段。
3. **三期(按需)**:`show` / `view` 的内建阶段分段展示、Reports 计算函数——形态由二期的真实数据反推,不预先定型。

## 相关阅读

- [Sandbox · 沙箱在生命周期里的位置](../sandbox.md#沙箱在生命周期里的位置) —— phases 阶段边界的出处,也是 `runAttemptBody` 执行序的出处。
- [Results Format](../results-format.md) —— `result.json` 的权威记录契约,落地后承载 `phases` 字段定稿。
- [E2E CI](e2e-ci.md) —— 回归门禁侧的沙箱矩阵,与 bench 的分工见「运行纪律」;`bench/` 触达 runner 内部函数与 e2e 触达 CLI 子进程是同一类仓库内部特权。
- [Observability](../observability.md) —— 为什么 phases 不走 OTel trace。
