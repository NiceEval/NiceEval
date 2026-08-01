# Architecture

NiceEval 把一个评测过程拆成四段职责:**发现**要跑什么、**驱动**被测对象产生结果、**评分**得出判定、**报告**落盘与回传。
核心拥有这四段里对所有被测对象都一样的部分;被测对象的差异被收进 `Agent`(契约)/ `Adapter`(你写的实现)/ `Sandbox` 三层。

本篇给出这条边界的模块分层、数据流,以及一次运行的端到端时序。

## 系统总览

![NiceEval 产品架构总览](assets/architecture-overview.svg)

四段职责是**单向数据流**。
发现产出一批 `Eval`，运行器逐个对 Agent `send` 得到 `Turn`， Assertion collector 把检查结果收成 `Assertion[]`。
判定规则把执行状态与全部断言折叠成一个互斥的 `Verdict`，Reporter 再消费 `Verdict` 与 artifact。
Assertion 和 Judge 不知道 transport 是 HTTP 还是沙箱 CLI，只消费 `Turn` 与显式材料。

## 模块分层

模块按职责分层,`agents/` 与 `sandbox/` 是两个「特殊性收容所」:

```
src/
├─ index.ts                 # 公开导出:defineEval / defineConfig / defineExperiment
├─ define.ts                # define 一族的家(eval / config / experiment / agent / sandbox)
├─ types.ts                 # 核心类型的汇聚出口(各域类型的家在各自目录)
│
├─ context/                 # `t` 上下文的构建(TestContext / SessionHandle / TurnHandle)
├─ expect/                  # 值断言库(includes / equals / matches / similarity …)
├─ assertions/              # Assertion collector、作用域检查与证据完整性
├─ judge/                   # 裁判模型配置、调用与响应解析
├─ verdict/                 # Severity、严格模式与四态折叠
│
├─ agents/                  # —— 连到哪个被测对象、协议怎么说,全部特殊性在这里 ——
│                           #   Agent 接口、内置 adapter、官方转换器、拼装件
├─ sandbox/                 # —— 在哪里跑、如何隔离,全部特殊性在这里 ——
│                           #   Sandbox 接口、resolve、各 provider
│
├─ o11y/                    # transcript 归一化 → 标准事件流;OTLP 接收与归一;派生事实与成本
├─ runner/                  # 调度(有界并发 / 首过即停 / 预算)、发现、指纹缓存、reporters
├─ record/                  # Record Format 的读写面(唯一碰磁盘布局的地方)
├─ report/                  # 报告积木:指标 × 计算函数 × 双面组件(text 面 / web 面)
├─ show/                    # 终端宿主      └─ view/  网页宿主(两个宿主共用 report/)
│
└─ cli.ts                   # CLI 入口
```

逐个能力落到哪个文件,查 [Source Map](source-map.md) ——那份表是源码定位的单一出处,本图只表达分层。

边界规则一句话:**`agents/` 和 `sandbox/` 之外的任何文件,都不应出现 agent 名字或 sandbox 名字的行为分支。
** 核心拿到的是接口,不是名字。

## 一个授权面，宽接口与能力守卫

NiceEval 只有一个写 eval 的入口 `defineEval`。
Direct 与 Sandbox 不是两个 Eval 函数；同一份 Eval 可以被两类 Agent 运行，因此 `test(t)` 始终收到同一个宽 `TestContext`。
只有 `t.sandbox` 需要运行时能力守卫：

| | Direct Agent | Sandbox Agent |
|---|---|---|
| 典型目标 | 进程内函数、SDK、HTTP / RPC 服务 | coding-agent CLI + Sandbox |
| Task 形态 | `t.send(...)` 序列 | 同左——沙箱型的任务照样写在 `t.send(...)` 里,没有另一种任务格式 |
| `t` 可用什么 | `send`/`reply`/`calledTool`/`judge`;调用 `t.sandbox` 立即报能力错误 | 同一宽接口,且 `t.sandbox` 可用(文件 IO / 命令执行 / 结果断言 / diff) |
| 评分手段 | expect + 作用域断言 + judge | 上述 + 手工在沙箱里跑命令,再用 `t.check(result, commandSucceeded())` 判定 |
| 共享 | **Assertion、Judge、Verdict、Runner、Reporter、Config、artifact 格式全部共享** | 同 → |

这张表是整个架构的中心论点:**两种范式只在"Agent 的构造证据(`kind` 与 `send` 实际做到了什么)"上不同,在"如何判分、如何调度、如何记录"上完全一致。
** 所以它们能住在同一个入口、同一个库里,而不是两个入口或两个库。

## `t` 上下文：宽接口与构造证据

`test(t)` 收到的 `t` 对每个 Agent 都暴露同一套宽接口(`TestContext`),但每个方法**实际能不能读到数据**由 Agent 的构造证据决定,不是声明式的能力位——这是唯一的运行时守卫例外:

