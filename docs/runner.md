# Runner —— 执行引擎

运行器把「一批 eval」变成「一份结果」。它拥有对所有被测对象都一样的
部分:发现、有界并发、首过即停、缓存、报告编排。被测对象的差异它一概
不管——只对着 `Agent` 接口(统一动词 `send`)驱动。

## 职责边界

| | 内容 |
|---|---|
| **做** | 发现 eval、算指纹决定跳过、建 attempt 列表、有界并发调度、首过即停、把结果交给报告器、落盘 artifact、定退出码 |
| **不做** | 怎么驱动 agent(Agent / Adapter)、怎么打分(Scorer)、结果存成什么格式(Reporter) |

它是协调者,不是执行者。

## 发现

`runner/discover.ts` 扫 `evals/`,找所有 `*.eval.ts` 与 `*.eval.tsx`,
`import` 后看默认导出。两种扩展名同等对待,`.tsx` 供要在 eval 里写 JSX
的场景。默认导出的三种形态各有 id 规则:

| 默认导出 | id | 排序 |
|---|---|---|
| 单个 eval | 文件 id | — |
| 数组 | 按位置扇出,加零填充索引(`sql/0000`) | 数组顺序 |
| keyed record | 按合法业务 key 扇出(`swelancer/15193`) | key 字典序 |

发现结果按相对路径排序,保证 id 稳定、输出可比,再应用过滤:位置参数
(id 前缀,`weather` 命中 `weather/*`)与 `--tag`。

