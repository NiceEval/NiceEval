# Experiments —— 架构

experiment 是**可签入的运行配置**：一个文件钉一个单一配置，运行时展开成 attempt 矩阵，落盘成 Run。
本页定义这条链路上的实体、配置解析、调度接口与结果投影；使用侧 API 见 [README](README.md) 与 [Library](library.md)。

## 实体与生命周期

```text
ExperimentDefinition(运行配置 + 实验级 setup Hook,experiments/ 下一文件一个)
  → 解析后配置(调度前一次求值:合并 CLI flag / experiment / eval / config 回退,求值 evals 过滤器,link 每条选中配对的 template)
  → attempt 矩阵(selectedEvalIds × attempts,每 attempt 一个执行 fiber)
  → Run(.niceeval/<experiment>/<timestamp>-<suffix>/,含 ExperimentRunInfo 投影)
```

- **id 从路径推导**（`experiments/agents/bub/gpt-5.4.ts` → `agents/bub/gpt-5.4`），路径只表达身份与 CLI 前缀选择，禁止手写 id。
- **`ExperimentDefinition` 携带实验级生命周期 Hook 对 `setup` / `teardown`**——整场一次、宿主机侧(语义见下文 [实验级生命周期](#实验级生命周期setup-与-teardown))。
  其余生命周期各归各位:沙箱内准备写 Eval / Experiment `sandbox` layer 的 `prepare()` 命令,题目材料属于 Eval layer 与 `test(t)`。
  装 Agent CLI 归 Adapter 的 Agent layer,连 agent 归 `SandboxAgent.setup`,跨实验共享服务用外部编排(分工表见 [环境预置放哪](../sandbox/library.md#环境预置放哪))。
- 同一次 `niceeval exp` Invocation 可以同时跑多个实验（文件夹展开），但每个实验各自开 Run 目录，没有跨实验成员关系或聚合落盘。
  Invocation 是瞬时编排边界，不分配持久化 id。
  多条 Invocation 也可以对同一仓库并行运行：Run 互不覆盖，同一条 `(experiment, eval)` 不被双跑由[用例锁](#并发-invocation用例锁)保证。

## 配置解析链：一次求值，处处同源

配置优先级是 CLI flag → experiment 字段 → eval 字段 → `niceeval.config.ts` 回退 → 默认值（环境变量不在这条链里，[边界](../../architecture.md#配置从代码来凭据从环境来)）。
eval 层只对 `defineEval` 同名声明的字段存在（`timeoutMs`、`judge`），排在 config 之前：**config 是默认来源，不是覆盖层——项目里写了 config 不得使 eval 自己的声明失效**。
一条声明 35 分钟上限的安装型 eval，在 config 写了 20 分钟的项目里仍按 35 分钟跑；要一次性把整批缩短，用运行侧的 `--timeout` 或 experiment 字段显式压过它——运行侧只以显式声明取胜，不靠 config 的默认值遮蔽题目自己的需求。

两个有 eval 层的字段各自的完整解析链写死在这里，下游不再各推一遍：

| 字段 | 解析链 | 默认 |
|---|---|---|
| `timeoutMs` | `--timeout` → experiment → eval → config | 无上限 |
| `judge` | 单条断言 `{ model }` → experiment → eval → config | 无内置裁判模型；解析不到而用到 judge 断言时报清晰错误 |

`judge` 没有 CLI flag：临时改裁判会让比较条件无法从实验文件复现。
它有 Experiment 层，因为“同题同 rubric、换裁判执行配置”本身就是需要签入身份的 A/B 运行矩阵。

这条链逐字段合并，而不是整体覆盖。单条断言只写 `model` 时，其余键继续从 Experiment → Eval → config 解析；Experiment 只写 `model` 时，`baseUrl` 仍可由 Eval 或 config 提供。

Eval 仍拥有 rubric、评分材料、severity 与 threshold。Experiment 的 `judge` 只能提供 `JudgeConfig`，不能重定义评分规则。
`model`、`baseUrl` 与 `timeoutMs` 是裁判执行配置、进 [configHash](cache.md#指纹两个哈希嵌套)；`apiKeyEnv` 只指出凭据从哪个环境变量读，不进哈希也不落盘。

没有 eval 层的多来源字段不进这张表，链在各自的单源页：全局并发上限（`--max-concurrency` → config → provider 推荐值）在[Runner · 调度](../../runner.md#调度有界并发)。
实验级 `maxConcurrency`不是同一个值的另一来源，而是叠加的第二道闸——两道都过才派发，收全局不解除实验闸。

**解析的赢家要在反馈里留痕。**
多来源字段的失配症状总落在离配置很远的地方——超时报错、并发上不去——值不带出处，就得回头逐层对照每个声明点。
因此有效值面向用户出现时带上它来自哪一层。
超时消息带`from flag / experiment / eval / config`；`PLAN` 行的 `concurrency` 带`from flag / config / provider default`，并逐个点名收窄有效宽度的实验闸（两处契约见 [CLI 反馈模型](cli.md#运行中的-live-面板)）。
出处只进人读面，不另立结构化字段——它是给人排查的一层原因，不是 CI 分支的决策轴。

解析发生在调度任何 attempt 之前、一次完成，运行中不再重读；此后所有消费方——调度器、fingerprint、Run 投影、报告——引用同一份解析结果：

```typescript
export default defineExperiment({
  evals: (e) => e.tags.includes("memory"),
  //  解析期遍历发现后的 EvalDescriptor 全集(测试集已生成 attempt)求值一次,产出 selectedEvalIds
  //  必须同步返回 boolean;落盘的是求值结果与过滤器指纹,不是函数本身

  sandbox: e2bSandbox({ template: "base" })
    .prepare(installMempal),   // installTool 封装,见内置 prepare 命令
  //  本实验的 SandboxLayer。link 期对每条实际选中的 Eval × Experiment 边做 template 检查:
  //  恰好一方 template-bearing;双方都带报 sandbox.template-conflict,双方都不带报 sandbox.template-missing
  //  任一边非法即全矩阵聚合报错,零 Provider I/O、零构建、零 Sandbox 创建(错误语义见 Sandbox 三方准备时序)
  //  合法配对交给它绑定的 Provider 做只读 physical / network planning,再算 fingerprint
  //  niceeval check、--dry 与正常运行消费同一份 linked matrix,不各自重算 template 选择
  //  逐 eval 的 template 解析结果进该 eval 的 fingerprint、provider 并发推荐值与 ExperimentRunInfo.sandboxByEval
  //  Direct Agent 没有运行中的 Sandbox;任一侧为它声明 SandboxLayer 报 sandbox.unexpected-for-direct-agent

  timeoutMs: 40 * 60_000,
  //  单 attempt 外层超时,四层解析:--timeout → 这里 → eval 字段 → niceeval.config.ts
  //  不进 fingerprint 哈希,改为以携带资格判据参与 carry(见 cache.md)
  //  例外是写在 eval 文件里的那一层:它随该文件的字节进指纹,改了照样作废那一条

  judge: { model: "gpt-5.4-mini" },
  //  单条断言 {model} → experiment → eval → config；无 CLI 覆盖。
  //  这里只选择裁判执行配置，rubric / threshold 仍在 Eval。

  maxConcurrency: 2,
  sandboxReuse: true,
  //  实验级并发闸,先过它再占全局并发位;名额与 attempt 同生命周期(沙箱创建到销毁全程持有,
  //  turn 退避等内部等待不释放)。名额域是该实验所有并行 Invocation 共用的,多开不叠加 N

  earlyExit: true,   // 只由 passed 触发的首过即停;errored 不中止其余样本,走 run 级 fail-fast
  budget: 50,        // 按已完成 attempt 的实测花费停止派发的安全网

  classifyFailure({ text }) { /* … */ },
  //  识别以第三方错误形态浮出的自家共享基建死因(对共享隧道 host 的拒连)
  //  命中的 scope 触发止损闸停止派发
});
```

`maxConcurrency` 用来串行化共享状态实验，或给撞限额的实验单独降速；它的跨 Invocation 租约机制见[并发 Invocation](#并发-invocation用例锁)。
`sandboxReuse` 决定 Sandbox Case 是逐 Attempt 创建还是跨 Attempt 复用,并进入配置哈希;每条 Attempt 都重放两层 prepare,完整顺序见 [Sandbox 复用](../sandbox/reuse.md)。
`timeoutMs` 的携带资格判据见 [缓存与携带](cache.md#携带资格timeoutms-不进哈希)，超时的证据保全与删失语义见 [Runner · 超时](../../runner.md#超时双层保护)。
这些字段的调度语义单点在 [Runner](../../runner.md)。
`classifyFailure` 的类型、分类链与止损语义单源在[执行失败分类](../error-classification/architecture.md#类型)，写法见其 [Library](../error-classification/library.md#实验--eval-作者声明死因的波及范围)。

- eval 级 fingerprint 由 eval 源码闭包 + 影响该 eval 的解析后配置构成，是 [carry](#carry自动携带) 的判断依据；两层嵌套哈希与输入的穷尽清单(含 `flags` 整袋无逐键豁免、以及哪些配置有意不进)单源在 [缓存与携带](cache.md#指纹两个哈希嵌套)。
  源码闭包递归展开 eval 文件在项目根内的导入图，并含 `loadYaml` / `loadJson` 读入的数据文件——这两类内容在发现阶段的模块求值期就已读入，早于解析期算指纹。
  解析期求值这一步划定了配置那一层的边界：**进指纹的只可能是解析后的配置**，运行时才产生的值(`setup` 起出来的坐标、`ctx.fact()` 上报的观测)在算指纹的时刻还不存在，结构上进不来。
- 落盘投影 `ExperimentRunInfo` 的穷尽形状单点定义在 [Results · run.json](../record/architecture.md#runjson)；`model` / `agent` 只在 Run 顶层存在。

## Run 级共享准备:构建协调的预算

eval 声明按需构建环境时,BuildKey 构建、共享拉取与发布属于 Run 级共享准备,不属于任何单个 attempt:

- 共享准备受独立构建并发、逐 key timeout、全局准备上限和 Invocation abort 约束,不占 attempt 并发位。
- attempt deadline 从拿到产物并开始创建 Sandbox 时起算;创建资源组、服务 ready、Agent Ensure、执行与评分共享同一个 attempt 并发位和 deadline。
- 共享构建的时间只在 `RunMeta.timings` 记一次,不进任何 attempt 的 `executionMs`;live 面板把它显示为运行级 active 行,不占 attempt active 位。

调度与失败生成 attempt的完整契约单源在 [Sandbox Case · Run 级构建协调](../sandbox/case.md#run-级构建协调共享准备的预算与调度),落盘形状在 [Record · 两层时间模型](../record/architecture.md#两层时间模型生命周期锚点与开放-activity)。

## 实验级生命周期：setup 与 teardown

`setup(ctx)` / `teardown(ctx)` 在**宿主机**上、对每个实验**整场恰好至多一次**执行,与 attempt 生命周期(沙箱内 / 每 attempt 一次)分属两个节奏;成对形态与触发规则和 Agent 层的 Hook 对一致(见 [Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它))。

```typescript
let tunnel: Tunnel | undefined;

export default defineExperiment({
  setup: async (ctx) => {
    tunnel = await startTunnel();     // 产出的坐标写进模块级变量,靠闭包流给下面的 teardown 与每 attempt 的 Hook
    ctx.fact("tunnel", tunnel.url);   // 要把这轮实际用的坐标留进记录就上报 fact,落 RunMeta.facts
  },
  //  抛错 → 本实验所有 attempt 记 errored,逐条落 result.json、进报告
  //  (error.code = "experiment-setup-failed",error.phase = "experiment.setup")
  //  环境起不来是每条 eval 都没跑成的事实,不是一条一次性日志;同批其它实验不受任何影响

  teardown: async (ctx) => {
    await tunnel?.stop();             // ?. 是必需的防御:半初始化的现场同样要扫尾,强杀后的补执行更是读不到闭包
  },
  //  当且仅当 setup 的时点走到过才执行——setup 抛错不豁免,一个 attempt 都没派发则跳过
  //  抛错 → 记一条 Run 级 diagnostic(experiment-teardown-failed,phase: "experiment.teardown"),
  //  随该 Experiment 的 completedAt 封口落入 run.json,不改变任何已产出的 verdict
  //  执行有界:30s 清理超时,到点同样记这条,不能无限拖住退出
});
```

- **触发时机是懒的**:本实验第一个通过派发许可(首过即停 / fail-fast / budget 检查)的 attempt 触发它,后续 attempt 等同一个 memoized 结果。
  全部结果被 carry 携入、一个 attempt 都不派发时,`setup` 不执行——没有 attempt 要跑就没有资源要起。
- **不占并发位,也不折损优先级**:等待 `setup` 的 attempt 不持有、不预留全局并发位,不会让一个慢启动的隧道饿死同批其它实验;它们在反馈计数里保持 `queued`。
  setup 完成后按[瓶颈优先](../../runner.md#派发顺序瓶颈优先追求最小总墙钟时间)的优先级参与下一次空位分配,不因回来得晚排到队尾。
- **起止可见性由 runner 发布**:setup / teardown 的开始与结束是运行级反馈事件(Human dashboard 的运行级 active 行、`--json` 的起止事件),不依赖 Hook 自己调 `progress`——渲染契约见 [CLI · 实验级 Hook 的显示](cli.md#实验级-hook-的显示)。
- **ctx**:`experimentId`、`selectedEvalIds`、`signal`(用户中断时 abort),以及作用域反馈 `progress` / `diagnostic` / `fact`(绑定到当前 Hook 对应的 `experiment.setup` / `experiment.teardown`,见 [Library · 生命周期代码怎样向这次运行反馈](library.md#生命周期代码怎样向这次运行反馈))。
  experiment 级 Hook 上报的 fact 落进 `RunMeta.facts`(Run 封口补写),记录整场实验的环境观测;语义与形状见 [Results · facts](../record/architecture.md#facts运行事实)。
- **`setup` 失败不刷屏**:同一 eval 连续复现同一错误码走既有 run 级 fail-fast 收敛,不会刷出无限重复行。
- **teardown 的触发时点**:本实验最后一个 attempt 收尾后执行;运行被中断、attempt 全部失败时同样执行(finalizer 语义),强清退出路径(二次中断 / 看门狗 / 崩溃退出)由宿主机侧注册表回退排空——与正常路径互斥、恰好执行一次(机制见 [CLI 内部架构 · 中断:三级响应](../../cli.md#中断三级响应));无法拦截的强杀(`SIGKILL` / 断电)不在进程内回退范围,由[强杀后的收尾回退](#强杀后的收尾回退收尾登记与启动自愈)在磁盘上接手。
  失败语义与 `sandbox.cleanup` 一致。
- **runner 不做运行时值的中介**:`setup` 拿到的 URL / 凭据经模块闭包流给 `teardown` 与同文件里的 agent 工厂 / prepare command(后两者每 attempt 执行,晚于 `setup`)。
  它们是运行时基础设施坐标,不是实验条件——实验条件进 `flags`,一并进指纹;坐标进 `facts`,不参与可比性,轮换多少次都不作废已完成结果(三个家的判据见 [Library · 运行时坐标不进配置](library.md#运行时坐标不进配置三个家))。
- **不进 fingerprint**:实验级 Hook 的函数体不参与 eval fingerprint;改了 `setup` / `teardown` 逻辑要强制重跑用 `--rerun all`。
  sandbox layer 的 prepare 命令走另一条规则:`command()` / `shell()` 与 `defineSandboxCommand()` 的 identity 进入 configHash / fingerprint(输入清单见[缓存与携带](cache.md#指纹两个哈希嵌套))。
  直接传入的 callback 不增加可追踪 identity，也不阻断跨 Run 携带；需要让变化自动作废结果时使用 `defineSandboxCommand()`。
- **两个 Hook 都不产出 attempt 阶段计时**:`experiment.setup` / `experiment.teardown` 不属于任何单个 attempt,`phases[]` 里永远不出现;这两个词表成员只用于错误 / 诊断归因(见 [Results · result.json](../record/architecture.md#resultjson))与运行级反馈行的标注。

## 强杀后的收尾回退:收尾登记与启动自愈

进程内的回退注册表覆盖正常、中断与崩溃退出,覆盖不到 `SIGKILL` / 宿主断电——此时实验级 `setup` 起过的外部资源(隧道、共享服务、license 席位)没有任何代码来得及释放,而且强杀往往来自会重复触发的外部看门狗(CI 时限、宿主超时),泄漏会随重跑累积。
这条路径的回退建立在磁盘上:

- **收尾登记与触发时点同步落盘。**
  实验的触发时点(第一个通过派发许可的 attempt)在跑 `setup` 之前,先把收尾登记原子写入 `.niceeval/teardowns/<entry>.json`(与留存注册表同一套逐条目文件纪律):`{ experimentId, selectedEvalIds, pid, host, startedAt }`。
  条目键包含实验身份与 pid，因此同一实验的并发 run 各自保留一份义务。
  teardown settle 后——不论由哪条路径触发、成功还是超时——删除**自己的**登记。
  不变量:磁盘上存在登记,当且仅当某次 run 的实验级收尾义务尚未完成。
- **启动自愈。**
  `niceeval exp` 启动时扫描登记目录。
  `host` 等于当前宿主机名且 `pid` 不存活的登记是**遗留义务**:只要该实验被本次选中且仍声明 `teardown`,就在调度 attempt 前逐条补执行一次(运行级反馈行标注 recovery),再照常走本次的生命周期——即使全部结果被 carry、零 attempt 会派发，也会补上强杀遗留的收尾。
  不在这类可自愈选择中的遗留登记打一行提醒并给出 `--teardown` 补收尾命令；这包括选中了但定义已删除 `teardown` 的实验。
  `pid` 仍存活或 `host` 不匹配的登记可能属于并发 run,不触碰。
- **补执行是新进程语义。**
  原进程的模块闭包已随强杀丢失,补执行时 teardown 读到的闭包变量是未赋值状态——这正是 teardown 既有防御契约(`tunnel?.stop()`)覆盖的形态;需要跨进程收尾的资源应由 teardown 从环境或自身的持久化(容器名、pid 文件、幂等的外部 down 脚本)找回,不依赖 `setup` 的内存产物。
  `ctx.selectedEvalIds` 从登记恢复,`ctx.signal` 绑定当前进程的中断。
- **删登记是互斥点,义务至多补执行一次。**
  补执行(启动自愈或 `--teardown`)先原子删除登记,删除成功者获得执行权;登记已被别的进程删除则跳过——同一份遗留义务不会被两个进程双跑。
  补执行失败按既有失败语义记 `experiment-teardown-failed` diagnostic,不自动重试;手动 `--teardown` 是重试入口。
- **手动补收尾:`--teardown`。**
  `niceeval exp <experiment 路径> --teardown` 不派发 attempt、不跑 `setup`。
  它先逐条原子删除选中实验的遗留登记；删除成功者才执行相应 teardown，登记已被启动自愈或另一条 `--teardown` 路径删除则跳过，因而同一义务不会双跑。
  没有任何登记时仍照常执行一次，供「我知道有东西泄漏了」的场景使用；若扫描时已有登记但本进程未抢到删除权，不另行执行。
  teardown 抛错记 diagnostic 并退出 1，失败后不回写登记，重试入口仍是 `--teardown`。
  与 eval 前缀位置参数组合报用法错误——这个 flag 选择的是「只收尾」这种跑法,不参与 eval 选择。

## 并发 Invocation:用例锁

`.niceeval` 的 Run 目录天然支持多开——每条 Invocation 各开自己的 Run 目录,互不覆盖。
多终端并行跑几条 `niceeval exp` 时,唯一要守住的是**同一条 `(experiment, eval)` 不被两条 Invocation 同时派发**:双跑烧双份沙箱与 token,还会并发踩踏有共享状态的实验。
用例锁只守这一件事,不守任何数据。

- **粒度是单条评估用例。**
  锁键是 `(experimentId, evalId)`;持有者认领该用例本次计划的全部 attempt(含 attempts 补跑的缺失序号),不按 attempt 拆锁——同一用例的 attempt 分属两个进程会把 `attempts` 的通过率分母切成两半各自不完整。
- **锁文件落在 `.niceeval/locks/`**,平铺目录、一条用例一个文件(与收尾登记同一套逐条目文件纪律)。
  文件名由身份 slug 加身份哈希构成,只须无碰撞、不承载解析;身份的权威在文件内容:`{ experimentId, evalId, pid, host, startedAt, heartbeatAt }`。
- **取锁在派发时刻,逐用例、非阻放入行。**
  一条用例的锁在它第一个 attempt 真正要占并发位开跑的那一刻才原子创建(独占创建,已存在即失败),成功才放行执行。
  排队中的用例不持锁——一条 Invocation 任何时刻只锁自己正在跑的用例,不囤积整个选择集;因此两条选择重叠的 Invocation 会各自认领还没人锁的用例、按各自的并发上限并行推进,多开一条终端就是给同一批选择加吞吐。
  全部 attempt 都可携带的用例不取锁。
  等锁的用例不触发实验级 `setup`——选中用例全部在等锁时,本实验没有要派发的 attempt,`setup` 照例不执行。
- **取到锁之后重做一次携带规划。**
  取锁成功的那一刻,该用例重读自己在结果树上已落盘的 attempt,按[携带判据](cache.md#携带要过的门)逐条重判:每一道门都过的直接携入(零新成本),仍缺的序号才由本进程跑。
  这次重判**无条件进行**——取到锁就做,不附加任何前置判据;闭合性来自 `别人落盘 → 别人释放锁 → 本进程取到锁 → 本进程读盘` 这条 happens-before 链,只有发生在取锁之后才成立。
  它把[「重跑同一条命令就是续跑」](#carry自动携带)从串行重跑扩展到并发多开:两条选择有交集的 Invocation,不论各自的推进节奏怎样交错,各自结束时都拿到完整结果集,交集部分只花一份成本。
  重判的读取面收窄到单条 `(experimentId, evalId)`——只翻该实验下跑过这条 eval 的 Run,不扫结果全树,因此这次 I/O 虽然发生在握着并发位与锁的派发路径上,开销仍可忽略;它与派发前的携带规划共用同一份资格判据,两处结论不分叉。
- **心跳证明持有者活着。**
  持有者每 10s 原子重写一次 `heartbeatAt`(写临时文件再 rename)。
  `heartbeatAt` 落后当前时间超过 30s(三个心跳周期)即视为持有者已死。
  判活只看心跳时间戳,不看 pid——容器与跨用户场景下 pid 判活不可靠,而心跳对任何死法(`SIGKILL`、断电、宿主蒸发)都收敛到同一个判据。
- **撞上新鲜锁 = 该用例等待,派发轮继续。**
  撞锁只挂起这一条用例:它让出刚拿到的并发位,位子立刻转派给下一条没被锁的用例——选中用例全部撞锁时本进程才真正闲下来整体等待。
  挂起的用例不占全局并发位,计入独立的 `elsewhere` 计数状态(别人在运行,与 `queued` 互斥——排队等的是本进程的并发位,`elsewhere` 等的是别的进程,混进同一个数字会把「资源不够」和「别人在跑」两种等待混为一谈),每个心跳周期重读一次锁文件;等待没有超时——心跳新鲜就一直等,用户中断照常退出。
  锁消失(正常释放)或过期(接管)后,该用例重新参与派发:取到锁即按上一条重做携带规划,对方 Invocation 落盘的终态此刻已可读、能携的携入,仍缺的 attempt 序号自己补跑。
- **锁不含指纹。**
  键只有身份,不掺解析后的配置:两边配置不同(携带必不匹配)时,等待换到的只剩「不同时双跑」——这仍然值得,它保护有共享状态的用例不被并发踩踏,判据也因此保持「读锁文件即可判定」的简单形态,不需要在锁上再算一遍指纹。
- **过期锁经原子 rename 接管。**
  竞争者把过期锁文件 rename 成自己的接管标记,rename 成功者获得执行权、随后写入自己的新锁;输者按撞锁处理,转入等待。
  与收尾登记的「删登记是互斥点」同构:同一把过期锁不会被两个进程双接管。
  接管记一条 warning 级运行 diagnostic(code `lock-taken-over`,按 dedupeKey 折叠)——它意味着某次 run 死得没来得及清锁,值得让操作者看见,但不值得中止任何事。
- **释放与回退。**
  用例的全部 attempt 收尾(含沙箱销毁)后删除自己的锁;中断与强清退出路径由既有的宿主机侧回退排空;`SIGKILL` / 断电不释放,由心跳过期接管回退。
  锁目录不需要手工清理,也没有对应的清理命令。
- **执行模式组合。**
  `--rerun` 不豁免锁：等待照旧，等完按本次口径判携带（`all` 档全部自跑）。
  它关掉的是缓存，不是“别双跑”。
  声明 `sandboxReuse: true` 的 Experiment 与普通 Experiment 一样重做结果沿用判据；可携带的 Attempt 不派发，其余 Attempt 才进入本次的复用生命周期。
  [`--keep-sandbox`](../sandbox/cli.md) 的携带豁免规则照常作用于其它 Experiment。
  `--dry` 不取锁、不等待，只读锁目录把撞锁用例如实标进计划（见 [CLI · 计划文档](cli.md#事件与计划文档的-typescript-形状)）。
- **实验级 `maxConcurrency` 的名额域跨 Invocation。**
  声明了 `maxConcurrency` 的实验,其 N 个名额是**该实验所有并行 Invocation 共用的**:名额落成 `.niceeval/locks/` 下按 `(experimentId, slot)` 逐条目的租约文件,心跳、过期判据与 rename 接管和用例锁同一套纪律;名额与 attempt 同生命周期的持有规则不变(见 [Runner · 调度](../../runner.md#调度有界并发))。
  这让 `maxConcurrency: 1` 作为共享状态实验的正确性声明在多开下依然成立——两条 Invocation 各选同一实验不同 eval 子集时,attempt 仍严格互斥;给撞限额实验降速的 N 也不因多开叠加对 agent 的压力。
  未声明 `maxConcurrency` 的实验没有名额域,不产生任何跨进程协调。
  两边解析出的 N 不一致(配置漂移)时,取在场声明中的最小值——正确性从紧。

**非目标**:用例锁与实验闸不把**全局**并发位扩展到跨进程——`--max-concurrency` 是每条 Invocation 自己的吞吐旋钮,两条并行 Invocation 对 provider 与模型接口的总压力是各自之和,配额分配归用户(各自调低 `--max-concurrency`)。
同一实验被两条 Invocation 选中时,实验级 `setup` 在每条 Invocation 各执行一次,跨进程共享服务的互斥仍归外部编排。
它也不是跨机分布式锁:判据依赖同一份文件系统与同一只时钟,不同工作副本各有各的 `.niceeval`,天然不共享锁域。

## Session 登记

Session 是一次 `niceeval exp` 调度的持久目录项。它聚合该次调用选中的多个 Experiment Run，回答「这些 Run 是不是同一批发起」与「这批还在不在跑」。
Run 仍是一条 Experiment 的结果快照，Attempt 仍是一条 Eval 的一轮执行。Session 不是 agent 的对话 session；agent session / turn 只属于 Attempt 的 execution 证据。

- **每次调度一份 Session。**

  - runner 在预分配每个 Experiment 的 `runId` 后、首次派发前，以 UUID v4 `sessionId` 在 `.niceeval/sessions/` 原子创建 `<sessionId>.json`。文件名只作定位。
  - 初始内容是权威身份：`sessionId`、`pid`、`startedAt`、`status` 与每个 Experiment 的 `{ experimentId, runId }`。
  - 活动期间写入 `heartbeatAt` 与各 Experiment 的 `{ state, running, queued, elsewhere }`。完成后写入 `completedAt`、completion 与各 Run 的路径。
  - `state` 是 `setup`、`running`、`waiting` 或 `teardown` 之一。计数与 live 面板使用同一份反馈状态，不另建调度计数器。
- **Session 记录跨过结束点。**
  正常完成、启动期失败与中断都封口同一份 Session，而不是删除它。`session list` 默认只列有效心跳的活动 Session，`--all` 才读历史；这份轻量索引不复制 Attempt 的 verdict、usage、事件或 artifact，完整结果继续从每个 Run 读取。
- **心跳表示活动，不表示锁。**
  活动 Session 每 10s 原子更新一次，`heartbeatAt` 落后当前时间超过 30s 即失活。失活 Session 只能作为 `STALE` 诊断展示，不能证明进程仍在、不能挡住派发，也不能作为用例锁或实验级名额租约的依据。
  用例锁与名额租约继续各自判断心跳和接管，不能因为 Session 存在就跳过它们。
- **一份 Session 覆盖多个 Run。**
  一条 `exp` 选中多个 Experiment 时共用一个 `sessionId`，但每个 Experiment 保留自己的 `runId`、运行状态和结果路径。这让查询既能回答「哪条命令还活着」，又能精确回答「哪些 Experiment 在跑」，不伪造跨 Experiment 的 Run。
- **读取面与结果面分离。**
  `niceeval session list` / `show` 只扫描 Session 目录并按记录的 `experimentId` 过滤，不加载配置或源码。它们不输出 Attempt locator、agent 事件或 artifact；完成后的证据仍由 Run 和 `niceeval show` 提供。

Session 的命令和 JSON 形状单源在 [CLI · Session 查询](cli.md#session-查询)。它的用户决策路径见[用例手册 · 查看活跃实验](use-case/并发/查看活跃实验.md)。

## Carry：自动携带

上一轮 fingerprint 匹配、判定为终态（passed / failed）的结果默认不重跑，**携带合入**本次 Run（带 `artifactBase` 指回原 artifact），让最新 Run 保持完整；[`--rerun`](use-case/重新运行/) 收窄「哪些还算数」(`failed` 档只采信 `passed`，`all` 档一律不采信)；`errored` / `skipped` 判定不可信，永不携带。

携带以 attempt 为粒度、来源不要求 Run 收尾，因此被中断或强杀的 Invocation **重跑同一条命令就是续跑**——只补缺失的 attempt。这里的续跑只承诺 NiceEval 结果面；若 Experiment 另有跨 Attempt 持久状态，中断中的副作用必须由作者回滚到最后一个终态提交边界，不能把半次写入混进续跑轨迹。完整边界见[缓存与携带 · 携带来源不要求 Run 收尾](cache.md#携带来源不要求-run-收尾)。

粒度与来源的完整规则见 [缓存与携带](cache.md)，携带条目的落盘与读取语义见 [Results · 两类条目](../record/architecture.md#resultjson)。

## Invocation Completion 与退出

当次 Invocation 的结论与逐 attempt 判定分开表达：`complete` / `incomplete` / `interrupted`（budget 耗尽、fail-fast、止损闸或中断造成的未派发计入 `unstarted`，让结论落在 `incomplete`，不伪装成全绿）；退出码按 `(experiment, eval)` 折叠判红。
这是当场编排事实，不写入 Results；需要审计时由 `Json(path)` reporter 写 `InvocationSummary`。
终端两种输出形态怎么呈现见 [CLI 预期反馈](cli.md)，完成状态的机器形状见 [Runner · 完成状态](../../runner.md#完成状态)。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Library](library.md) —— model/flags 怎么透传、怎样选择 eval、路径怎样形成 id。
- [CLI 预期反馈](cli.md) —— 人读文本与 `--json` 两种输出形态的契约。
- [Runner](../../runner.md) —— 调度、carry、完成状态的执行语义。
- [设计参照](reference/README.md) —— 外部方案只作为来源与取舍证据，不混入目标契约正文。
