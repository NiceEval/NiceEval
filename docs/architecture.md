# Architecture

NiceEval 把一个评测过程拆成四段职责:**发现**要跑什么、**驱动**被测对象产生结果、**评分**得出判定、**报告**落盘与回传。
核心拥有这四段里对所有被测对象都一样的部分;被测对象的差异被收进 `Agent`(契约)/ `Adapter`(你写的实现)/ `Sandbox` 三层。

本篇给出这条边界的模块分层、数据流,以及一次运行的端到端时序。

## 系统总览

![NiceEval 产品架构总览](assets/architecture-overview.svg)

四段职责是**单向数据流**。
发现产出一批 `Eval`，运行器逐个对 Agent `send` 得到 `Turn`，Assertion collector 形成检查结果。
判定规则把执行错误与全部断言折叠成一个互斥 Verdict，Record writer 再把这些当前业务事实写入具名通道。
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

## 程序设计边界：纯函数、完整 ADT 与 Effect

NiceEval 的内部实现只有两类计算。
不读取外部世界的身份、选择、链接、规划、指纹和结果折叠保持为纯函数；文件、网络、进程、动态 import、并发、取消与资源生命周期进入 `Effect`。
公共作者 callback 与 Provider SDK 可以按各自契约返回 `Promise`，但只在最外层适配一次，不能让 `Promise`、`try/catch` 或 `Effect.runPromise` 继续穿过内部调用链。

数据从作者输入依次流经 Definition、Discovered、Linked、Planned、Attempt 与 Record。
每个阶段只接收上一个阶段的完整输出，并用判别联合表示互斥状态；可选字段只表示该业务事实确实可以缺席，不能同时承担“尚未计算”“不适用”“失败”或旧版本占位。
阶段推进只创建新值，不回写前一阶段，也不在下游重新选择、重新链接或猜默认值。

`unknown` 只允许出现在 JavaScript、动态 import、JSON、文件格式、SDK 返回和第三方 throw 这些真实的不可信边界。
边界用 Effect Schema 或等价的品牌守卫立即解码成领域类型；解码失败进入具名的 typed error channel，解码成功后的内部函数不再接收 `unknown`、手写字段探测或双重类型断言。

资源由 `Effect.Scope` 持有，失败、defect 与 interruption 保持三条通道直到单 Attempt 封口。
Sandbox acquire、Sandbox lifecycle、Agent ensure、作者执行和逆序 finalizer 都在同一条结构化生命周期里组合；只有最外层公共 Promise facade 与结果封口运行 Effect，内部模块不得自行启动第二套 runtime。

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
| 共享 | **Assertion、Judge、Verdict、Runner、Reporter、Config、Record 格式全部共享** | 同 → |

这张表是整个架构的中心论点:**两种范式只在"Agent 的构造证据(`kind` 与 `send` 实际做到了什么)"上不同,在"如何判分、如何调度、如何写入"上完全一致。
** 所以它们能住在同一个入口、同一个库里,而不是两个入口或两个库。

## `t` 上下文：宽接口与构造证据

`test(t)` 收到的 `t` 对每个 Agent 都暴露同一套宽接口(`TestContext`),但每个方法**实际能不能读到数据**由 Agent 的构造证据决定,不是声明式的能力位——这是唯一的运行时守卫例外:

- 任何 Agent → `t.check` / `t.require`(值断言)、`t.log`、`t.skip`、`t.signal`、`t.judge`,以及 `t.send` / `t.reply` / `t.newSession`(能不能多轮取决于 `send` 有没有接上 `ctx.session` 的续接存取器,不取决于声明)。
- `send` 吐出 `action.*` 事件 → `t.calledTool` / `t.toolOrder` / `t.usedNoTools` 有数据可断;没吐,正断言自然不命中、负断言按事件出处的完整性证明判断可信度(见[断言证据与完整性](feature/adapters/architecture/evidence.md))。
- `defineSandboxAgent` 构造(`kind: "sandbox"`)→ `t.sandbox`:文件 IO、宿主传输与命令执行。
  `writeText` / `readText` / `writeBytes` / `readBytes`、`upload*` / `download*`、`runCommand` / `runShell` 与结果断言 / diff 都收在这一个命名空间下。
  评 sandbox 输出用 `t.judge.autoevals.closedQA` 配 `{ on: t.sandbox.diff.get(path) }`。
  非沙箱型 agent 调用这组方法会立即得到清晰报错(`capabilityGuard`)——这是唯一仍需要运行时拦截的能力,因为没有沙箱就没有文件系统可读。