`niceeval exp` 另从 `experiments/` 扫实验文件(默认导出
`defineExperiment` 的 `.ts`),据路径推导实验 id;目录路径只支持批量
选择。实验的 `evals` 谓词遍历发现结果、筛出这个实验要跑的 eval
(展成多少 attempt 见[矩阵展开](#矩阵展开))。

没有另一种基于目录约定的隐式发现——沙箱型 eval 也必须有一个 eval 文件。

## 调度:有界并发

核心是 `Effect.forEach({ concurrency: "unbounded" })` 加**两级并发闸**。
每个 attempt 立刻有自己的 fiber,执行体要先过实验级闸、再拿到全局并发
位,才真正开跑。两级闸按**持有期**分工,这也是各自的用途边界:

```text
attempt 的一生
  进入 ─ 等实验 setup ─ 等并发位 ─ create·setup·test·评分 ─ teardown·销毁 ─ 完成
  │                                                                          │
  ●══════════════════════════════════════════════════════════════════════════●
  ① 实验级闸  ExperimentDef.maxConcurrency(可选,先来后到)
     持有期 = 整个 attempt。中途任何等待都不释放 → 严格临界区

                                   ●════════════════════●
                                   ② 全局并发位  maxConcurrency(瓶颈优先分配)
                                      持有期 = 只在真正执行时。等待就让位
                                      → 纯吞吐参数
```

| | ① 实验级闸 | ② 全局并发位 |
|---|---|---|
| 管什么 | 正确性,以及本实验自己的节奏 | 吞吐 |
| 什么时候取 | 进入 attempt(先于沙箱创建与 `sandbox.setup` 链) | 真正开始执行时 |
| 什么时候还 | 收尾完成(`teardown` 链、沙箱销毁)之后 | 执行结束,或进入内部等待时 |
| 内部等待(退避睡眠、等实验级 `setup`) | 不释放 | 让位给别的 attempt |
| 名额域 | 该实验,跨 Invocation 共享 | 每条 Invocation 自己 |
| 撞限流时对外的压力 | 不向本实验放行更多 attempt | 让出的位立刻派给排队者,总压力不降 |

由此得到三条语义:

- `maxConcurrency: 1` 是严格的临界区保证——上一个 attempt 的回存收尾没
  跑完,下一个 attempt 的载入不会开始。
- 实验级闸只让该实验自己的 attempt 排队,同批其它实验照常并发。串行化
  有共享状态的实验(如跨 eval 累积记忆)不拖慢整批基线。
- 名额域**跨 Invocation 共享**:同一工作副本上并行的多条 Invocation 从
  同一实验的同一批名额取位(租约文件机制见
  [Experiments · 并发 Invocation](feature/experiments/architecture.md#并发-invocation用例锁)),
  临界区保证在多开下同样成立。

全局位是纯调度参数,不承诺任何互斥语义。「被限流时不加压」是实验级闸
的语义,不是全局位的。

报告回调走 **permit=1 的信号量串行化**,不阻塞执行 fiber。结果最后按
**发现顺序**排序(而非完成顺序),让输出稳定可 diff。

**全局上限的解析链**:`--max-concurrency` → 配置 `maxConcurrency` →
**该沙箱 provider 的推荐默认值**。

| provider | 推荐值 | 为什么是这个数 |
|---|---|---|
| `docker` | 10 | 本地 daemon 建容器有开销 |
| `e2b` | 20 | 账户配额的保守估计 |
| `vercel` | 1 | sandbox session 并发限制严,再高就 429 |
| `local` | 1 | 独占串行,见下 |
| 自定义 | 它自己声明的 `recommendedConcurrency`(省略则 5) | provider 自己最清楚 |

「云的就能开大」这个直觉是错的。推荐值反映的是 **provider 侧**约束
(daemon 容量、API 配额、session 池大小),不是你的 agent API 限额。
后者按限额类型自己压:速率型与并发型该动哪个闸、贴线配置为什么压不住,
见[并发用例手册 · 用例 8](feature/experiments/use-case/concurrency.md#8-全局吞吐--max-concurrency-什么时候调)。
实验文件里的 `maxConcurrency` 不参与这条全局解析,只在该实验内部限流。

**独占串行(`exclusive`)**:provider 可以声明它的所有 attempt 共享同一
份不可并发的底层资源,如 `local` 的同一棵真实工作树。runner 对它加一道
provider 级串行闸,显式 `--max-concurrency` 或实验级 `maxConcurrency`
都不解除,同批其它 provider 照常并发。

这是正确性约束,不是调度参数。声明是中性的 provider 元数据,核心不按
provider 名分支(契约见 [Sandbox · 本地执行](feature/sandbox/local.md))。

## 派发顺序:瓶颈优先,追求最小总墙钟时间

attempt 的**派发**顺序(全局并发位分配给谁的顺序)按**整批跑完的总墙钟
时间最短**这个目标排,不是发现顺序,也不是请求先后。这一层不影响结果
排序——结果仍按发现顺序输出。

**瓶颈由轮次数判定,不由 `maxConcurrency` 判定。**`maxConcurrency: 1`
但只有 1 个 attempt 的 run 谈不上瓶颈,`maxConcurrency: 5` 但有 500 个
attempt 的 run 才是。两者合起来才是这个 run 要跑多少**轮次**。

轮次越多,越该早、越该连续地占用并发位,总时长才接近「瓶颈自身的串行
耗时」,而不是「瓶颈耗时 + 排在它前面的其它 run 先跑完的耗时」。轮次少
或不设实验级上限的 run 不构成瓶颈,随时见缝插针补进空出来的并发位,
晚发不拖尾。

```text
effectiveWidth(run) = min(run.maxConcurrency ?? globalMaxConcurrency, globalMaxConcurrency)
priority(run)       = rounds(run) = ceil(attemptsOf(run).count / effectiveWidth(run))

onSlotFree():   # 初始 globalMaxConcurrency 个并发位视为同样多次空出
  grant(等待集中排序最前者)   # priority 降序 → run 发现顺序 → run 内 attempt 顺序
```

优先级绑定在**并发位的分配**上,不是 fiber 的创建顺序上,「谁先开始等」
不参与裁决。这样定是因为 attempt 在请求并发位之前可能还有别的事要做,
最典型是[实验级 `setup`](feature/experiments/architecture.md#实验级生命周期setup-与-teardown)
的宿主机等待。

而瓶颈 run 恰恰常是带慢 setup 的实验(隧道、共享记忆服务)。若按先来
后到分配,它等完 setup 时队伍早被无 setup 的宽并发 run 排满,优先级在
最需要生效的场景恰好失效。

`priority` 只在建 attempt 列表时算一次,用规划阶段已知的「每个 run 有
多少 attempt」。它不随运行中 earlyExit / fail-fast / budget 实际提前
收尾而重算——那是动态优先级调整,复杂度不值得为一个尽力而为的启发式
引入。

实验级闸不参与这条纪律,先来后到即可:同一 run 的 attempt 优先级相同,
它们内部谁先谁后不影响总墙钟。等待中的 attempt 被中止(earlyExit、
fail-fast、用户中断)时退出等待集,不占用后续分配。

**与实验级 setup 的组合是工作保全(work-conserving)的。**等待 setup
的 attempt 不持有也不预留并发位,期间空位照常发给低优先级 run 见缝
插针;setup 完成后该 run 按原优先级参与下一次分配。

代价是一次有界的起步延迟:setup 结束时若并发位全满,要等在飞 attempt
中最先完成的那个。上界是一个 attempt 的耗时,且每个实验整场只付一次
——第一个 attempt 挤进去之后,该 run 后续 attempt 一直按优先级拿位。

两个否决过的替代做法:

| 替代做法 | 为什么否决 |
|---|---|
| 为 setup 中的瓶颈 run **预留**并发位 | setup 耗时事先不可知,也可能失败(隧道冷启动重试、服务拉不起来)。预留等于拿一个并发位押注一段长度未知、可能白等的等待,真烧起来没有上界,失败时那个位是纯亏。相比之下 backfill 的代价有上界、可预测,也不因 setup 失败而放大 |
| **抢占**在飞的 attempt | 已花的沙箱与 token 成本不可回收 |

算法出处:单次 attempt 耗时未知且假设同批内大致均匀时,轮次数就是耗时
的代理指标——这是把 identical-machine 调度的 LPT 规则推广到「moldable
job」场景的标准做法。「空位给最高优先级等待者 + 低优先级见缝插针」即
批调度器的 backfilling;每个 attempt 只要一个并发位,不需要多资源预留式
backfill 的复杂度。

快慢实验混在一次命令里跑时看到的行为,见
[并发用例手册 · 用例 9](feature/experiments/use-case/concurrency.md#9-快慢实验混跑什么都不配)。

### 矩阵展开

一次 `exp` 运行把按路径选中的多个单一配置展成 attempt,再 ×
`eval × attempts`;每个配置先用自己的 `evals` 谓词遍历发现结果。比如
2 个实验配置 × `attempts: 5` × 3 个 eval = 30 个 attempt。

汇总按 `(agent, model, eval)` 分组,给出**通过率** + 平均耗时 / token /
成本:

```text
fixtures/button   claude-code   pass@5 = 4/5 (80%)   mean 34s · 58k tok · $0.44
fixtures/button   codex         pass@5 = 3/5 (60%)   mean 41s · 72k tok · $0.39
```

用于衡量 agent 的稳定性(一次过 ≠ 可靠),以及跨 agent 的
**质量 × 成本**对比。不写实验时退化成单 agent × `attempts`。

## 首过即停(earlyExit)

取通过率本可以跑满 N 次,但若只关心「能不能做到」,先过一次即可停其余。

默认关,`attempts` 因此默认跑满 N 次,给出完整通过率分布——这是这个
工具的核心指标(衡量 agent 稳不稳,见[矩阵展开](#矩阵展开)),默认不该
被无声截断。只想知道「能不能做到」、不在乎分布时,显式
`earlyExit: true`(或 `--early-exit`)打开。

三条停止派发的机制各管一类结果,互不混用:

```text
一个 attempt 出了结果
  │
  ├─ passed ─── earlyExit 开? ─▶ abort 同 eval 其余 attempt,不计入分母
  │                              只在实际省了至少一个轮次时发 invocation:earlyExit
  │
  ├─ errored,瞬态(超时、限流、沙箱挂掉)
  │      └─▶ 什么都不停。下一个 attempt 完全可能自愈
  │
  └─ errored,确定性(凭据缺失、模板不存在、作者代码必现抛错)
         ├─ 作者声明了 scope: "eval" / "experiment"
         │     └─▶ 止损闸:一次命中即停对应粒度的派发
         └─ 无声明
               └─▶ run 级 fail-fast:预检命中,或同 code 在同一 eval 连续复现
```

- **只有 `passed` 触发首过即停。** 每个 eval 配一个 `AbortController`,
  某 attempt 通过且 `earlyExit` 开就 `abort()` 同 eval 其余 attempt。
- **`errored` 不触发。** 因一次 errored 停掉其余样本等于放弃重试机会,
  还会把基建抖动放大成整题无结果。
- **声明的止损闸与 streak 推断并存、互不替代。** 声明是作者背书下的
  第一次即停,streak 是无声明时的保守兜底(闸的契约见
  [执行失败分类](feature/error-classification/README.md#自愈阶梯与止损阶梯))。
- **turn 层的瞬时故障不进这条判定。** 限流、连接建立失败在这之前已被
  有界重试吸收,streak 看到的 `turn-failed` 是重试耗尽后的最终结果
  (契约见[执行失败分类](feature/error-classification/README.md))。
- **earlyExit 不改变派发节奏,只减少已派发的浪费。** 同一个 eval 的多个
  attempt 该不该并发跑,由[有界并发](#调度有界并发)的并发位数决定,与
  earlyExit 是否开无关:`attempts: N` 建的 N 个 fiber 一起进等待集,有
  几个位就并发跑几个,不会等前一个出结果再决定要不要派发下一个。
- **abort 只作用于还在等待集里的 fiber。** 已经在跑的不受影响,跑完照样
  计入,除非 provider / adapter 自己接了 abort signal 提前终止。

「探到一次能过就停,过不了才继续跑下一次」这种严格串行的重试语义,是
`maxConcurrency: 1` 与显式 `earlyExit: true` 组合出的效果,搭配与可观察
行为见
[并发用例手册 · 用例 5](feature/experiments/use-case/concurrency.md#5-严格重试过了就停没过才跑下一次)。
flag 的全流程见[`--early-exit` 用例](feature/experiments/use-case/early-exit.md)。

## 预算护栏(budget)

budget 按**域**计,不是全局总闸:

- 每个 experimentId 一个域,没有 experiment 时按 agent 名。
- 实验的 `budget` 字段与 `--budget` 覆盖设定的都是**每个域各自**的上限。
- 一次运行选中 N 个实验,就是 N 份各自独立的上限,总花费上界是各域之和。

判据只有一条:**已完成 attempt 的实测花费**。

- 一个域的已完成花费一旦到顶,就停止向该域派发新 attempt。已经在飞的
  照常跑完,不会被中途打断。
- 到顶之前不做任何预测性节流,并发完全由 `--max-concurrency` 与实验级
  `maxConcurrency` 决定。
- 已花 + 在飞未结算的总花费因此可能短暂超出 budget。这是有意的取舍:
  budget 是防止无限烧钱的安全网,不是精确计费闸,不应该反过来限制吞吐。

拿不到成本数据时分两种:

- 连续多个**已经发起 agent turn** 的 attempt 都拿不到成本数据(agent
  不报用量)→ budget 对该域不可执行,给一条去重后的 warning,不每个
  attempt 重复提示。
- `sandbox.create`、setup 等发生在首个 agent turn 之前的错误没有成本
  事实 → 只报告其结构化 attempt error,不额外产生 budget warning。

预算耗尽而导致的未派发 attempt 数量计入运行[完成状态](#完成状态)的
`unstarted`,让整次运行的结论落在 `incomplete`,不能在 CI 里伪装成全绿。

命令行用法与面板读法见
[`--budget` 用例](feature/experiments/use-case/budget.md)。

## 预热与复用:冷启动移出关键路径

沙箱冷启动的优先级排序(先预制环境、再小 setup、最后才是池化)在
[Sandbox · 性能](feature/sandbox/architecture.md#性能预制环境复用与预热)。
provider 侧提供「创建、重置、销毁」的能力;什么时候预创建、什么时候
复用是运行器的调度决策,契约如下:

- **预热池**:开启后,运行器在调度开始时按
  `min(预热池大小, 计划 attempt 数)` 预先创建同 spec 沙箱挂进池里。
  attempt 到达 `sandbox.create` 阶段时先领池中现货,领到则该阶段只计
  领取耗时,池空则回落到即时创建。
- **预热池不改生命周期 Hook 的调用顺序**:领到的沙箱仍在 attempt 里按
  [固定调用链](#环境预置不进运行器但按顺序调它)走一遍 `sandbox.setup`
  链与分类账锚点。池只在同一次 run 内存活,run 结束时未被领用的沙箱
  一并销毁。
- **串行复用(`--reuse-sandbox`)**:整批同基线 eval 共用一个热沙箱串行
  跑。不随 eval 变的层(`createSandbox`、`sandbox.setup` 链、
  `SandboxAgent.setup`)整组只执行一次,落成**复用 Sandbox 的题间重置点**。
  题间把 workdir 重置回这个点(`git reset --hard` + 尊重分类账排除清单的
  `git clean`),每题只重放 `EvalDef.setup` / `test(t)` Fixture。
- **复用的两条互斥**:与并发互斥(一个热沙箱 = 一条执行道,并发钉成 1,
  显式 `--max-concurrency` 组合是创建前的用法错误);与指纹缓存双向绝缘
  (不消费携带、不产生命中)。重置点的分层、诚实边界、同基线批次约束见
  [Sandbox · 串行复用](feature/sandbox/serial-reuse.md)。
- **[`--keep-sandbox`](feature/sandbox/cli.md) 与 `--reuse-sandbox`
  互斥**,组合在创建沙箱前报错:留存的现场必须属于那一次 attempt,不能
  被题间 `git reset` 抹掉后再当现场留下。预热池不受影响——run 结束时未
  被领用的池内沙箱照常销毁,留存只作用于跑过 attempt 的沙箱。

## 缓存:携带上一轮的结果

规划阶段,运行器对每条 eval 算 `(eval 代码 + 相关配置)` 的指纹
(`runner/fingerprint.ts`),据此决定哪些已落盘的 attempt 直接携带合入
本次 Run、哪些要真派发。派发的只是过不了判据的那些,所以「改一个 case
重跑」只花那一个 case 的时间,而不是全量。

指纹的输入清单、携带要过的门(条目侧的终态 / 指纹 / `timeoutMs` 资格 /
出身,调用侧的 `--rerun` 口径与执行模式)、attempt 粒度与并发多开下的
重规划,完整契约单源在
[Experiments · 缓存与携带](feature/experiments/cache.md)。

## 超时:双层保护

- **Adapter 内层超时** —— agent CLI 自己的超时。
- **运行器外层超时** —— attempt deadline 用 Effect 的 interruption
  中断 Scope 里的 verdict-producing 工作 fiber。超时折成 `errored`
  draft:`error.code = "timeout"`,`error.phase` = 中断时已打开的
  生命周期阶段。
- **外层 Scope 不关闭。** 有界收尾(teardown 链、留存决策)仍在同一个
  Scope 的 release 里照常完成,与
  [Sandbox 的 Scope / finalizer 模型](feature/sandbox/architecture.md#留存keep与注册表)
  同一套语义:即使 agent 卡死也能强行收尾。

外层是兜底,保证一个卡死的 case 不会挂起整批。

**deadline 从 `sandbox.create` 起算,不含等并发位的排队。** 一条 eval
拿到的执行预算因此只由 `timeoutMs` 决定,不随本次开了多大并发、队列排
多长而缩水。把排队算进去,同一条命令在 `--max-concurrency 2` 和 `20`
下就会产出不同的 `errored` 集合,还会加剧下面那条删失偏差——排得久的
条件被系统性更早截断。

落盘侧按同一口径记 `executionMs`(见
[Results · result.json](feature/record/architecture.md#resultjson)),
[携带资格判据](feature/experiments/cache.md#携带资格timeoutms-不进哈希)
拿它跟 `timeoutMs` 比,两侧量的是同一段时间。

**超时不丢证据。** 中断终止的是「继续执行」,不撤销「已经观察到的事实」。
事件接收器、usage 累计与 timing recorder 都归属 attempt 的外层 Scope,
不随 body fiber 一起消失——这与
[结果封口发生在 Scope release 之后](feature/record/architecture.md#resultjson)
是同一条纪律,从 timing 推广到全部证据通道。

超时 attempt 的落盘因此与正常 errored 同构:

| 证据通道 | 超时下落什么 |
|---|---|
| `events.json` | 截至中断时刻已归一化的全部事件。进行中一轮已收到的部分照常保留,不新增事件种类,中断事实由 `error` 表达 |
| `usage` | 已累计轮次的如实值 |
| `sources` | 照常 |
| `diff.json` | 收尾段在 teardown 链之前照常折叠一次 `workspace.diff`——沙箱此刻仍然活着,而「agent 走到了哪」正是超时诊断最需要的证据(计时记入收尾段,不入 `durationMs` 口径) |
| `artifacts` | 如实声明实际写出的文件 |

`show @<locator> --execution` 对超时 attempt 展示的是被打断前的真实执行
过程,不是空壳。

**超时线是删失线,不是中立的公平线。** `timeoutMs` 压在耗时分布上沿时,
测出的是「谁先撞线」而不是「谁做得完」。对每个 attempt 背着固定协议
开销的条件(记忆检索、额外收尾轮),同一条线系统性地更早截断它们;被
截断的样本又从完成耗时统计中消失,让慢条件反而显得快(幸存者偏差)。

超时线应显著高于全部条件的自然耗时上沿。耗时作为对比指标时按
[删失口径](feature/reports/library/metrics.md#内置指标)呈现,不把线值
当实测。

## 环境预置不进运行器,但按顺序调它

运行器不承载环境预置的内容,只固定各生命周期 Hook 的**调用点与顺序**,
Hook 内部做什么全部交给对应的作者决定。调用点从外到内:

```text
实验级 setup                    宿主机侧,每实验整场至多一次
  ├─ attempt ──────────────────────────────────────────────────────────
  │  Sandbox.create
  │  SandboxSpec.setup 链       环境层:装二进制、预热、写 hook 文件
  │  变更分类账锚点              锚点之后的改动才进归因视图
  │  EvalDef.setup              这条 eval 的任务 Fixture
  │  SandboxAgent.setup         agent 自己的一次性预置(装 CLI 等)
  │  test(t)                    作者的代码,顺序与次数核心不插手
  │  折叠 agent 归因增量 → 评分 → 判定
  │  EvalDef.teardown           ┐
  │  SandboxAgent.teardown      │ 与上面的 setup 逆序
  │  SandboxSpec.teardown 链    ┘ 回存跨 attempt 状态的时机
  │  沙箱销毁或留存
  └─────────────────────────────────────────────────────────────────────
实验级 teardown                 全部 attempt 收尾后。中断、强清退出也跑
```

四层 Hook 共用同一种形态:**成对的 `setup` / `teardown`,`setup` 不返回
值**——写过 Vitest / Jest 的人带着 `beforeAll` / `afterAll` 的心智直接
就能写。

| 层 | 挂载点 | 签名 | 节奏 | 管什么 |
|---|---|---|---|---|
| 实验级 | `ExperimentDef.setup` / `.teardown` | `(ctx) => void \| Promise<void>` | 每实验整场至多一次,宿主机侧 | 每实验一份的共享服务:隧道、mock server |
| 沙箱级 | `SandboxSpec.setup(fn)` / `.teardown(fn)` 链 | `(sandbox, ctx) => void \| Promise<void>` | 每沙箱一次 | 不知道跑哪个 eval 的环境层:装二进制、预热、载入/回存跨 attempt 状态 |
| agent 级 | `Agent.setup` / `.teardown` | `(sandbox, ctx) => void \| Promise<void>` | 每 attempt 一次 | 协议层:装 agent CLI、写鉴权 |
| eval 级 | `EvalDef.setup` / `.teardown` | `(sandbox, ctx) => void \| Promise<void>` | 每 attempt 一次 | 这条 eval 的任务 Fixture |

成对语义全局一致,三条规则:

- **状态经闭包流动,粒度跟层的节奏走。** `teardown` 要用 `setup` 的产物
  时不经 runner 中介。实验级整场一次,工厂闭包 / 模块级变量即可。每
  沙箱、每 attempt 的层(sandbox / agent / eval)里,并发 attempt 共享
  同一个模块,普通模块变量会互相覆写。两条出路:以 `sandbox` 实例为键
  存取(`WeakMap`,sandbox 与 attempt 一一对应),或先用
  `maxConcurrency: 1` 串行、再用普通变量。
- **`teardown` 当且仅当同层的 setup 时点已走到才执行。** `setup` 抛错
  不豁免——半初始化的现场同样要扫尾,`teardown` 对可能未赋值的闭包变量
  做防御(`tunnel?.stop()`)。未声明 `setup` 函数不影响触发(时点走到即
  算);时点没走到(实验一个 attempt 都没派发、attempt 没进行到该层)则
  `teardown` 同样跳过。
- **同层多个 Hook 按注册序 setup、逆序 teardown(LIFO)。** `setup` 链
  中途抛错时后续 `setup` 不再执行,`teardown` 链仍完整走完。

各层的语义与写法单源在各自的文档:实验级见
[Experiments · 实验级生命周期](feature/experiments/architecture.md#实验级生命周期setup-与-teardown)
(执行带 30s 清理上限),沙箱级见
[Sandbox · 沙箱生命周期 Hook](feature/sandbox/library.md#沙箱生命周期-hook-setup-与-teardown),
agent 级见
[Agent 契约](feature/adapters/architecture/agent-contract.md#生命周期不变量)。
写在哪层容易错位,见[环境预置与收尾怎么放](feature/experiments/use-case/lifecycle.md)。

跨实验共享、生命周期长于一次 run 的外部服务(共享 DB、公司内网服务
本体)仍然用外部编排(`docker compose` / CI 脚本)起停、经 env 传入
——这类资源跨进程共享,不属于任何一次 run 的生命周期。完整分工表见
[环境预置放哪](feature/sandbox/library.md#环境预置放哪)。

**下游分析**(二次评分、自定义指标)走 [reporter](observability.md#reporters),
不另设运行 Hook。这是从 agent-eval 的 `onRunComplete` 收敛过来的(见
[Experiments 砍字段](feature/experiments/architecture.md#设计参照从-agent-eval-砍掉了什么以及为什么));
NiceEval 自己的对应回调名是 `onInvocationComplete`。

## Reporter 与运行器事件

`Reporter` 是运行器与外部系统之间唯一的公开回调面:三个生命周期 Hook
加一条结构化事件流。跨 Experiment 的边界是当次 Invocation,不是持久化
Run。

```ts
interface Reporter {
  onEvent?(event: ReporterEvent): void | Promise<void>;
  onInvocationStart?(evals: { id: string }[], shape?: InvocationShape): void | Promise<void>;
  onEvalComplete?(result: EvalResult): void | Promise<void>;
  onInvocationComplete?(summary: InvocationSummary): void | Promise<void>;
}
```

`onInvocationStart` 只接收 `evals` 与 `shape`,不接收单一 `agent`。一次
Invocation 可能横跨多个 `(agent, model, flags)` 配置(`compare` 多
agent、一次运行选中多个实验文件),塞一个顶层 `agent` 参数只能代表其中
一份配置,对其余配置是谎言。需要知道这次 Invocation 涉及哪些 agent 时,
从陆续到达的逐条 `EvalResult.agent` 去重派生,不读启动参数里的单值。

```ts
/** onInvocationStart 的运行规模:去重后 eval 数 × 配置(agent×model×flags)数 → 总 attempt 数。 */
interface InvocationShape {
  /** 去重后实际要跑的 eval 数(= evals.length)。 */
  evals: number;
  /** (agent, model, flags) 配置组合数;compare 多 agent 时 > 1。 */
  configs: number;
  /** 总 attempt 数(evals × configs × attempts);逐行输出与汇总计数都按它。 */
  totalAttempts: number;
  /** 本次运行实际生效的全局并发数(flag/env/config/sandbox 默认值解析后的结果);
   *  实验级 maxConcurrency 只在该实验内部限流,不改这个全局值。 */
  maxConcurrency: number;
  /**
   * 本次 Invocation 的 Run 身份锚点(ISO 时间戳),在调度任何 attempt 前确定。fresh
   * `EvalResult.locator` 编码进去的 `snapshotStartedAt` 与 Artifacts writer 写进
   * `run.json` 的 `startedAt` 共用同一个值——不同 experiment 在同一次 Invocation
   * 内共享它也不会碰撞(locator 身份还含 experimentId)。省略只出现在测试/第三方手写
   * `InvocationShape` 的直调场景。
   */
  snapshotStartedAt?: string;
}

/** 一次 Invocation 的纯运行时内存聚合(reporter 契约用);落盘格式契约在 niceeval/record 的 RunMeta / AttemptRecord,见 [Results · Architecture](feature/record/architecture.md)。 */
interface InvocationSummary {
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
  startedAt: string;
  completedAt: string;
  passed: number;
  /** 断言不通过的数量;不包含 errored。 */
  failed: number;
  skipped: number;
  /** 环境、超时、adapter、agent runtime 等执行错误数量;与 failed 互斥。 */
  errored: number;
  durationMs: number;
  usage?: Usage;
  estimatedCostUSD?: number;
  results: EvalResult[];
}
```

`InvocationSummary` 同样不携带顶层 `agent` / `model`:跨配置的一次
Invocation 没有单一身份可填。每条 `EvalResult` 自带 `agent` / `model`,
需要按 agent 分组或统计时从 `results` 派生,不读一个必然对某些行撒谎的
顶层值。

这条裁决对内建与自定义 reporter 一视同仁——例如 Braintrust reporter 的
experiment 级 metadata 从收到的逐条 `EvalResult` 去重得到当次涉及的
agent 集合,而不是从启动参数读单一 agent。

`onEvent` 收到的结构化事件流:

```text
invocation:start           { evals, shape }
eval:start                 { eval, agent, model, attempt, experimentId }
eval:complete               { result }                # EvalResult,fresh 结果此时已带最终 locator(见下)
invocation:earlyExit        { evalId, experimentId }
invocation:budgetExceeded   { experimentId, budget, spent }
invocation:saved            { summary }
invocation:summary          { summary }
experiment:complete         { experimentId, completedAt, carriedResults, diagnostics, name? }
```

判别式联合逐条对应上表。`eval:start` 仍带单一 `agent`——它是单个 eval
这一次派发实际用的那份配置,不是跨配置汇总,不受上面顶层单值裁决约束。

```ts
type ReporterEvent =
  | { type: "invocation:start"; evals: { id: string }[]; shape: InvocationShape }
  | { type: "eval:start"; eval: { id: string }; agent: Agent; model?: string; attempt: number; experimentId?: string }
  | { type: "eval:complete"; result: EvalResult }
  | { type: "invocation:earlyExit"; evalId: string; experimentId?: string }
  | { type: "invocation:budgetExceeded"; budget: number; spent: number }
  | { type: "invocation:saved"; summary: InvocationSummary }
  | { type: "invocation:summary"; summary: InvocationSummary }
  | {
      type: "experiment:complete";
      experimentId: string;
      completedAt: string;
      carriedResults: EvalResult[];
      diagnostics: readonly DiagnosticRecord[];
      /** 项目名(来自 config.name),同一 Invocation 内所有 Experiment 共享同一个值。 */
      name?: LocalizedText;
    };
```

`verdict` 是互斥的判定分类:`passed` / `failed` / `errored` /
`skipped`,没有 `scored` 中间态。`invocation:summary.failed` 只统计断言
或评分不通过,环境、超时、adapter 或 agent runtime 问题统计到 `errored`。

fresh attempt 的最终 `locator` 在构造调度计划时就由预先确定的
`snapshotStartedAt` 与 attempt 身份算好并传入执行体。所以留存注册表、
feedback、`eval:complete` 与落盘 `result.json` 从第一次观察起就是同一个
值,reporter 不需要等 artifact 落盘。

终端反馈(human dashboard 与 `--json` 的单一 stdout 事件流)不消费这条
`Reporter` 事件流。它们由一个独立的反馈 coordinator 消费另一条内部事件
通道,只服务当前输出形态,不对外暴露,详见
[CLI · 反馈 coordinator](cli.md#反馈-coordinator一个-run-只有一个终端协调者)。

## Experiment 收尾协议

一次 Invocation 可以横跨多个 Experiment,但落盘的完整性单位是 Run——
每个 Experiment 一份、各自独立收尾(见
[Results · run.json](feature/record/architecture.md#runjson))。

`experiment:complete` 是比 `invocation:summary` 更早、比单个
`eval:complete` 更粗的事件,标记「这一个 Experiment 已经彻底跑完」。它
让内建 Artifacts 精确地在那一刻封口对应的 Run,而不是等整个 Invocation
结束才一次性封全部 Run。

- **触发时机**:该 Experiment 的 `ExperimentDef.teardown`(若声明)完成
  之后、`invocation:summary` 之前。
- **谁消费**:内建 `Artifacts` reporter 订阅它,对每个 experimentId 各自
  调用它自己 Run 的 `snap.finish({ completedAt, diagnostics, name })`
  (见 [Results · Library](feature/record/library.md))。
- **`name`**:整次 Invocation 共享的项目名(来自 `config.name`),随每个
  Experiment 各自的收尾一并落盘,不必等到 `invocation:summary` 才补写。
- **`carriedResults`**:该 Experiment 本次携带合入(fingerprint 命中、
  未真实执行)的历史终态结果,随收尾一并落盘。

跨 Experiment 共享的事实(用户中断、reporter 写失败、provider 级并发
提示)不属于任何单个 Experiment,不走这条事件。它们只出现在
`InvocationCompletion.reporterErrors` 或反馈流的运行级 diagnostic 里。

## 实验域诊断持久化

有一类操作性事实**属于某次 Run 整体、但定位不到单个 Attempt**——
teardown 失败、budget 不可执行、实验级 Hook 超时。这类事实必须落进对应
Run 的 `diagnostics`(见
[Results · run.json](feature/record/architecture.md#runjson))。只出现
在运行期的终端反馈里不算完:反馈是这一次运行的即时通知,`run.json` 才是
这次运行「发生过什么」的永久记录。

产生处必须显式给出:

```ts
interface ExperimentDiagnosticInput {
  experimentId: string;
  code: string;
  level: "warning" | "error";
  message: string;
  /** 只能是产生处真实打开的生命周期阶段,实验域诊断通常是 "experiment.setup" / "experiment.teardown"。 */
  phase: LifecyclePhase;
  data?: Readonly<Record<string, JsonValue>>;
  command?: string;
  /** 同一 Run 内的折叠键;省略时以 code 折叠。 */
  dedupeKey?: string;
}
```

`experimentId` 只用于把这条诊断路由到正确的 Run,不进入持久化的
`DiagnosticRecord`。持久化形状与 attempt 级 `DiagnosticRecord` 完全一致
(见 [Results · run.json](feature/record/architecture.md#runjson)),因为
归属已经隐含在该记录所属的 `run.json` 身份里,不重复存。

相同 `dedupeKey`(或省略时的 `code`)只在同一个 Run 内折叠、`count`
递增;不同 Experiment、不同 Run 各自独立计数,不跨来源合并。

这条持久化通路与运行期的即时反馈通路(`ctx.diagnostic` → 反馈流 →
人读文本 / `--json` 展示)相互独立、互不派生:运行期反馈让操作者第一
时间看到问题,持久化让读者事后从 `run.json` 回顾。

消费方(内建 Artifacts reporter、自定义 reporter)不得靠解析反馈流通知
的 key 或 message 反推该往哪个 Run 写。每个产生处直接构造上面的
`ExperimentDiagnosticInput`,由运行器在该 Experiment 域内按 Run 累计,
再通过 [`experiment:complete`](#experiment-收尾协议) 事件整批交给
Artifacts,由它在对应 Run 封口时一次写入。

## 完成状态

verdict 计数回答「每条 eval 判定成什么」,不回答「这次运行是否完整覆盖
了计划」。完成状态是独立于 verdict 计数的第二个结论:

```ts
type CompletionStatus = "complete" | "incomplete" | "interrupted";

interface InvocationCompletion {
  status: CompletionStatus;
  /** budget 耗尽、run 级 fail-fast 或止损闸落下导致未派发的 attempt 数。 */
  unstarted: number;
  /** 首过即停在已知 verdict 下主动省略的计划次数——省下的重复验证,不算"未完整覆盖"。 */
  earlyExitUnstarted: number;
  reporterErrors: readonly ReporterError[];
}
```

- budget 耗尽、确定性错误触发 run 级 fail-fast(见[首过即停](#首过即停earlyexit)),
  或作者声明的止损闸落下(见
  [执行失败分类 · 止损语义](feature/error-classification/README.md#止损语义))
  而停止派发时 → `incomplete`,`unstarted` 是这几类未派发 attempt 的
  合计。
- 用户或平台中断(Ctrl+C / SIGTERM)→ `interrupted`。
- 任一 [required reporter](cli.md#required-reporter) 写失败 → 非
  `complete`;失败明细进 `reporterErrors`,`required` 字段区分它是否让
  整体判红。
- 首过即停省略的重复验证次数单独计入 `earlyExitUnstarted`,不进入
  `unstarted`——它是已知 verdict 下主动省下的成本,不是遗漏。

CI 的最终结论(退出码、`result` 事件)必须读当场的
`InvocationCompletion`,不能只看 `passed` / `failed` / `errored` 计数:
预算耗尽但零 `failed` / `errored` 的一次 Invocation 仍然不是「全绿」。

这个结论不自动进入 `.niceeval/`;需要留档时配置 `Json(path)` reporter
写 `InvocationSummary`。

## 退出码

退出码由 `InvocationCompletion.status` 与按 `(experiment, eval)` 折叠后
的 verdict 共同决定。两种输出形态(见
[Experiments · CLI 反馈模型](feature/experiments/cli.md))共用同一套
语义:

- `0` —— `status: "complete"`,且没有任一 `(experiment, eval)` 组合判定
  为 `failed`(含 `--strict` 下 soft 未达标而改判的)或 `errored`。
- `1` —— 至少一个组合 `failed` / `errored`;或 `status: "incomplete"`
  (budget 未覆盖全部计划);或存在 required reporter 写失败。
- `2` —— CLI / 运行器未捕获的崩溃。
- `130` —— `status: "interrupted"`(用户或平台中断)。

退出码按 eval 折叠,不按 attempt 折叠:同一个 eval 被 `attempts` +
`earlyExit` 重试吸收的失败(先挂一次、后来某次通过)不会让进程判红,
只有该 eval 最终判定为 `failed` / `errored` 才计入。

## 相关阅读

- [Architecture](architecture.md) —— 运行器在四段数据流里的位置与端到端时序。
- [并发怎么配](feature/experiments/use-case/concurrency.md) —— 两级闸的
  搭配速查:串行 / 降速 / 严格重试 / 快慢混跑。
- [Experiments · 缓存与携带](feature/experiments/cache.md) —— 指纹输入、携带判据与 `--rerun` 三档的单源。
- [Experiments · CLI 反馈模型](feature/experiments/cli.md) —— 人读文本与
  `--json` 怎样展示这篇讲的调度、预算与完成状态。
- [CLI](cli.md) —— `exp` 怎么把这些调度行为接进 Effect 核心与反馈 coordinator。
- [Sandbox](feature/sandbox/README.md) —— 预热与复用的 provider 支持,以及环境预置放哪。
- [Observability](observability.md) —— 运行器产出的 artifact 与报告。
