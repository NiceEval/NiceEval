# Sandbox —— 串行复用:一个热沙箱跑一批

`--reuse-sandbox` 让一次 run 里若干 eval 串行共用同一个已经装好的沙箱:题与题之间只把 workdir 的 git 工作树重置回干净基线,不重建沙箱、不重跑任何与本题无关的 setup。它是[跨 case 复用](architecture.md#性能预制环境复用与预热)的完整契约。

## 动机:本地迭代的反馈环被冷启动吃掉

默认执行模型是每个 attempt 一套全新沙箱——隔离、可复现、可并发(见 [Sandbox · 为什么需要沙箱](README.md#为什么需要沙箱))。这在 CI 批跑里是对的,但在**本地边写 eval 边试**的场景里,每题都要付一次冷启动:Docker 建容器、slim 镜像补 `git` / `ca-certificates`、`npm install` 装依赖、`SandboxAgent.setup` 装 agent CLI。一条真正跑起来几秒的 eval,前面压着几十秒的准备,反馈环被这段固定开销主导,改一行断言重跑一次的体验很差。

这段开销里绝大部分是**所有 attempt 都相同、与本题无关**的:agent CLI 是同一个,系统依赖是同一套,工作区骨架往往也一样。预制环境([`dockerSandbox({ image })`](library/prebuilt-environments.md))已经把「装什么」搬到构建期,但没有解决「每题重新起一个实例、重新进一次 setup」——冷启动本身还在关键路径上。

北极星是**贴身的本地 eval 迭代**:一个装好的沙箱热在那里,题与题之间一个 `git reset` 就回到干净起点,下一题近乎立即开跑。它天然配一个 watch / dev 循环(改文件即重跑),但 watch 不在本文范围内,本文只交付「复用一个热沙箱」这一层。

## 契约

### 温基线:一次装好,后续只重置到这里

「不需要 setup」的精确含义,是把当前 attempt 生命周期([Sandbox 架构 · 沙箱在生命周期里的位置](architecture.md#沙箱在生命周期里的位置))里的各层按「随不随 eval 变」重新切一刀:

| 生命周期阶段 | 随 eval 变? | 复用模式下 |
|---|---|---|
| `createSandbox` | 否 | 整组 eval **一次** |
| `sandbox.setup`(环境层钩子) | 否 | 整组 eval **一次** |
| `SandboxAgent.setup`(装 CLI / 写主配置) | 否 | 整组 eval **一次**,提前到 Fixture 之前 |
| `EvalDef.setup` / `test(t)` 里的 Fixture 写入 | 是 | **每题**重置后重放 |
| `test(t)` 的 `t.send()` agent 运行 | 是 | **每题**重跑 |
| eval / agent 收尾 | 是 | **每题** |
| `sandbox.teardown`(环境层收尾)+ `stop` | 否 | 整组 eval **一次**,最后一题之后 |

装好上面三层「否」之后,runner 落一笔**温基线** commit——它同时就是每题的变更归因锚点(见[变更归因:send 窗口与分类账](architecture.md#变更归因send-窗口与分类账)):Fixture 写在它之后仍是 eval 归因,`t.send()` 仍是 agent 归因,逐窗口 diff 语义一字不改。

这里有一处相对默认链的**重排**:默认模式下 `SandboxAgent.setup` 排在 `EvalDef.setup` 之后(先 Fixture、后装 CLI),复用模式把 agent 安装提到温基线**之前**——因为它与本题无关,必须留在重置 floor 之下才不会被每题的 `git reset` 抹掉。

这个提前**永远合法**,复用模式不需要为它加任何「这个 setup 是不是偷看了某条 eval」的检测:`SandboxAgent.setup`(装 CLI、写 agent 主配置)按[配置归属不变量](../adapters/architecture/agent-contract.md#配置归属不变量)本就只随 experiment 变、不随 eval 变——MCP / skills / model / 主配置都从 adapter factory 与 experiment 进,不从「当前是哪条 eval」进。真去偷看当前 eval 状态的 adapter 已经违反了那条不变量,该当 bug 修,而不是让复用去容忍它、退化成「这条题走全新沙箱」在复用组里挖洞。按 eval 变的东西只有一个家——`EvalDef.setup` / `test(t)` 里的 Fixture,它本来就在每题重放。

### 每题重置 = `git reset --hard 温基线 && git clean`

「清空 repo」不引入任何新机制,直接复用分类账已经在 workdir 上维护的 git:上一题跑完、diff 折叠完之后,把工作树 `git reset --hard` 回温基线那笔 commit,再 `git clean` 掉未跟踪文件(Fixture、agent 新建的文件、构建产物),workdir 就回到「刚装完、还没碰任何题目」的状态。下一题在这张干净的工作树上重放自己的 Fixture、重取归因窗口。

不发明第二套 checkpoint / 快照机制是刻意的:分类账已经是「便携、增量、带内容、能支撑逐窗口归因的 git 引擎」(见架构文里选 git 的理由),温基线只是它上面多钉一个可 reset 回去的 commit。运行时 [`createCheckpoint` / `restoreCheckpoint`](library/prebuilt-environments.md#运行时-checkpointcreatecheckpoint-restorecheckpoint) 解决的是「跨沙箱搬文件系统片段」,与「同一沙箱内回退工作树」是两件事,本文不碰它。

### 串行是本质,不是附带限制

一个热沙箱 = 一条执行道 = 串行。这不是复用顺带牺牲了并发,而是**复用与并发本就是同一资源的两种用法**:默认模式用「多个全新沙箱」换并发,复用模式用「一个热沙箱」换冷启动,两者互斥。所以复用是一个**独立的、需要显式开启的反转模式**,默认(每 attempt 全新、可并发)不受任何影响。

并发因此不是复用模式的输入面:显式 `--max-concurrency` 与 `--reuse-sandbox` 组合是**用法错误**,创建任何沙箱之前报错——串行是模式的本质,不是一个可调的并发值,把显式请求静默钉回 1 违反「不静默降级」的一贯处理;值不参与判断,`--max-concurrency 1` 同样报错,因为报错要说的正是「这个输入面在复用模式下不存在」。环境层的并发缺省(`NICEEVAL_MAX_CONCURRENCY`、配置 `maxConcurrency`、provider 推荐值)不表达本次意图,被复用模式覆盖为 1,PLAN 与启动反馈如实标注。

N 条热道(N 个热沙箱各自内部串行、道与道之间并行)是自然的扩展方向,能在「省冷启动」和「留一点并发」之间取中间点。本契约钉在 N=1;N 道池的调度归属见[单热道之外:N 条热道池](#单热道之外n-条热道池)。

### 诚实边界:`git reset` 只清 workdir

这是复用模式的正确性契约,必须摆在正中间说清:**`git reset` 只重置 workdir 一棵树**。workdir 之外的世界——`$HOME`、全局 `npm install -g` 的包、`/tmp`、agent CLI 自己的 cache / 配置、上一题没退干净的后台进程、进程级环境变量——一律**不重置**。

连 workdir 内部也不是全清:重置的精确操作是 `git reset --hard 温基线` 再跟一次**尊重分类账排除清单**的 `git clean`(排除清单见[变更归因](architecture.md#变更归因send-窗口与分类账))——被排除的目录(`node_modules`、venv、各类构建产物与包管理器 cache)不被 clean 掉。这既是实现约束也是**刻意取舍**:温基线里 `npm install` 出来的依赖正落在这些目录,题间不重装才谈得上「省冷启动」。代价对称——某条 eval 的 setup 往 `node_modules` 里塞了别的东西,也会留给下一题。所以边界收敛成一句话:**只有分类账跟踪的 workdir 内容重置回温基线;被排除路径与 workdir 之外的世界一律持久。**

因此复用模式**可能改变判定结果**:上一题往 `$HOME` 写了配置、装了个全局包、留了个监听端口,会泄漏给下一题,制造「单独跑过、串起来挂」或反过来的假象。这正是默认「全新更干净」的理由,也正是复用是**开发期加速档、不是可签入配置**的理由。文档、CLI 帮助与该模式的启动横幅都要如实说出这一点,不能把它讲成「等价的快速路径」。

作用域刻意就是 workdir,不试图靠更深的清理(重置 `$HOME`、杀进程树、清全局包)去逼近全新——那条路是做不完的军备竞赛,且会按 provider 分支、破坏[核心中立](../../architecture.md)。要真正干净就用默认模式;复用模式明码标价地拿隔离换速度。

### 入口:短暂的 CLI flag `--reuse-sandbox`,不是 experiment 配置

复用是运行期的「怎么跑」,与 [`--keep-sandbox`](cli.md) 同类:一个短暂的 CLI flag,不进 `defineExperiment`。

判据是一句话:**复用会不会改变结果?会(上一节的污染)→ 不可复现 → 只能是短暂 flag,永远不进可签入的 experiment 配置、CI 不信任它。** 可签入配置描述的是「这份实验怎么算、复现时长什么样」,把一个会因执行顺序改变结果的开关焊进去,等于让签入的实验失去可比性。所以它走 CLI flag,和 provider 选择(必须书面、可复现,写在 experiment / config)形成对照——两者恰好落在这条判据的两侧。

```bash
niceeval exp memory/commit0 --reuse-sandbox     # 一个热沙箱串行跑完这批,题间只 git reset
```

复用命中时,PLAN 与结束反馈如实标注模式与串行事实(复用一个沙箱、并发被钉成 1),让人一眼看出这次牺牲了并发、也不是 CI 该采信的运行。

### 只作用于同基线批次

`--reuse-sandbox` 要求选中的 eval 解析到**同一个 sandbox spec + [`environment` profile](library/prebuilt-environments.md#按-environment-选预制产物)**——只有共享同一温基线的 eval 能进同一条热道。批次异构(spec 或 profile 不一致)时,和 [provider 缺失](library.md#provider-选择没有默认值没有按名字选)一样在创建前一次性报错:列出不同的分组、请人缩小选择,不静默把它降级成默认模式跑一半、也不偷偷起多个沙箱。异构批次的自动分组是多热道扩展的事(见下),单热道只支持同基线批次。

### 与留存、缓存、重试的组合

- **`--keep-sandbox` 与 `--reuse-sandbox` 互斥,组合在创建前报错。** 留存的前提是「这个失败现场属于某一条 attempt」([Sandbox · 留存与注册表](architecture.md#留存keep与注册表));复用沙箱被整组共享,而且轮到第 N 题失败时,前面题目早已在同一 workdir 上被 reset 抹掉,留下来的现场对任何单题都不忠实。这与[自定义 provider 不支持留存](architecture.md#留存keep与注册表)是同一类前置报错:不先起实例再发现无法纳管。要留失败现场就用默认模式跑那一条 eval。
- **复用与指纹缓存双向绝缘。** 出向:[指纹](../../concepts.md)跳过的含义是「这个 `(eval + 配置)` 已经干干净净地过了一次」,复用带着上面的污染风险,给不出这个保证——复用 attempt 照常落进快照供 `show` / `view` 检查,但**打上 `reuse` 标记、永不被后续 run 的指纹跳过当成缓存命中**,它不进 CI、也不进缓存,是同一条理由的两个出口。入向:复用 run 也**不消费携带**,计划内每个 attempt 都真实在热道上跑——一份快照里只有一种出身的结果,`runs > 1` 的分布不会混进上一轮干净模式的旧 attempt。`--force` 在复用 run 里因此没有作用对象(本就没有携带可关),组合冗余但合法。
- **`runs > 1` 时 attempt 也串行。** 复用只有一条热道,同一 eval 的多次重复也在这条道上依次跑,每次先 reset 回温基线;[首过即停](../../concepts.md)语义不变。
- **[`localSandbox()`](local.md) 不进入复用,组合在创建前报错。** 两条理由各自充分:本地档没有冷启动可省(没有容器、没有安装,复用不带来任何加速);本地档的正确性中心是「只观察、绝不动用户没提交的工作」,而复用的题间重置恰恰要对 workdir 跑 `git reset --hard && git clean`。报错指明这一点,不静默降级成默认模式。

## 非目标

- **不改默认模式**:每 attempt 全新沙箱、可并发仍是缺省;复用是显式 flag 才进入的反转档。
- **不发明新的持久化 / checkpoint 原语**:重置只用分类账已有的 git 工作树,不加第二套快照面,也不改 `createCheckpoint` / `restoreCheckpoint` 的用途。
- **不改变更归因语义**:温基线就是每题的归因锚点,send 窗口、逐窗口 diff、eval / agent 归因口径一字不改。
- **不承诺 workdir 之外的隔离**:复用模式明确不重置 `$HOME` / 全局安装 / 进程 / 环境,不试图做「深度清理」去伪装成全新。
- **不把复用写进可签入配置**:`defineExperiment` / `niceeval.config.ts` 不新增复用字段,CI 不依赖它。

## 单热道之外:N 条热道池

本契约全部按 **N=1**(一条热道、全批同基线、串行)定稿,这一层的边界已经收口:hoist 靠[配置归属不变量](../adapters/architecture/agent-contract.md#配置归属不变量)保证合法、留存与缓存靠一条判据划清、异构批次直接报错。唯一**刻意不在本文定死**的方向是把它推广成 **N 条热道池**:N 个热沙箱各自内部串行、道与道之间并行,在「省冷启动」和「留一点并发」之间取中间点,顺带天然容纳异构批次(每种 spec + profile 一条道)。

这不是本设计漏掉的细节,而是一块独立的 [Runner 调度](../../runner.md#调度有界并发)设计:它把调度单位从「每 attempt 一个瞬时沙箱」换成「把 attempt 分配到 N 条持久道」,与现有[瓶颈优先派发](../../runner.md#派发顺序瓶颈优先追求最小总墙钟时间)怎么合、道的分配与回收、异构批次按 spec + profile 的自动分组,都要在那里单独展开。本契约只交付 N=1,并保证它的语义——温基线一次装好、题间只 reset workdir、复用结果不进 CI / 缓存——在 N>1 时逐字仍成立,多热道只是把「一条道」复制成「几条道」,不改单条道内部的语义。

## 相关阅读

- [CLI 用例](use-case/README.md) —— `--reuse-sandbox` 三个用户用例的全流程展示。
- [README](README.md) —— 为什么需要沙箱、默认的隔离模型。
- [Architecture](architecture.md) —— 生命周期调用链、变更归因分类账、留存与注册表。
- [CLI](cli.md) —— `--keep-sandbox` 留存现场;与 `--reuse-sandbox` 的互斥在两篇里同一口径。
- [预制环境](library/prebuilt-environments.md) —— 把「装什么」搬到构建期;复用解决的是「起实例 + 进 setup」这一段。
- [Runner](../../runner.md) —— 预热池与复用在调度层的位置。
