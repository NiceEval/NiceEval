# Runner —— 执行引擎

运行器是把"一批 eval"变成"一份结果"的调度引擎。它拥有对所有被测对象都一样的部分:发现、有界并发、首过即停、缓存、报告编排。被测对象的差异它一概不管 —— 它只对着 `Agent` 接口(统一动词 `send`)驱动。

## 职责边界

运行器**做**:发现 eval、算指纹决定跳过、建 attempt 列表、有界并发调度、首过即停、把结果交给报告器、落盘 artifact、定退出码。

运行器**不做**:不知道怎么驱动 agent(那是 Agent/Adapter)、不知道怎么打分(那是 Scorer)、不知道结果存哪种格式细节(那是 Reporter)。它是协调者,不是执行者。

## 发现

`runner/discover.ts` 扫 `evals/`:

- 找所有 `*.eval.ts` 与 `*.eval.tsx`(两种扩展名同等对待,`.tsx` 供要在 eval 里写 JSX 的场景),`import` 后看默认导出 —— 单个 eval 用文件 id；数组按位置扇出并加零填充索引(`sql/0000`)；keyed record 按合法业务 key 扇出(`swelancer/15193`)并按 key 字典序稳定排列。没有另一种基于目录约定的隐式发现——沙箱型 eval 也必须有一个 eval 文件。
- 按相对路径排序,保证 id 稳定、输出可比。
- 应用过滤:`niceeval exp <组|配置>` 后的位置参数(id 前缀,如 `weather` 命中 `weather/*`)、`--tag`。
- `niceeval exp` 时另从 `experiments/` 扫实验文件(默认导出 `defineExperiment` 的 `.ts`),据路径推导实验 id；目录路径只支持批量选择。实验的 `evals` 遍历发现结果并筛出要跑的 eval(见[矩阵展开](#矩阵展开与通过率))。

## 调度:有界并发

核心调度用 `Effect.forEach({ concurrency: "unbounded" })` + **两级并发闸**实现:每个 attempt 立刻有自己的 fiber,但执行体要先过实验级闸(`ExperimentDef.maxConcurrency`,可选,先来后到)、再拿到全局并发位(全局 `maxConcurrency`,空位按瓶颈优先分配,纪律见[下一节](#派发顺序瓶颈优先追求最小总墙钟时间))才真正开跑。实验级闸只让该实验自己的 attempt 排队,同批其它实验照常并发——串行化有共享状态的实验(如跨 eval 累积记忆,`maxConcurrency: 1`)不再拖慢整批基线。报告回调走 **permit=1 的信号量串行化**,不阻塞执行 fiber。结果最后按**发现顺序**排序(而非完成顺序),让输出稳定可 diff。

全局并发上限来源:`--max-concurrency` → 配置 `maxConcurrency` → **该沙箱 provider 的推荐默认值**。推荐值反映的是 **provider 侧**约束(daemon 容量、API 配额、session 池大小),不是你的 agent API 限速——后者自己用 `--max-concurrency` 压。「云的就能开大」这个直觉是错的:`docker` 10(本地 daemon 建容器有开销)、`e2b` 20(账户配额的保守估计)、**`vercel` 1**(sandbox session 并发限制严,再高就 429)、`local` 1,自定义 provider 取它自己声明的 `recommendedConcurrency`(省略则 5)。实验文件里的 `maxConcurrency` 不参与这条全局解析,只在该实验内部限流。

provider 还可以声明**独占串行**(`exclusive`):该 provider 的所有 attempt 共享同一份不可并发的底层资源(如 `local` 的同一棵真实工作树),runner 对它加一道 provider 级串行闸——显式 `--max-concurrency` 或实验级 `maxConcurrency` 都不解除,同批其它 provider 照常并发。这是正确性约束,不是调度参数;声明是中性的 provider 元数据,核心不按 provider 名分支(契约见 [Sandbox · 本地执行](feature/sandbox/local.md))。

## 派发顺序:瓶颈优先,追求最小总墙钟时间

attempt 的**派发**顺序(全局并发位分配给谁的顺序)按**整批跑完的总墙钟时间最短**这个目标排,不是发现顺序,也不是请求先后。判断一个 run 是不是瓶颈,不能只看它的 `maxConcurrency` 有多紧,还要看它有多少 attempt 要排这条队——`maxConcurrency: 1` 但只有 1 个 attempt 的 run 谈不上瓶颈,`maxConcurrency: 5` 但有 500 个 attempt 的 run 才是。两者合起来才是这个 run 需要多少**轮次**才能跑完:轮次越多,越早、越连续地占用并发位,总时长才接近"瓶颈自身的串行耗时",而不是"瓶颈耗时 + 排在它前面的其它 run 先跑完的耗时"。轮次少或不设实验级上限的 run 不构成瓶颈,随时见缝插针补进空出来的并发位,晚发不拖尾。这一层不影响结果排序——结果仍按发现顺序输出(见上一节)。

优先级绑定在**并发位的分配**上,不是 fiber 的创建顺序上:每当有并发位空出(初始的 `maxConcurrency` 个位视为同样多次空出),发给**当前正在等待的 attempt 中优先级最高的那个**——轮次数降序,同轮次的 run 保留发现顺序,同 run 内保留 attempt 顺序;「谁先开始等」不参与裁决。这样定是因为 attempt 在请求并发位之前可能还有别的事要做——最典型是[实验级 `setup`](feature/experiments/architecture.md#实验级生命周期setup-与-teardown) 的宿主机等待——而瓶颈 run 恰恰常是带慢 setup 的实验(隧道、共享记忆服务):若按先来后到分配,它等完 setup 时队伍早被无 setup 的宽并发 run 排满,优先级在最需要生效的场景恰好失效。

与实验级 setup 的组合是工作保全(work-conserving)的:等待 setup 的 attempt 不持有也不预留并发位,期间空位照常发给低优先级 run 见缝插针;setup 完成后该 run 按原优先级参与下一次分配。代价是一次有界的起步延迟——setup 结束时若并发位全满,要等在飞 attempt 中最先完成的那个,上界是一个 attempt 的耗时,且每个实验整场只付一次(第一个 attempt 挤进去之后,该 run 后续 attempt 一直按优先级拿位)。

不为 setup 中的瓶颈 run **预留**并发位,是拿这次一次性延迟换掉一个更差的尾部风险:setup 的耗时事先不可知、也可能失败(隧道冷启动重试、服务拉不起来),预留等于拿一个并发位押注一段长度未知、可能白等的等待——真烧起来的时长没有上界,而且失败时那个位是纯亏。相比之下 backfill 的代价有上界、可预测,也不因 setup 失败而放大。也不**抢占**在飞的 attempt:已花的沙箱与 token 成本不可回收。

推荐算法(单次 attempt 耗时未知且假设同批内大致均匀,轮次数就是耗时的代理指标——这是把 identical-machine 调度的 LPT 规则推广到「moldable job」场景的标准做法;「空位给最高优先级等待者 + 低优先级见缝插针」即批调度器的 backfilling,且每个 attempt 只要一个并发位,不需要多资源预留式 backfill 的复杂度):

```text
effectiveWidth(run) = min(run.maxConcurrency ?? globalMaxConcurrency, globalMaxConcurrency)
priority(run)       = rounds(run) = ceil(attemptsOf(run).count / effectiveWidth(run))

onSlotFree():   # 初始 globalMaxConcurrency 个并发位视为同样多次空出
  grant(等待集中排序最前者)   # priority 降序 → run 发现顺序 → run 内 attempt 顺序
```

`priority` 只在建 attempt 列表时算一次(用规划阶段已知的「每个 run 有多少 attempt」),不随运行中 earlyExit / fail-fast / budget 实际提前收尾而重算——那是动态优先级调整,复杂度不值得为一个尽力而为的启发式引入。实验级闸(`ExperimentDef.maxConcurrency`)不参与这条纪律,先来后到即可:同一 run 的 attempt 优先级相同,它们内部谁先谁后不影响总墙钟。等待中的 attempt 被中止(earlyExit、fail-fast、用户中断)时退出等待集,不占用后续分配。

一次 `exp` 运行把按路径选中的多个单一配置展成 attempt，再 × `eval × runs`；每个配置先用自己的 `evals` 谓词遍历发现结果。比如 2 个实验配置 × `runs: 5` × 3 个 eval = 30 个 attempt。汇总按 `(agent, model, eval)` 分组,不再是单一判定,而是**通过率** + 平均耗时 / token / 成本:

```text
fixtures/button   claude-code   pass@5 = 4/5 (80%)   mean 34s · 58k tok · $0.44
fixtures/button   codex         pass@5 = 3/5 (60%)   mean 41s · 72k tok · $0.39
```

用于衡量 agent 的稳定性(一次过 ≠ 可靠),以及跨 agent 的**质量 × 成本**对比。不写实验时退化成单 agent × `runs`。

## 首过即停(earlyExit)

取通过率本可以跑满 N 次,但若只关心"能不能做到",先过一次即可停其余:

- 每个 eval 配一个 `AbortController`。
- **只有 `passed` 触发首过即停**:某 attempt 通过且 `earlyExit` 开 → `abort()` 同 eval 其余 attempt;被 abort 的不计入分母。`run:earlyExit` 事件只在实际省略了至少一个轮次时发出——最后一轮才通过时没有可省的轮次,不发事件。
- `errored` 不触发:超时、限流、沙箱挂掉这类瞬态基建错误在下一个 attempt 上完全可能自愈,因一次 errored 停掉其余样本等于放弃重试机会,还会把基建抖动放大成整题无结果。
- 确定性错误不靠 earlyExit 兜,走独立的 **run 级 fail-fast**:凭据缺失、模板不存在、作者代码必现抛错这类同因必复现的错误,识别出(预检命中,或同一错误 code 在同一 eval 连续复现)即停止派发受同一配置影响的后续 attempt,如实报 errored——这是止损,不是「首过即停」,两个机制互不混用。turn 层的瞬时故障(限流、连接建立失败)在进入这条判定之前已被有界重试吸收,streak 看到的 `turn-failed` 是重试耗尽后的最终结果(契约见[执行错误类型](feature/error-classification/README.md))。
- 默认关;`runs` 因此默认跑满 N 次,给出完整通过率分布——这是这个工具的核心指标(衡量 agent 稳不稳,见[矩阵展开](#派发顺序瓶颈优先追求最小总墙钟时间)),默认不该被无声截断。只想知道"能不能做到"、不在乎分布时,显式 `earlyExit: true`(或 `--early-exit`)打开。
- **earlyExit 不改变派发节奏,只减少已派发的浪费**:同一个 eval 的多个 attempt 该不该并发跑,由 [有界并发](#调度有界并发)的并发位数(实验级 `maxConcurrency` 或全局 `maxConcurrency`)决定,与 earlyExit 是否开无关——`runs: N` 建的 N 个 fiber 一起进等待集,有几个位就并发跑几个,不会等前一个出结果再决定要不要派发下一个(同一个 run 的 attempt 优先级相同,它们之间按 attempt 顺序拿位)。earlyExit 只在其中某个已经 `passed` 后,abort 掉**还在等待集里**的其余 fiber;已经在跑的不受影响,跑完照样计入(除非 provider/adapter 自己接了 abort signal 提前终止)。
- 因此,「探到一次能过就停,过不了才继续跑下一次」这种严格串行的重试语义,是 `maxConcurrency: 1` 与显式 `earlyExit: true` 组合出的效果:实验级闸只放一个时,同 eval 的 attempt 只能一个接一个过闸,前一个不出闸,后一个进不去;前一个 `passed` 时 abort 掉还没出闸的后续,天然就是"过了就停"。不设 `maxConcurrency: 1`(如实验级默认继承全局并发)时,`runs` 的多次 attempt 可能同一时刻就有好几个在跑,earlyExit 能省下的只是**这些已经在飞的之外、原本还要排队的那些**。

## 预算护栏(budget)

budget 按**域**计,不是全局总闸:每个 experimentId 一个域(没有 experiment 时按 agent 名),实验的 `budget` 字段与 `--budget` 覆盖设定的都是**每个域各自**的上限——一次运行选中 N 个实验,就是 N 份各自独立的上限,总花费上界是各域之和。运行器只按**已完成 attempt 的实测花费**判断:一个域的已完成花费一旦到顶,就**停止向该域派发新 attempt**——已经在飞的照常跑完,不会被中途打断;到顶之前不做任何预测性节流,并发完全由 `--max-concurrency` 与实验级 `maxConcurrency` 决定。这是有意的取舍:budget 是防止无限烧钱的安全网,不是精确计费闸,不应该反过来限制吞吐——已花 + 在飞未结算的总花费可能因此短暂超出 budget。连续多个**已经发起 agent turn** 的 attempt 都拿不到成本数据(agent 不报用量)时,budget 对该域不可执行,运行器给一条去重后的 warning 而不是每个 attempt 重复提示；`sandbox.create`、setup 等发生在首个 agent turn 之前的错误没有成本事实,只报告其结构化 attempt error,不额外产生 budget warning。

预算耗尽而导致的未派发 attempt 数量计入运行[完成状态](#完成状态)的 `unstarted`,让整次运行的结论落在 `incomplete`,不能在 CI 里伪装成全绿。

## 预热与复用:冷启动移出关键路径

沙箱冷启动的优先级排序(先预制环境、再小 setup、最后才是池化)在 [Sandbox · 性能](feature/sandbox/architecture.md#性能预制环境复用与预热)——provider 侧提供"创建、重置、销毁"的能力;什么时候预创建、什么时候复用是运行器的调度决策,契约如下:

- **预热池**:开启后,运行器在调度开始时按 `min(预热池大小, 计划 attempt 数)` 预先创建同 spec 沙箱挂进池里;attempt 到达 `sandbox.create` 阶段时先领池中现货,领到则该阶段只计领取耗时,池空则回落到即时创建。池只在同一次 run 内存活,run 结束时未被领用的沙箱一并销毁。预热池不改变生命周期钩子的调用顺序:领到的沙箱仍在 attempt 里按[固定调用链](feature/sandbox/architecture.md#沙箱在生命周期里的位置)走一遍 `sandbox.setup` 链与分类账锚点。
- **串行复用**:`--reuse-sandbox` 打开后,整批同基线 eval 共用一个热沙箱串行跑:不随 eval 变的层(`createSandbox`、`sandbox.setup` 链、`SandboxAgent.setup`)整组只执行一次,落成温基线 commit;题间把 workdir 重置回温基线(`git reset --hard` + 尊重分类账排除清单的 `git clean`),每题只重放 `EvalDef.setup` / `test(t)` 夹具。复用与并发互斥(一个热沙箱 = 一条执行道,并发钉成 1,显式 `--max-concurrency` 组合是创建前的用法错误),复用与指纹缓存双向绝缘(不消费携带、不产生命中);完整契约——温基线分层、诚实边界、同基线批次约束——见 [Sandbox · 串行复用](feature/sandbox/serial-reuse.md)。
- [`--keep-sandbox`](feature/sandbox/cli.md) 与 `--reuse-sandbox` 互斥,组合在创建沙箱前报错:留存的现场必须属于那一次 attempt,不能被题间 `git reset` 抹掉后再当现场留下。预热池不受影响——run 结束时未被领用的池内沙箱照常销毁,留存只作用于跑过 attempt 的沙箱。

## 缓存:指纹去重

`runner/fingerprint.ts` 对每个 eval 算 `(eval 代码 + 相关配置)` 的哈希:

- 上次判定是 `passed` 或 `failed`、且指纹未变 → 默认**跳过**,结果**携带合入**本次快照(带 `artifactBase` 指回原 artifact,落盘语义见 [Results · 两类条目](feature/results/architecture.md#resultjson)),最新快照因此保持完整。两者都是"跑完了、判定确定"的终态,没理由重花一次 agent/sandbox 成本去复现同一个已知结果。
- **携带以 attempt 为粒度,缺失序号补跑。** 指纹未变时,上一轮已落盘的终态 attempt 逐条携带,本轮只派发计划内缺失的 attempt 序号——`runs: 5` 已有 3 条终态就只补跑 2 条,通过率的分母由携带与新跑共同凑满。携带的 `passed` 与首过即停组合遵守既有语义:已携入通过且 `earlyExit` 开时,缺失序号不再派发,计入 `earlyExitUnstarted`。
- **携带来源不要求快照收尾。** attempt 的 `result.json` 在收尾链完成后一次写成,判定可信与否与快照有没有补上 `completedAt` 无关;被中断或强杀的 run 留下的未收尾快照,其中已落盘的终态 attempt 照常携带。**重跑同一条命令就是续跑**:只花缺失 attempt 的成本——这也是长 run 撞上外部看门狗(CI 时限、宿主超时强杀)后的恢复路径,配合[实验面的启动自愈](feature/experiments/architecture.md#强杀后的收尾兜底收尾登记与启动自愈)与[实例面的孤儿核对](feature/sandbox/architecture.md#孤儿核对强杀路径的实例面兜底),重跑前不需要任何手工清理。
- **执行模式 flag 划走两块例外。** [`--reuse-sandbox`](feature/sandbox/serial-reuse.md#与留存缓存重试的组合) 与指纹缓存**双向绝缘**:复用 run 不消费携带,计划内每个 attempt 都真实在热道上跑;复用产出也永不成为后续 run 的缓存命中。绝缘让一份快照里的结果只有一种出身,不会混出「一半干净携带、一半污染复用」的分布。[`--keep-sandbox`](feature/sandbox/cli.md) 下,历史终态 verdict 落在**当前留存档内**的 attempt 不携带、照常派发重跑:留存要的是一次真实执行的现场,携带条目没有沙箱可留——`failed` 档下 `failed` 重跑、`passed` 照常携带,`all` 档下全部重跑。
- 改了 fixture、改了配置、或 `--force` → 重跑。
- `errored`(框架/环境层面的不确定失败,如超时、沙箱挂了)和 `skipped` 不缓存,总会重试——它们的判定本身不可信,不是可复用的终态。

让"改一个 case 重跑"只花那一个 case 的时间,而不是全量。

## 超时:双层保护

- **Adapter 内层超时** —— agent CLI 自己的超时。
- **运行器外层超时** —— attempt deadline 用 Effect 的 interruption 中断 Scope 里的 verdict-producing 工作 fiber,把超时转换成 `errored`(error: timeout)draft;外层 Scope 不关闭,有界收尾(teardown 链、留存决策)仍在同一个 Scope 的 release 里照常完成——与 [Sandbox 的 Scope / finalizer 模型](feature/sandbox/architecture.md#留存keep与注册表)同一套语义,即使 agent 卡死也能强行收尾。

外层是兜底,保证一个卡死的 case 不会挂起整批。

## 环境预置不进运行器,但按顺序调它

运行器不承载环境预置的内容,只固定各生命周期钩子的**调用点与顺序**,钩子内部做什么全部交给对应的作者决定。

四层钩子共用同一种形态:**成对的 `setup` / `teardown`,`setup` 不返回值**——写过 Vitest / Jest 的人带着 `beforeAll` / `afterAll` 的心智直接就能写:

| 层 | 挂载点 | 签名 | 节奏 |
|---|---|---|---|
| 实验级 | `ExperimentDef.setup` / `.teardown` | `(ctx) => void \| Promise<void>` | 每实验整场至多一次,宿主机侧 |
| 沙箱级 | `SandboxSpec.setup(fn)` / `.teardown(fn)` 链 | `(sandbox, ctx) => void \| Promise<void>` | 每沙箱一次 |
| agent 级 | `Agent.setup` / `.teardown` | `(sandbox, ctx) => void \| Promise<void>` | 每 attempt 一次 |
| eval 级 | `EvalDef.setup` / `.teardown` | `(sandbox, ctx) => void \| Promise<void>` | 每 attempt 一次 |

成对语义全局一致,三条规则:

- **状态经闭包流动,粒度跟层的节奏走**:`teardown` 要用 `setup` 的产物时不经 runner 中介。实验级整场一次,工厂闭包 / 模块级变量即可;每沙箱、每 attempt 的层(sandbox / agent / eval)里,并发 attempt 共享同一个模块,普通模块变量会互相覆写——以 `sandbox` 实例为键存取(`WeakMap`,sandbox 与 attempt 一一对应),或先用 `maxConcurrency: 1` 串行、再用普通变量。
- **`teardown` 当且仅当同层的 setup 时点已走到才执行**:`setup` 抛错不豁免——半初始化的现场同样要扫尾,`teardown` 对可能未赋值的闭包变量做防御(`tunnel?.stop()`);未声明 `setup` 函数不影响触发(时点走到即算);时点没走到(实验一个 attempt 都没派发、attempt 没进行到该层)则 `teardown` 同样跳过。
- **同层多个钩子按注册序 setup、逆序 teardown(LIFO)**;`setup` 链中途抛错时后续 `setup` 不再执行,`teardown` 链仍完整走完。

调用点从外到内:

- **实验级** —— `ExperimentDef.setup` / `.teardown`:每实验整场至多一次、宿主机侧;`setup` 在本实验第一个要派发的 attempt 前跑,`teardown` 在全部 attempt 收尾后跑(中断、强清退出也跑,执行带 30s 清理上限);管每实验一份的共享服务(隧道、mock server),语义见 [Experiments · 实验级生命周期](feature/experiments/architecture.md#实验级生命周期setup-与-teardown)。
- **沙箱级** —— 沙箱创建后、变更分类账锚点之前,运行器调用 `experiment.sandbox` 链上挂的环境钩子(`SandboxSpec.setup()` / `.teardown()`,见 [Sandbox · 沙箱生命周期钩子](feature/sandbox/library.md#沙箱生命周期钩子setup--teardown))。
- **eval 级 / agent 级** —— 沙箱固定段("发现 → 调度 → 沙箱起停 / 分类账锚点 / 折叠 agent diff → 评分 → 报告"这条主轴)之内,还分出这条 eval 的任务夹具(`EvalDef.setup` 或 `test(t)`)和 agent 自己的一次性预置([`SandboxAgent.setup`](feature/adapters/architecture/agent-contract.md#生命周期不变量))。

跨实验共享、生命周期长于一次 run 的外部服务(共享 DB、公司内网服务本体)仍然用外部编排(`docker compose` / CI 脚本)起停、经 env 传入——这类资源跨进程共享,不属于任何一次 run 的生命周期。完整分工表见 [环境预置放哪](feature/sandbox/library.md#环境预置放哪)。

**下游分析**(二次评分、自定义指标)走 [reporter](observability.md#reporters),不另设运行钩子——这是从 agent-eval 的 `onRunComplete` 收敛过来的(见 [Experiments 砍字段](feature/experiments/architecture.md#从-agent-eval-砍掉了什么以及为什么))。

## 运行器事件

`Reporter.onEvent` 收到一串结构化事件,把结果同步到 artifact、CI 报告或外部平台:

```text
run:start           { evals, agent, shape }   # shape = { evals, configs, totalRuns, maxConcurrency, snapshotStartedAt }
eval:start          { eval, agent, model, attempt, experimentId }
eval:complete       { result }                # EvalResult,fresh 结果此时已带最终 locator(见下)
run:earlyExit       { evalId, experimentId }
run:budgetExceeded  { budget, spent }
run:saved           { summary }
run:summary         { summary }
```

`verdict` 是互斥的判定分类:`passed` / `failed` / `errored` / `skipped`,没有 `scored` 中间态。`run:summary.failed` 只统计断言/评分不通过,环境、超时、adapter 或 agent runtime 问题统计到 `errored`。fresh attempt 的最终 `locator` 在构造调度计划时就由预先确定的 `snapshotStartedAt` 与 attempt 身份算好并传入执行体,所以留存注册表、feedback、`eval:complete` 与落盘 `result.json` 从第一次观察起就是同一个值;reporter 不需要等 artifact 落盘。

终端反馈(human dashboard、agent envelope、CI 的单一 stdout 事件流)不消费这条 `Reporter` 事件流——它们由一个独立的反馈 coordinator 消费另一条内部事件通道,只服务 `--output` 选出的 profile,不对外暴露,详见 [CLI · 反馈 coordinator](cli.md#反馈-coordinator一个-run-只有一个终端协调者)。

## 完成状态

verdict 计数回答"每条 eval 判定成什么",不回答"这次运行是否完整覆盖了计划"。完成状态是独立于 verdict 计数的第二个结论:

```ts
type CompletionStatus = "complete" | "incomplete" | "interrupted";

interface RunCompletion {
  status: CompletionStatus;
  /** budget 耗尽导致未派发的 attempt 数。 */
  unstarted: number;
  /** 首过即停在已知 verdict 下主动省略的计划次数——省下的重复验证,不算"未完整覆盖"。 */
  earlyExitUnstarted: number;
  reporterErrors: readonly ReporterError[];
}
```

- budget 耗尽或确定性错误触发 run 级 fail-fast(见[首过即停](#首过即停earlyexit))而停止派发时 → `incomplete`,`unstarted` 是这两类未派发 attempt 的合计。
- 用户或平台中断(Ctrl+C / SIGTERM)→ `interrupted`。
- 任一 [required reporter](cli.md#required-reporter) 写失败 → 非 `complete`;失败明细进 `reporterErrors`,`required` 字段区分它是否让整体判红。
- 首过即停(earlyExit)省略的重复验证次数单独计入 `earlyExitUnstarted`,不进入 `unstarted`——它是已知 verdict 下主动省下的成本,不是遗漏。

CI 的最终结论(退出码、`niceeval: result=...` 行)必须读 `RunCompletion`,不能只看 `passed` / `failed` / `errored` 计数——预算耗尽但零 `failed` / `errored` 的一次运行仍然不是"全绿"。

## 退出码

退出码由 `RunCompletion.status` 与按 `(experiment, eval)` 折叠后的 verdict 共同决定;三种 `--output` profile(见 [Experiments · CLI 反馈模型](feature/experiments/cli.md))共用同一套语义:

- `0` —— `status: "complete"`,且没有任一 `(experiment, eval)` 组合判定为 `failed`(含 `--strict` 下 soft 未达标而改判的)或 `errored`。
- `1` —— 至少一个组合 `failed` / `errored`;或 `status: "incomplete"`(budget 未覆盖全部计划);或存在 required reporter 写失败。
- `2` —— CLI / 运行器未捕获的崩溃。
- `130` —— `status: "interrupted"`(用户或平台中断)。

退出码按 eval 折叠,不按 attempt 折叠:同一个 eval 被 `runs` + `earlyExit` 重试吸收的失败(先挂一次、后来某次通过)不会让进程判红,只有该 eval 最终判定为 `failed` / `errored` 才计入。

## 相关阅读

- [Architecture](architecture.md) —— 运行器在四段数据流里的位置与端到端时序。
- [Experiments · CLI 反馈模型](feature/experiments/cli.md) —— human / agent / ci 三种 profile 怎样展示这篇讲的调度、预算与完成状态。
- [CLI](cli.md) —— `exp` 怎么把这些调度行为接进 Effect 核心与反馈 coordinator。
- [Sandbox](feature/sandbox/README.md) —— 预热与复用的 provider 支持,以及环境预置放哪。
- [Observability](observability.md) —— 运行器产出的 artifact 与报告。