## 一次 Invocation,端到端

以 Sandbox Agent 的 Eval 为例。
Direct Agent 跳过 Sandbox 创建、变更分类账与 Sandbox diff：

1. **加载配置。
   ** 对支持 Eval 替换的字段按 CLI → experiment → eval → `niceeval.config.ts` → 默认值求值。
   不支持 Eval 替换的字段按各自专题声明的层级求值；见[配置与凭据的边界](#配置从代码来凭据从进程变量来)。
2. **发现。
   ** 扫 `evals/`,收集 `*.eval.ts` 与 `*.eval.tsx`;据路径推导 id,排序;按过滤器(id 前缀 / `--tag`)筛。
3. **identity 与结果沿用。
   ** 对每个 eval 计算带 domain 的 input/config identity，并先按 <code>(startedAt, runId)</code> 选择唯一历史 Run。只有该 Run 同 ordinal 的 Verdict 与 eligibility 都完整读取和完整解码、domain 与 value 相等、duration 与本次 policy 也通过资格门时，本次 Run 才用 carried Member 引用历史 Attempt。任何失败都真实执行，不回扫更旧 Run；`errored` / `skipped` 永不自动携带。
   完整判据只见[缓存与携带](feature/experiments/cache.md)。
4. **建 attempt 列表。
   ** 每个 eval × `attempts` 次 → 一批 attempt。
   为每个 eval 建一个 `AbortController`(供首过即停)。
5. **有界并发调度。
   ** 全局至多 `maxConcurrency` 个 attempt 在飞(全局信号量);设了 `maxConcurrency` 的实验另有一道实验级信号量,自己排队、不影响同批其它实验(见 [Runner](runner.md#调度有界并发))。
   重试不是 attempt 级耗时启发式：turn 重试只包 `agent.send` 且受受理证据门约束，Sandbox provisioning 与幂等文件 IO 各守自己的执行体；完整边界见[执行失败分类](feature/error-classification/architecture.md)与[Sandbox](feature/sandbox/architecture.md#provisioning-失败与重试)。
6. **准备 Sandbox,交给 `test(t)`。**
   沙箱型按固定顺序完成下面几步:
   - Provider 按配对唯一的 template 启动 Sandbox 实例。
   - 按 owner 顺序执行两层作者 layer 的 `prepare()` 命令(template owner 先、另一 owner 后,装二进制、预热、题目准备;这一步在变更分类账参照点之前,准备输出不进入任何归因视图)。
   - `agent.ensure` 循环安装 Agent CLI:探测、缺失时配对安装层 install、复检。
   - 打变更分类账参照点(runner 私有 git ledger,见 [Sandbox · 变更归因](feature/sandbox/architecture.md))。
   - 跑 agent 的 runtime `SandboxAgent.setup`(写鉴权与运行时配置)。
   之后全部交给这条 eval 自己的 `test(t)`。
   作者按自己的顺序调 `t.sandbox.writeText` / `writeBytes` / `uploadDirectory`(准备起始文件)与 `t.sandbox.runCommand(..., { cwd })`(手工跑校验命令)。
   `t.send()` 驱动 agent——adapter 在沙箱里跑 CLI、抓 transcript、归一化成标准事件流。
   顺序、次数、要不要对 agent 隐藏某些文件,全部是 `test(t)` 里的普通代码决定;核心不插手,也不预设"先上传什么、后上传什么"这种固定编排。
7. **折叠 agent 归因增量。
   ** `test(t)` 跑完后从分类账取得各 send 区间的变更事实，折叠其并集，供 `t.sandbox.diff` / `t.sandbox.fileChanged` 的 finalize 与 Record diff 通道使用。fixture 写入和 agent 跑完后手工写入的校验材料都不在其中。
8. **断言求值。
   ** `test(t)` 里写入的作用域断言、值断言与 Judge，连同手工校验命令的结果断言，全部形成结构化 assertion 结果。
9. **判定。
   ** assertion 结果、执行错误与跳过原因共同形成一个互斥 Verdict（`passed` / `failed` / `errored` / `skipped`，没有中间态），写入 planner-critical 的 `niceeval.verdict` 通道。
10. **首过即停。
   ** 若该 Attempt 形成 `passed` Verdict 且开了 `earlyExit`,`abort()` 掉同一 eval 的其余 Attempt。
11. **收尾与留存。
    ** finally 里按 `SandboxAgent.teardown` → 两层作者 layer 已登记 cleanup(按全局准备顺序逆序)→ Provider finalizer 的顺序收尾。
    收尾只能追加 diagnostic event，不改已经形成的 Verdict；随后按留存决策销毁或留存沙箱(`--keep-sandbox`,见 [Sandbox · 留存](feature/sandbox/architecture.md#留存keep与注册表))。
12. **写 Record 与返回 receipt。
    ** Runner 先在 origin Run 写入 source manifest 与 Run-local digest blobs，再在 Attempt 自己的临时目录完整形成核心文件、通道和 blob。它以目录 rename 原子发布 Attempt，并为 Run slot 写 executed Member，建立 origin 反向锚。每个 Run 在初始 writer 释放所有权时写 `completedAt`；全部结束后返回不聚合宽结果的 `InvocationReceipt`。

    Report 不参与采集或落盘。show/view 先形成 core-only Sample 与 ReportPlan，再由唯一 composition adapter 按需读取 ReportInput；一次 ReportExecution 同时服务终端、本机页面或静态导出。
13. **退出码。
    ** 有 `failed` Verdict（含 `--strict` 下 soft 未达标而改判的）或 `errored` Verdict → 非零退出；报告里两者分开列，供 CI 判红和诊断。

## 配置从代码来,凭据从进程变量来

进程变量在 NiceEval 里只有两个合法用途,两个之外的一切都从代码读:

| 类别 | 从哪来 | 说明 |
|---|---|---|
| **Attempt 配置**(`timeoutMs`、Judge) | CLI flag → experiment → eval → `niceeval.config.ts` → 内置默认 | eval 可以声明自己的完成条件；config 只是默认出处 |
| **其它运行配置**(attempts、并发、预算、报告、界面语言、Adapter 与 Sandbox 参数) | 按所属专题声明的层级求值 | 没有进程变量层；`--dry` 打印的求值结果就是真正生效的值 |
| **凭据**(API key、provider token) | 进程变量,变量名由代码声明 | adapter / sandbox 工厂各自声明自己那一个官方变量名(`ANTHROPIC_API_KEY`、`CODEX_API_KEY`、`BUB_API_KEY` + `BUB_API_BASE`、`E2B_API_KEY`、`VERCEL_API_TOKEN`);judge 用 `judge.apiKeyEnv` 指定变量名,不指定时读 `NICEEVAL_JUDGE_KEY`。**只读自己家族那一个名字**,不跨家族回落、不做"进程变量里有哪个 key 就用哪个"的探测 |
| **终端输出事实**(`NO_COLOR`、TTY、系统 locale) | 进程变量 | 这些描述的是"输出到哪个终端",不是 niceeval 的配置。`config.locale` 优先于系统 locale |

CLI 启动时仍加载项目根的 `.env`(不改写已有进程变量)——那是凭据的投递方式,不是配置层。

**配置是代码,所以"从进程变量注入某个配置值"这条路一直开着**:私有网关地址这类不便签入的值,在自己的 `niceeval.config.ts` 里写 `process.env.MY_GATEWAY` 即可(`.env` 已经加载完)。
区别在于变量名由项目自己起、自己读,NiceEval 不内置任何配置类变量名、也不去进程变量里猜——这正是这条边界要保住的东西。

这条边界的理由:配置有三条来路时,「为什么本地和 CI 跑出不同结果」要靠翻进程变量才能回答,而进程变量不进 Run、不进指纹、复现时也不在手边。
凭据反过来——它不能进签入 git 的代码,所以只能来自进程变量;NiceEval 能做的是不去猜它叫什么名字。

## 错误隔离

三类错误被分开处理,避免一个 case 拖垮整批:

- **断言失败** ——正常路径，形成 `failed` Verdict，不抛。
- **执行器异常**(超时、网络、沙箱起不来)——在单 eval 边界被捕获，写结构化执行错误并形成 `errored` Verdict；其余 eval 照跑。
- **作者错误**(`test` 里抛了非断言异常)——同样写执行错误与 `errored` Verdict，不污染别人。

## 相关阅读

- [Record](feature/record/README.md) ——第 12 步写入的可编辑当前数据集、Sample 选择与 Reports 呈现。
- [Runner](runner.md) ——调度、并发、重试、首过即停、缓存的细节。
- [Agents 与 Adapters](feature/adapters/README.md)、[Sandbox](feature/sandbox/README.md) ——三层的契约。
- [Assertions](./feature/assertions/README.md) ——检查、作用域与证据。
- [Judge](./feature/judge/README.md) ——裁判模型调用。
- [Verdict](./feature/verdict/README.md) ——严重度与四态折叠。