- 任何 Agent → `t.check` / `t.require`(值断言)、`t.log`、`t.skip`、`t.signal`、`t.judge`,以及 `t.send` / `t.reply` / `t.newSession`(能不能多轮取决于 `send` 有没有接上 `ctx.session` 的续接存取器,不取决于声明)。
- `send` 吐出 `action.*` 事件 → `t.calledTool` / `t.toolOrder` / `t.usedNoTools` 有数据可断;没吐,正断言自然不命中、负断言按事件来源的完整性证明判断可信度(见[断言证据与完整性](feature/adapters/architecture/evidence.md))。
- `defineSandboxAgent` 构造(`kind: "sandbox"`)→ `t.sandbox`:文件 IO(`writeFiles` / `readFile`)、命令执行(`runCommand` / `runShell`)和结果断言 / diff(`fileChanged` / `fileDeleted` / `diff` / `file`)都收在这一个命名空间下。
  评 sandbox 产物用 `t.judge.autoevals.closedQA` 配 `{ on: t.sandbox.diff.get(path) }`。
  非沙箱型 agent 调用这组方法会立即得到清晰报错(`capabilityGuard`)——这是唯一仍需要运行时拦截的能力,因为没有沙箱就没有文件系统可读。

## 一次 Invocation,端到端

以 Sandbox Agent 的 Eval 为例。
Direct Agent 跳过 Sandbox 创建、变更分类账与 Sandbox diff：

1. **加载配置。
   ** 对支持 Eval 覆盖的字段按 CLI → experiment → eval → `niceeval.config.ts` → 默认值解析。
   不支持 Eval 覆盖的字段按各自专题声明的层级解析；见[配置与凭据的边界](#配置从代码来凭据从环境来)。
2. **发现。
   ** 扫 `evals/`,收集 `*.eval.ts` 与 `*.eval.tsx`;据路径推导 id,排序;按过滤器(id 前缀 / `--tag`)筛。
3. **指纹与结果沿用。
   ** 对每个 eval 算 `(eval 源码闭包 + resolved 配置)` 指纹；`passed` / `failed` 终态逐条通过携带资格门后合入本次 Run，`errored` / `skipped` 永不携带。
   完整判据只见[缓存与携带](feature/experiments/cache.md)。
4. **建 attempt 列表。
   ** 每个 eval × `attempts` 次 → 一批 attempt。
   为每个 eval 建一个 `AbortController`(供首过即停)。
5. **有界并发调度。
   ** 全局至多 `maxConcurrency` 个 attempt 在飞(全局信号量);设了 `maxConcurrency` 的实验另有一道实验级信号量,自己排队、不影响同批其它实验(见 [Runner](runner.md#调度有界并发))。
   重试不是 attempt 级耗时启发式：turn 重试只包 `agent.send` 且受受理证据门约束，Sandbox provisioning 与幂等文件 IO 各守自己的执行体；完整边界见[执行失败分类](feature/error-classification/architecture.md)与[Sandbox](feature/sandbox/architecture.md#provisioning-失败与重试)。
6. **准备环境,交给 `test(t)`。
   ** 沙箱型:Provider 按配对唯一的 template 启动 Sandbox Case → 按 owner 顺序执行两层作者 layer 的 `prepare()` 命令(template owner 先、另一 owner 后,装二进制、预热、题目准备;这一步在变更分类账锚点之前,环境产物不进入任何归因视图)→ agent.ensure 循环安装 Agent CLI(`agent.ensure`:probe、缺失时配对安装层 install、复检)→ 打变更分类账锚点(runner 私有 git ledger,见 [Sandbox · 变更归因](feature/sandbox/architecture.md#变更归因send-窗口与分类账))→ 跑 agent 的 runtime `SandboxAgent.setup`(写鉴权与运行时配置)。
   之后全部交给这条 eval 自己的 `test(t)`:作者按自己的顺序调 `t.sandbox.writeFiles`/`uploadFiles`(手工写入起始文件)、`t.send()`(驱动 agent——adapter 在沙箱里跑 CLI、抓 transcript、解析成标准事件流)、`t.sandbox.runCommand(..., { cwd })`(手工跑校验命令)——顺序、次数、要不要对 agent 隐藏某些文件,全部是 `test(t)` 里的普通代码决定,核心不插手,也不预设"先上传什么、后上传什么"这种固定编排。
7. **折叠 agent 归因增量。
   ** `test(t)` 跑完后从分类账折叠各 send 窗口的变更并集,供 `t.sandbox.diff` / `t.sandbox.fileChanged` 的 finalize 与 `diff.json` 使用——fixture 写入和 agent 跑完后手工写入的校验材料都不在其中。
8. **断言求值。
   ** `test(t)` 里记录的作用域断言、值断言与 Judge，连同手工校验命令的结果断言，全部求值成 `AssertionResult[]`。
9. **判定。
   ** 断言 + 执行错误 + 跳过原因直接折叠成一个互斥的 `Verdict`(`passed`/`failed`/`errored`/`skipped`,没有中间态)。
10. **首过即停。
    ** 若该 attempt 通过且开了 `earlyExit`,`abort()` 掉同一 eval 的其余 attempt。
11. **收尾与留存。
    ** finally 里按 `SandboxAgent.teardown` → 两层作者 layer 已登记 cleanup(按全局准备顺序逆序)→ Provider finalizer 的顺序收尾——收尾只能追加 diagnostic,不改判定;随后按留存决策销毁或留存沙箱(`--keep-sandbox`,见 [Sandbox · 留存](feature/sandbox/architecture.md#留存keep与注册表))。
    阶段词表以 [Results 的 `LifecyclePhase` 闭集](feature/record/architecture.md#resultjson)为唯一权威。
12. **报告。
    ** 每个 eval 完成即在串行报告队列上回调 `onEvalComplete`(不阻塞执行池),对应 attempt 的判定与 artifact 随之写进该实验 Run 目录(`.niceeval/<experiment>/<run>/<evalId>/aN/result.json`);每个 Run 在该 Experiment 收尾后补 `completedAt` 与 Run 级 diagnostics,全部结束后回调 `onInvocationComplete`。
13. **退出码。
    ** 有 `verdict=failed`(含 `--strict` 下 soft 未达标而改判的)或 `verdict=errored` → 非零退出;报告里两者分开列,供 CI 判红和诊断。

## 配置从代码来,凭据从环境来

环境变量在 NiceEval 里只有两个合法用途,两个之外的一切都从代码读:

| 类别 | 从哪来 | 说明 |
|---|---|---|
| **Attempt 配置**(`timeoutMs`、Judge) | CLI flag → experiment → eval → `niceeval.config.ts` → 内置默认 | eval 可以声明自己的完成条件；config 只是默认来源 |
| **其它运行配置**(attempts、并发、预算、报告、界面语言、Adapter 与 Sandbox 参数) | 按所属专题声明的层级解析 | 没有环境变量层；`--dry` 打印的解析结果就是真正生效的值 |
| **凭据**(API key、provider token) | 环境变量,变量名由代码声明 | adapter / sandbox 工厂各自声明自己那一个官方变量名(`ANTHROPIC_API_KEY`、`CODEX_API_KEY`、`BUB_API_KEY` + `BUB_API_BASE`、`E2B_API_KEY`、`VERCEL_API_TOKEN`);judge 用 `judge.apiKeyEnv` 指定变量名,不指定时读 `NICEEVAL_JUDGE_KEY`。**只读自己家族那一个名字**,不跨家族回落、不做"环境里有哪个 key 就用哪个"的探测 |
| **终端环境事实**(`NO_COLOR`、TTY、系统 locale) | 环境 | 这些描述的是"输出到哪个终端",不是 niceeval 的配置。`config.locale` 优先于系统 locale |

CLI 启动时仍加载项目根的 `.env`(不覆盖已有环境变量)——那是凭据的投递方式,不是配置层。

**配置是代码,所以"从环境注入某个配置值"这条路一直开着**:私有网关地址这类不便签入的值,在自己的 `niceeval.config.ts` 里写 `process.env.MY_GATEWAY` 即可(`.env` 已经加载完)。
区别在于变量名由项目自己起、自己读,NiceEval 不内置任何配置类变量名、也不去环境里猜——这正是这条边界要保住的东西。

这条边界的理由:配置有三条来路时,「为什么本地和 CI 跑出不同结果」要靠翻环境才能回答,而环境不进 Run、不进指纹、复现时也不在手边。
凭据反过来——它不能进签入 git 的代码,所以只能来自环境;NiceEval 能做的是不去猜它叫什么名字。

## 错误隔离

三类错误被分开处理,避免一个 case 拖垮整批:

- **断言失败** ——正常路径,折叠进判定,不抛,对应 `verdict=failed`。
- **执行器异常**(超时、网络、沙箱起不来)——在单 eval 边界被 catch,该 eval 记为 `verdict=errored` 并附错误,其余 eval 照跑。
- **作者错误**(`test` 里抛了非断言异常)——同样被 catch,记为 `verdict=errored`,不污染别人。

## 相关阅读

- [Reading](feature/reading/README.md) ——第 12 步写下的 Run 目录之后:事实、选择、呈现三层。
- [Runner](runner.md) ——调度、并发、重试、首过即停、缓存的细节。
- [Agents 与 Adapters](feature/adapters/README.md)、[Sandbox](feature/sandbox/README.md) ——三层的契约。
- [Assertions](./feature/assertions/README.md) ——检查、作用域与证据。
- [Judge](./feature/judge/README.md) ——裁判模型调用。
- [Verdict](./feature/verdict/README.md) ——严重度与四态折叠。
