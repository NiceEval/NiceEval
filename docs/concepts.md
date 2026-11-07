# Concepts

什么时候读这一篇:

- 你碰到一个不认识的 niceeval 术语;
- 你在写文档 / 代码,想跟现有用法保持一致;
- 你需要一页纸把整套词汇过一遍。

本页是 Concord 管理的全局术语 catalog：每个二级标题是一个概念，标题文字是正文唯一的写法，`{#id}` 是稳定身份，紧随其后的段落是定义，再往后是解释。写作政策由 [`concord-writing.json`](concord-writing.json) 拥有。
直接编辑本页后运行 `concord writing check`；不要另建词表。

```sh
concord concepts index --json
concord concepts show --path docs/concepts.md --json
concord writing index --json
```

正文链接到定义时写 `concepts.md#<id>`。「其它写法」列出迁移前的另一语言首选名与代码标识别名，仅供检索；它们不算概念使用，也不派生禁词。
代码示例仍服从对应 Feature 的公开 API。

### 概念关系与案例

[Eval](feature/eval/README.md) 描述任务和评判条件，[Experiment](feature/experiments/README.md) 选择被测 Adapter、模型与运行条件。
例如，同一条 Eval 可以比较两个 Experiment 的表现；每次实际执行形成一条 Attempt。

[Run](feature/run/README.md) 中的 Planned attempt 表示计划执行的位置，Attempt 表示已发布的执行事实。
Member 将两者关联；历史结果沿用时，新的 Run 引用既有 Attempt，而不复制执行事实。

[Sandbox](feature/sandbox/README.md) 提供执行空间，Adapter 连接被测系统，Agent 是提供会话协议的 Adapter。
例如，Sandbox Agent 在隔离空间里运行 CLI，Direct Agent 则直接调用函数、SDK 或服务端点。

生命周期 Hook 使用 `before` / `after`；所在对象决定执行范围与次数。
[Sandbox Layer](feature/sandbox/library/layers.md) 的可缓存前置动作形成 before 缓存；它与 [结果沿用](feature/experiments/architecture/cache.md) 分别复用 Sandbox 起始状态和已发布结果。

[Assertion](feature/assertions/README.md) 声明检查条件，[Judge](feature/judge/README.md) 对显式材料求 measurement，
[Verdict](feature/verdict/README.md) 表达 Attempt 的判定。Score Eval 还保存显式数值贡献。
例如，Judge 给出质量 measurement，作者再通过 handle 的 `gate` 或 `score` 决定怎样使用它。

### 候选术语与禁用写法

[Roadmap](roadmap/README.md) 中的候选术语保留其契约链接和候选身份，不能据此推断公开 API 已存在。
采用或否决时，用 Concord 同步概念定义与引用；本页不复制候选词库。

弃用名写在本页 frontmatter 的 `deprecated`，由 Concord 派生禁词。需要保护历史原话的 0.19 弃用规则在写作政策中声明，并引用对应 concept。
维护步骤见 [Documentation terminology skill](../.agents/skills/docs-terminology/SKILL.md)，检查入口为 `concord docs check --json`。
需要讨论旧词本身时使用行内代码；不要把历史拼写重新当作当前正文用语。

### 相关阅读

- [Architecture](architecture.md) —— 这些名词在模块图里各自的位置。
- [Authoring](feature/eval/README.md) —— Eval / Task / Dataset 怎么写。
- [Assertions](./feature/assertions/README.md) —— Assertion、scope、计分与证据。
- [Judge](./feature/judge/README.md) —— 裁判模型调用与不可用语义。
- [Verdict](./feature/verdict/README.md) —— AssertionResult 与执行终态怎样折叠成四态。

## NiceEval {#nice-eval}

产品名。正文写 `NiceEval`;命令、包名、配置文件、代码标识写 `niceeval`

## Eval {#eval}

一个 Task 跑在接口相容的 Adapter 上，由已登记的 Assertion 评判；id 从文件路径推导

契约：[Eval](feature/eval/README.md)

其它写法：`评估用例`。

## Task {#task}

要让被测应用完成的操作序列；Agent 使用会话动作，自定义应用使用自己的方法

契约：[Eval](feature/eval/library/README.md)

其它写法：`任务`。

## Fixture {#fixture}

第一次 `send` 前通过普通 Sandbox API 写入的起始素材,加 Eval layer `before()` 准备的内容;算 eval 归因,不进 agent diff

契约：[Eval](feature/eval/README.md#defineeval-的形状)

## transfer manifest {#transfer-manifest}

普通本地上传实际读取的 source tree、内容摘要、Sandbox 目标与 send 区间;由 Runner 自动写入

契约：[本地测试文件](feature/eval/use-case/criteria-files.md)

其它写法：`本地传输清单`。

## send 区间 {#send-window}

一次逻辑 `t.send()` 从发出到最终 settle 的区间,包含全部物理重试与静止确认;Sandbox 归因按 send 顺序保留每个区间各自的 before/after 端点,不合并成并集

契约：[Agent contract](feature/adapters/architecture/agent-contract.md)

其它写法：`send window`。

## Dataset {#dataset}

共享同一 `test` 逻辑、只有输入不同的一组 case,`.map` 从输入数组生成多条 eval,id 零填充编号

契约：[Dataset fan-out](feature/eval/use-case/dataset-fanout.md)

其它写法：`测试集`。

## 发现 {#discovery}

扫 `evals/` 找 `*.eval.ts` / `*.eval.tsx` 与目录入口 `eval.ts`,按路径推导 id;同 id 双入口报重名

契约：[Eval](feature/eval/README.md)

其它写法：`Discovery`。

## Attempt {#attempt}

一个 Run 中某个 Eval 的一次独立执行；拥有生命周期、Assertion 与 Verdict，Score Eval 还拥有 score，重复序号为 i；一次实际执行的稳定身份；发布后不等 origin Run 收口即可使用

契约：[Eval context](feature/eval/library/context.md)

契约：[Run Architecture](feature/run/architecture/README.md)

## Agent Session {#agent-session}

Attempt 内的一条对话线;`t.newSession()` 创建独立 Agent Session

契约：[Eval context](feature/eval/library/context.md)

其它写法：`Session`。

## Turn {#turn}

`t.send()` 取得可信协议终态时的返回值；`failed` 是可评分领域失败，不表示进程异常

契约：[Eval context](feature/eval/library/context.md)

## 断言 {#assertion}

对结果、行为、证据或资源使用提出的一项可写入的检查;产出 0–1 分数或 `unavailable`

契约：[Assertions](./feature/assertions/README.md)

其它写法：`Assertion`。

## Verdict {#verdict}

由 Assertions 与 Attempt outcome 折叠出的四态值：`passed` / `failed` / `errored` / `skipped`；不另建持久 family，也不是 Attempt lifecycle state

契约：[Severity 与 Verdict](./feature/verdict/architecture.md)

其它写法：`判定`。

## 质量门 {#quality-gate}

显式 condition 不满足时使 Attempt 为 `failed`；没有全局 strict 或读时提升

契约：[Verdict](./feature/verdict/architecture.md)

其它写法：`quality gate`、`gate`。

## Judge 断言 {#llm-judged-assertion}

把显式材料和 rubric 交给裁判模型求 measurement 的 Assertion；是否失败或计分由 handle 配置

契约：[LLM-as-a-judge](./feature/judge/library.md)

其它写法：`LLM-judged assertion`。

## 断言范围 {#assertion-scope}

`t.*` 看 Attempt、`session.*` 看 Agent Session、`turn.*` 看 Turn 已发生的事件

契约：[Scopes](./feature/assertions/architecture/scopes.md)

其它写法：`Assertion scope`。

## 证据完整度 {#evidence-completeness}

Adapter 按 events、actions、messages、usage、status、data 六类声明采集完整性；落盘的 `collection` 表达 complete 或 partial，读取状态与 payload limitation 另由读取层表达

契约：[Adapter 证据](feature/adapters/architecture/evidence.md) 与 [Assertion 证据](feature/assertions/architecture/evidence.md)

其它写法：`Evidence completeness`。

## Pass Eval {#pass-eval}

以 Boolean condition 折叠 Attempt Verdict 的评测类型；measurement 用 `gate(n)` 才进入 failed

契约：[Assertions](./feature/assertions/README.md#pass-eval)

其它写法：`defineEval`。

## Score Eval {#score-eval}

同时拥有 Attempt Verdict 与显式 score contribution；不声明隐式总分

契约：[Score Eval](./feature/assertions/library/score-points.md)

其它写法：`defineScoreEval`。

## score contribution {#score-contribution}

一个已登记 Assertion 或直接 `t.score(n)` 对 Score Eval 累计 score 的数值贡献

契约：[Score Eval](./feature/assertions/library/score-points.md#显式贡献)

其它写法：`单项贡献分数`、`scoreContribution`。

## minimum {#minimum}

`gate(minimum)` 或 `orStop(minimum)` 把 measurement 与有限 `[0,1]` 下限比较，形成同一条局部 Boolean condition

契约：[Assertions](./feature/assertions/README.md#pass-eval)

其它写法：`最低值`。

## authoring stop latch {#authoring-stop-latch}

`.orStop()` 触发后拒绝后续 NiceEval 作者 API 登记的 Attempt 内控制状态

契约：[Assertions](./feature/assertions/README.md#orstop)

## 自定义适配器 {#custom-adapter}

每 Attempt 连接被测系统并创建作者上下文，其原生操作与通用评估能力组成强类型的 `t`

契约：[Eval Library](feature/eval/library/README.md#自定义应用)

其它写法：`Custom adapter`、`defineAdapter`。

## Agent {#agent}

提供 `send`、Session 与 Turn 会话协议的 Adapter 特例，分 Direct 与 Sandbox 两种运行方式

契约：[Adapters](feature/adapters/README.md)

## Direct Agent {#direct-agent}

runner 直接调用函数、SDK 或服务端点；不创建也不伪造 Sandbox

契约：[Direct Agent](feature/adapters/library/direct-agent.md)

其它写法：`defineAgent`。

## Sandbox Agent {#sandbox-agent}

runner 创建 Sandbox，并把真实 Sandbox 交给 Adapter 驱动 CLI

契约：[Sandbox Agent](feature/adapters/library/sandbox-agent.md)

## Adapter {#adapter}

连接被测系统的定义；拥有认证、调用方法与资源释放，不代表业务应用本身

契约：[Adapters](feature/adapters/README.md)

其它写法：`适配器`。

## send {#send}

Agent 会话协议的驱动方法；协议、事件映射与会话续接由 Adapter 实现

契约：[Agent contract](feature/adapters/architecture/agent-contract.md)

## SendFailure {#send-failure}

Adapter 无法返回可信 Turn 时 reject 的结构化 envelope；携带 `acceptance`，最终落 `agent-send-failed`

契约：[Error classification](feature/error-classification/architecture.md)

其它写法：`send 执行失败`。

## 能力 {#capability}

`t` 暴露哪些动作由 `send` 的构造证据决定,不是声明式能力位

契约：[Agent contract](feature/adapters/architecture/agent-contract.md)

其它写法：`Capability`。

## 接入等级 {#integration-tier}

Tier 1 只接 `send`,Tier 2 再接 OTel,Tier 3 再暴露实验 flags

契约：[Adapters](feature/adapters/README.md)

其它写法：`Integration tier`。

## 无侵入 {#non-intrusive}

Tier 1 / Tier 2 不由 eval spawn 应用进程或另开端口;不写 `黑盒`

契约：[Adapters](feature/adapters/README.md)

其它写法：`Non-intrusive`。

## HITL {#hitl}

agent 等待人工输入;`waiting` + `input.requested` 构成能力证据

契约：[Sessions 与 HITL](feature/adapters/library/sessions-and-hitl.md)

其它写法：`人工介入`、`human-in-the-loop`。

## Agent Ensure {#agent-ensure}

Runner 在 `agent.ensure` 相位执行的 ensure 循环:Adapter 的 探测 未命中时由 Agent 安装层 install,装后复检

契约：[Agent Ensure](feature/adapters/architecture/agent-ensure.md)

## AgentEnsure {#agent-ensure-declaration}

Adapter 对自己 CLI 的目标 identity 与只读 探测;纯适配器在 Sandbox 内只保留这一份声明

契约：[Agent Ensure](feature/adapters/architecture/agent-ensure.md)

其它写法：`Adapter 的 ensure 声明`。

## Agent 安装层 {#agent-installer}

官方按 ensure identity 配对的安装实现;拥有 staged payload、平台探测与安装模式

契约：[Agent Ensure](feature/adapters/architecture/agent-ensure.md)

其它写法：`AgentInstaller`。

## staged payload {#staged-payload}

题面网络之外准备、经主 Sandbox 文件 API 送入的一组版本锁定安装文件;归 Agent 安装层

契约：[Agent Ensure](feature/adapters/architecture/agent-ensure.md)

## Sandbox {#sandbox}

Agent 与测试实际执行命令、读写文件的隔离运行空间及其操作句柄

契约：[Sandbox](feature/sandbox/README.md)

## SandboxLayer {#sandbox-layer}

Eval 或 Experiment 对同一主 Sandbox 的作者声明,分 template-bearing 与 command-only 两种形态

契约：[Sandbox Layer](feature/sandbox/library/layers.md)

其它写法：`Sandbox layer`。

## Provider {#provider}

Sandbox 的具体实现选择,由内置或自定义工厂显式构造

契约：[Sandbox library](feature/sandbox/library/README.md)

## workdir {#workdir}

Sandbox 内 agent 的默认工作目录,也是变更分类账与 agent diff 的参照点

契约：[Sandbox library](feature/sandbox/library/README.md)

其它写法：`工作目录`。

## SandboxOperations {#sandbox-operations}

`Sandbox`、`EvalSandbox` 与 `SandboxCommandTarget` 共用的命令、文本与字节操作；同名方法同语义

契约：[Sandbox operations](feature/sandbox/library/operations.md)

其它写法：`Sandbox 操作协议`。

## t.sandbox {#eval-sandbox}

沙箱型 eval 的文件 IO、宿主传输、命令执行、断言与 diff 接口

契约：[Sandbox operations](feature/sandbox/library/operations.md)

其它写法：`EvalSandbox`。

## 变更分类账 {#change-ledger}

runner 私有的 git 分类账;只把参照点之后的改动放进 agent 归因视图

契约：[Sandbox architecture](feature/sandbox/architecture/README.md)

其它写法：`Change ledger`。

## SandboxTemplate {#sandbox-template}

同时选择 Provider 并由其启动完整 Sandbox 实例的唯一起点；可以是 Compose、Dockerfile、image、E2B template 或 snapshot

契约：[Sandbox Layer](feature/sandbox/library/layers.md#template-bearing-factory)

其它写法：`Sandbox template`。

## Sandbox 能力要求 {#sandbox-capability-requirement}

Eval 对 Sandbox 必须兑现的 provider-neutral 约束；它不选择 Provider，也不创建第二个 Sandbox origin

契约：[Nested Docker Architecture](feature/sandbox-nested-docker/architecture/README.md#requirement-与-capability)

其它写法：`Sandbox capability requirement`。

## DockerExecutionRequirement {#docker-execution-requirement}

`docker/v1` 对私有 daemon、Compose、专用 kernel 与最低 Docker data 容量的穷尽要求

契约：[Nested Docker Library](feature/sandbox-nested-docker/library.md#sandboxrequirements)

其它写法：`Docker 执行要求`。

## 专用 kernel {#dedicated-kernel-isolation}

Agent 的 Docker 权限止于当前 guest kernel，不能到达宿主 daemon、kernel 或其它 Attempt

契约：[Nested Docker Architecture](feature/sandbox-nested-docker/architecture/README.md#四个-owner)

其它写法：`dedicated-kernel isolation`。

## Sandbox 实例 {#sandbox-instance}

Provider 启动的主 Sandbox；存在 sidecar、网络或服务时，同时点名这些伴随资源

契约：[Sandbox 实例与伴随资源](feature/sandbox/architecture/case.md)

其它写法：`Sandbox instance`。

## 主 Sandbox {#main-sandbox}

Provider 启动的唯一执行空间;Agent、Eval、文件 API、workdir 与 diff 都锚定它

契约：[Sandbox 实例与伴随资源](feature/sandbox/architecture/case.md#主-sandbox-不变量)

其它写法：`Main Sandbox`。

## BuildKey {#build-key}

一次 Provider 构建的输入身份,用于复用 Docker image 或 E2B template 构建结果

契约：[Sandbox 实例与伴随资源](feature/sandbox/architecture/case.md#buildkey-与-casekey两个身份各管一件事)

## Before cache {#before-cache}

Base 加上 occurrence 与 owner 包裹顺序规范化的零个或多个可缓存 before action 所形成的内容寻址 Sandbox 起点

契约：[Sandbox · before 缓存](feature/sandbox/architecture/README.md#before-缓存的身份与验证边界)

其它写法：`before 缓存`、`beforeCaches`、`beforeCachePlan`、`sandboxCache.before`、`SandboxBeforeCache`。

## BeforeCacheKey {#before-cache-key}

parent 前缀、规范化 steps、immutable inputs 与 Provider 捕获协议的链式内容身份

契约：[Sandbox · before 缓存](feature/sandbox/architecture/README.md#before-缓存的身份与验证边界)

## Provider artifact {#provider-artifact}

Provider 为 exact Sandbox template 或 before cache 捕获并验证的不可变 image、template、snapshot 或 volume 结果；物理 locator 不成为 Eval 语义

契约：[Sandbox · 前缀缓存](feature/sandbox/architecture/README.md#前缀缓存是可失败的优化)

## Sandbox 状态面 {#sandbox-state-surface}

一个 before action 承诺写入的完整可观察状态范围；V1 只有完整 Sandbox 与 inner Docker data 两种

契约：[Sandbox Layer](feature/sandbox/library/layers.md#action-family-与-step)

其它写法：`Sandbox state surface`。

## CaseKey {#case-key}

完整 attempt 运行条件身份,携带门的判据

契约：[Sandbox 实例与伴随资源](feature/sandbox/architecture/case.md#buildkey-与-casekey两个身份各管一件事)

## Provider cache {#provider-cache}

Roadmap 候选：Provider 为后续 Sandbox 保留的 Agent npm tarball、任务构建结果或原生 build cache；不属于结果携带或留存 Sandbox

契约：[Provider Cache 生命周期](roadmap/sandbox-cache-lifecycle/README.md)

## Cache Domain {#cache-domain}

Roadmap 候选：单一 cache backend 的所有权、命中、lease 与回收边界；identity 改变时形成新 Domain

契约：[Provider Cache Architecture](roadmap/sandbox-cache-lifecycle/architecture.md#cache-domain)

## GcPlan {#gc-plan}

Roadmap 候选：对一个 Cache Domain 的不可变回收授权预览；apply 只能因事实漂移缩减候选，不能扩大候选

契约：[Provider Cache CLI](roadmap/sandbox-cache-lifecycle/cli.md#两阶段回收)

其它写法：`GC 计划`。

## SandboxRetention {#sandbox-retention}

Provider 返回的独立能力句柄；主实例与伴随资源同时 suspend，跨进程由 detached provider inspect / wake / destroy

契约：[Sandbox 实例与伴随资源](feature/sandbox/architecture/case.md#收尾留存与注册表)

其它写法：`Sandbox 留存能力`。

## SandboxAllocation {#sandbox-allocation}

一条 Attempt 对 Provider 实例、私有磁盘与网络的 durable ownership 事实；用 generation fencing 与期望终态支撑 detached recovery

契约：[Nested Docker Architecture](feature/sandbox-nested-docker/architecture/README.md#sandboxallocation)

其它写法：`Sandbox allocation`。

## Docker storage profile {#docker-storage-profile}

raw DinD显式选择的宿主声明；只证明 Docker data allocation磁盘配额、跨进程准入与强杀恢复

契约：[Docker 执行配置](feature/sandbox-docker-profiles/README.md)

## Docker data allocation {#docker-data-allocation}

每 Attempt独占、带 project quota hard limit的磁盘配额分配；固定挂到 inner `/var/lib/docker`，内部可由预建目录池兑现

契约：[Docker profile architecture](feature/sandbox-docker-profiles/architecture/README.md#单容器资源)

## template owner {#template-owner}

为当前配对提供 template 的 Eval 或 Experiment owner；它只决定 Provider 起点，不形成 action 排序墙

契约：[Sandbox Layer](feature/sandbox/library/layers.md#顺序与依赖方向)

## action schedule {#action-schedule}

同一 occurrence 内根据显式依赖、typed capability 与 changeFrequency 形成的确定性 before 顺序

契约：[三方准备时序](feature/sandbox/architecture/lifecycle.md)

## SandboxAction {#sandbox-action}

四类 owner 共用的 `before` / `after` 执行单元；声明位置保留 owner 与 ordinal，planning 再编译 occurrence

契约：[Sandbox Layer](feature/sandbox/library/layers.md#command-形状与-identity)

其它写法：`Sandbox action`。

## 探测 {#detection}

只读探测命令,零副作用;退出码零为命中,非零是未命中而不是失败

契约：[内置 prepare 命令](feature/sandbox/library/prepare-commands.md)

## ensure {#ensure}

「探测 → 缺失才 install → 复检」的循环语义;`installTool` 是工具版,`agent.ensure` 相位是 Agent 版

契约：[内置 prepare 命令](feature/sandbox/library/prepare-commands.md)

## 内置 prepare 命令 {#prepare}

官方提供、自带 探测、缓存与稳定 identity 的 prepare 命令

契约：[内置 prepare 命令](feature/sandbox/library/prepare-commands.md)

## Prebuilt environment {#prebuilt-environment}

预装稳定依赖的 Docker image、E2B template 或 Vercel snapshot,供全新 Sandbox 直接使用

契约：[Prebuilt environments](feature/sandbox/library/prebuilt-environments.md)

## Sandbox 预热 {#sandbox-prewarming}

计划确定后提前创建即将使用的全新 Sandbox，不改变每 Attempt 的生命周期

契约：[Runner](runner.md)

其它写法：`Sandbox prewarming`。

## Sandbox 复用 {#sandbox-reuse}

Experiment 用 `sandboxReuse: true` 声明多条 Attempt 可以共用 Sandbox

契约：[Sandbox reuse](feature/sandbox/library/reuse.md)

其它写法：`Sandbox reuse`。

## 复用 Sandbox 的题间重置点 {#between-eval-reset-point-for-sandbox-reuse}

Sandbox 实例就绪后落下的 commit；共用同一 Sandbox 的 Attempt 之间重置回这里,再执行两层 prepare

契约：[Sandbox reuse](feature/sandbox/library/reuse.md)

其它写法：`Between-eval reset point for Sandbox reuse`。

## Sandbox 复用寿命 {#sandbox-reuse-lifetime}

Provider 能保证一个 Sandbox 继续运行的剩余时间，由 `ensureLifetime` 确认或续期

契约：[Sandbox reuse](feature/sandbox/library/reuse.md)

其它写法：`Sandbox reuse lifetime`。

## Cleanup reserve {#cleanup-reserve}

在 Attempt deadline 之外为 Hook 收尾与 Sandbox 销毁保留的内部安全时间

契约：[Sandbox reuse](feature/sandbox/library/reuse.md)

其它写法：`收尾预留时间`。

## Experiment {#experiment}

选择 Adapter、模型与运行条件的可签入配置；不定义 rubric、阈值或评分规则

契约：[Experiments](feature/experiments/README.md)

其它写法：`实验`。

## 实验组 {#experiment-group}

Experiment 的比较准入边界；具名组由 `experimentId` 第一段形成，根级 Experiment 各自形成单成员组

契约：[Experiments](feature/experiments/README.md#实验组与可比边界)

其它写法：`Experiment Group`。

## JudgeProvider {#judge-provider}

显式绑定服务协议、默认 model、端点、凭据声明位置与执行限制；Experiment 可替换模型或整个 Provider

契约：[Judge](feature/judge/library.md#runtime-配置)

其它写法：`裁判 Provider`。

## Flags {#flags}

A/B 条件键,经 `ctx.flags` 给 Adapter、`t.flags` 给 eval

契约：[实验值归属](feature/experiments/use-case/README.md#实验值归属)

其它写法：`实验 flags`。

## 运行时观测 {#runtime-observation}

运行时才知道、由 producer-owned typed collector 发布的值；不自动进入 eligibility identity 或 Attempt Core

契约：[实验值归属](feature/experiments/use-case/README.md#实验值归属)

其它写法：`Runtime observation`。

## 模型 {#model}

Experiment 为 agent 指定的模型标识;省略则用 agent 原生默认

契约：[Experiments](feature/experiments/library/README.md)

其它写法：`Model`。

## Reasoning effort {#reasoning-effort}

独立于 `model` 的推理强度档位;归属与 `model` 一致

契约：[Experiments](feature/experiments/library/README.md)

其它写法：`推理强度`、`reasoningEffort`。

## 首过即停 {#early-exit}

一个 eval 先过一次即中止其余 Attempt 的策略;配置名 `earlyExit`

契约：[Early exit](feature/experiments/use-case/early-exit.md)

其它写法：`EarlyExit`。

## Eval Group {#eval-group}

由无业务顺序的 Eval 闭集组成；Runner 按规范化 Eval ID 串行复用一台物理 Sandbox，不同 Group 可以并行

契约：[Eval Group](feature/eval-groups/README.md)

其它写法：`defineEvalGroup`。

## Plugin {#plugin}

挂在 Eval、Experiment 或 Eval Group 上的不可变条件蓝图；组合既有 owner contribution，不选择 Agent 或建立新运行时

契约：[Plugins](feature/plugins/README.md)

## 实验预算上限 {#per-experiment-budget-limit}

每个 Experiment 独立计账和封顶,不是 Invocation 的共享总预算

契约：[Budget](feature/experiments/use-case/budget-limit.md)

其它写法：`Per-experiment budget limit`。

## Runner {#runner}

负责发现、有界并发、重试、缓存与结果交付的调度引擎

契约：[Runner](runner.md)

其它写法：`运行器`。

## Hook {#hook}

Experiment 与 Agent 层的成对 `before` / `after` 回调；Hook 所在字段或对象决定执行范围，Sandbox 与 Eval 使用 layer 的 `before()` / `after()`。

契约：[Runner](runner.md)

其它写法：`生命周期 Hook`。

## Invocation {#invocation}

一次 CLI 调用的编排与 live 聚合边界；可创建多个 Run。编排与 live feedback 只属于当前进程，唯一 durable projection 是 Invocation Session

契约：[Runner](runner.md)

## 派发 {#dispatch}

把一个 Attempt 交出去开始执行;排队等待不算派发,停止派发不抢占在飞项

契约：[Runner](runner.md)

其它写法：`Dispatch`。

## 并发名额 {#concurrency-capacity}

全局 `maxConcurrency` 的一个名额,只在 Attempt 真正执行时占用

契约：[Runner](runner.md)

其它写法：`Concurrency capacity`。

## 实验并发限制 {#experiment-concurrency-limit}

`ExperimentDefinition.maxConcurrency` 对本 Invocation 内一个实验的 Attempt 并发限制

契约：[Max concurrency](feature/experiments/use-case/concurrency-max-global.md)

其它写法：`Experiment concurrency limit`。

## 有效宽度 {#effective-width}

全局并发名额和实验并发限制共同允许的同时执行数

契约：[Runner](runner.md)

其它写法：`Effective width`。

## 调度波次 {#scheduling-waves}

`ceil(Attempt 数 / 有效宽度)`;波次多的 Run 优先拿并发名额

契约：[Runner](runner.md)

其它写法：`Scheduling waves`。

## 完成状态 {#completion-status}

Invocation 的 `completed` / `interrupted` / `failed` 完成态，独立于 Verdict；Run 的终态由 Run state 表达，不使用完成标识

契约：[Runner](runner.md)

其它写法：`CompletionStatus`。

## fail-fast {#fail-fast}

无声明时按同一 error code 连续复现的 streak 保守停止派发

契约：[Runner](runner.md)

## 受理状态 {#send-acceptance}

`rejected` / `started` / `unknown`；只有可证明的 `rejected` 允许整段重发输入

契约：[Error classification](feature/error-classification/architecture.md#分类链)

其它写法：`Send acceptance`。

## Timeout {#timeout}

Adapter 内层超时加 Runner 外层 Attempt deadline;排队不计入

契约：[Runner](runner.md)

其它写法：`超时`。

## 总耗时 {#elapsed-time}

一次 Invocation 从开始到结束经过的时间，包含并行重叠和排队

契约：[Runner](runner.md)

其它写法：`Elapsed time`。

## 阶段耗时 {#phase-duration}

一个生命周期阶段实际经过的时间，由 Attempt 时间树写入

契约：[Benchmark](engineering/benchmark/README.md)

其它写法：`Phase duration`。

## Input identity {#input-identity}

带 domain 的 opaque equality token；只有 domain 相同且 value 相等才允许沿用

契约：[Cache](feature/experiments/architecture/cache.md)

其它写法：`输入身份`。

## 结果沿用 {#result-carry-forward}

合格的历史 Attempt 通过 reference Member 并入本次 Run、不重跑；`carried` 是 actions provenance，不是 Member 或结果状态

契约：[Cache](feature/experiments/architecture/cache.md)

其它写法：`Result carry-forward`、`carried`。

## Config identity {#config-identity}

带 domain 的 opaque equality token；配方改变时更换 domain

契约：[Cache](feature/experiments/architecture/cache.md)

其它写法：`配置身份`。

## 身份域变更 {#identity-domain-change}

NiceEval 更换某个身份 domain 时登记的具名变更；`encoding-only` 可由旧算法纯重建后沿用，`behavior-changing` 必须重跑

契约：[Cache](feature/experiments/architecture/cache.md#niceeval-身份域变更)

其它写法：`Identity domain change`、`IdentityDomainChange`。

## Transcript {#transcript}

Adapter 的临时逐事件输入；归一后可供本次 Attempt 消费，但不是持久 Run 格式

契约：[Observability](observability.md)

## StreamEvent {#stream-event}

Transcript 或 `send` 返回归一化成的临时统一事件模型

契约：[Events](feature/adapters/architecture/events.md)

其它写法：`标准事件流`、`events`。

## trace 瀑布图 {#trace-waterfall}

从 owner-monotonic timing interval 投影的时间关系；OTLP 只可补充本次采集

契约：[Observability](observability.md)

其它写法：`Trace waterfall`。

## Usage {#usage}

token bucket、单个 request 或 provider-observed cost 的原子 observation；不是 Attempt 总计

契约：[Observability](observability.md)

其它写法：`用量`。

## 成本 {#cost}

provider-observed cost 是事实；价格表估算、FX 与跨币种汇总是 Calculation

契约：[Observability](observability.md)

其它写法：`Cost`。

## Collection {#collection}

一个已发布 typed fact 的 complete 或 partial 完备度；不是 reader 的 unavailable 或 invalid 状态

契约：[Run](feature/run/README.md)

其它写法：`采集状态`。

## limitation {#limitation}

partial collection 必有的 closed、非空原因；表达上限、截断、脱敏或采集不足

契约：[Run](feature/run/README.md)

其它写法：`采集限制`。

## owner-local identity {#owner-local-identity}

producer 为 turn、item、call、command、usage、interval 与 diagnostic mint 的稳定身份

契约：[Run](feature/run/README.md)

## Source receipt {#source-receipt}

一个 capture authority 在真实边界产生的已归一、脱敏且不可变事实 segment

契约：[Run](feature/run/README.md)

## Run {#run}

创建后立即可发现的运行资源；状态为 `active | completed | interrupted | failed`

契约：[Run](feature/run/README.md)

## Canonical Record {#canonical-record}

项目内唯一 `.niceeval/record.sqlite`；同时是即时可读事实源与通过 graceful portable gate 后可搬运的 artifact

契约：[Run Architecture](feature/run/architecture/README.md#canonical-record-与-staging)

其它写法：`canonical Record`。

## Portable gate {#portable-gate}

受控退出时 close writer、truncate WAL，并以内建只读路径验证 schema 与领域不变量的交付门

契约：[Run Architecture](feature/run/architecture/README.md#portable-gate-与不可信输入)

其它写法：`portable gate`。

## Planned attempt {#planned-attempt}

Run 创建时冻结的 expected 位置；最多原子绑定一个已发布 Attempt

契约：[Run Architecture](feature/run/architecture/README.md)

其它写法：`计划 Attempt`、`plannedAttemptId`、`plannedAttempts`、`originPlannedAttemptId`。

## Attempt publication {#attempt-publication}

同一事务提交 immutable Attempt closure、publication identity 与 origin binding 的线性化点

契约：[Run Architecture](feature/run/architecture/README.md#attempt-publication)

## Member {#member}

一个 Planned attempt 对已发布 Attempt 的 origin 或 reference binding；不复制 Attempt

契约：[Run Architecture](feature/run/architecture/README.md)

## Run absence {#run-absence}

终态 Run 中未绑定 Planned attempt 的闭集原因；不伪造 Attempt 或 Member

契约：[Run Architecture](feature/run/architecture/README.md#run-收口与-absence)

## runHost {#run-host}

以 `list/get/delete/recover` 管理 Run 的高层领域 SDK；不暴露 SQLite 或通用 writer

契约：[Run Library](feature/run/library.md)

其它写法：`Run Host`。

## 源码快照 {#sources-snapshot}

origin Run-owned 不可变事实；保存当时 source closure 的 logical tokens 与 content

契约：[Run Observability](feature/run/architecture/observability-attachments.md)

其它写法：`Sources snapshot`。

## 源码项 {#source-item}

Sources snapshot 中由 `SourceItemId`、canonical project-relative path、SHA-256 与 content 标识的一项源码

契约：[Run Observability](feature/run/architecture/observability-attachments.md)

其它写法：`source item`。

## unmapped {#unmapped}

可读 Assertion 没有可用 source navigation；不改变 Assertion、Verdict 或 Score

契约：[Source sites](feature/assertions/architecture/source-sites.md#局部-unmapped-与-assertion-隔离)

其它写法：`未映射`。

## InvocationReceipt {#invocation-receipt}

交付 `createdRunIds`、Invocation completion 与 opaque `publicationCutoff` 的进程返回值

契约：[Experiments](feature/experiments/architecture/README.md#invocation-receipt-与退出)

其它写法：`Invocation receipt`。

## AttemptLocator {#attempt-locator}

完整 `attemptId` 的确定性人读别名：`@1` 加 SHA-256 前 60 bit 的 12 字符规范大写 Crockford 编码；碰撞时返回 `ambiguous`

契约：[Run](feature/run/architecture/README.md)

其它写法：`Attempt 定位符`、`Attempt locator`。

## Inspection operation {#inspection-operation}

NiceEval 第一方维护的具名读取问题，拥有穷尽 request、result 与错误 union

契约：[Inspection Architecture](feature/inspection/architecture.md#共享的固定-query-definition)

## Inspection result {#inspection-result}

在一个 `PublicationCutoff` 上关闭 selection、分母、limits、issues 与 Evidence 的 plain-data 结果

契约：[Inspection Architecture](feature/inspection/architecture.md)

## PublicationCutoff {#publication-cutoff}

一次 operation 固定的 Run create、Planned attempt binding、Run close 与 deletion 可见边界

契约：[Run Architecture](feature/run/architecture/README.md#publicationcutoff)

其它写法：`Publication cutoff`。

## Selection audit {#selection-audit}

结果随附的选择依据、成员与排除说明；不是数据库 cursor 或文件位置

契约：[Inspection CLI](feature/inspection/cli.md#machine-输出与错误面)

其它写法：`selection audit`。

## ExecutionReusePlan {#execution-reuse-plan}

对当前逻辑位置保留 reuse 或 gap 适用性，再按运行选项选择沿用或执行；只读预览不分配 Run identity

契约：[Cache](feature/experiments/architecture/cache.md#公开形状)

其它写法：`执行沿用计划`。

## 执行缺口 {#execution-gap}

当前目标中没有合格 Attempt 的位置；不是 Attempt 或 Run state，也不是强制重跑选项；实际派发仍受预算与 early exit 约束

契约：[Cache](feature/experiments/architecture/cache.md#当前结果可用性与执行选择)

其它写法：`Execution gap`。

## Pricing profile {#pricing-profile}

带内容身份与 coverage、只供固定 Inspection cost operation 投影成本的价格规则集合

契约：[Inspection](feature/inspection/README.md)

其它写法：`价格配置`、`PricingProfile`。

## Insight {#insight}

NiceEval 自己维护、供用户审阅 Run、Attempt 与证据的本机 SPA；不是网页作者平台

契约：[Insight](feature/insight/README.md)

## View generation {#view-generation}

一个 Insight 进程当前固定的 `PublicationCutoff`；刷新成功后才原子切换

契约：[Insight Architecture](feature/insight/architecture.md#generation刷新与收尾)

其它写法：`Insight generation`。

## 预置准备 {#preparation}

跑 agent 前的准备逻辑,按职责分层:layer 的 `before()`、Agent Ensure、`test(t)` 普通代码与外部编排；`SandboxAgent.before` 只连 runtime / 鉴权

契约：[Sandbox library](feature/sandbox/library/README.md)

## CLI flag {#cli-flag}

命令行开关（如 `--model`）；写作时一律带「CLI」限定或写字面 `--xxx`，不与实验 flags 混用

契约：[CLI](cli.md)

## 可重评分 Eval {#replayable-eval}

Roadmap 候选：用独立 execution 与 grading definition 保存完整多轮证据，并允许只对 sealed Execution graph 重新评分

契约：[可重评分 Eval](roadmap/replayable-grading/README.md)

其它写法：`Replayable Eval`。

## Execution graph {#execution-graph}

Roadmap 候选：保存一次 replayable Agent 执行的 Session、Turn、Action、显式材料、provenance 与 ExecutionOutcome 的 sealed semantic source graph

契约：[Replayable Architecture](roadmap/replayable-grading/architecture.md#execution-source)

## Grading {#grading}

Roadmap 候选：当前 GradingDefinition 对一份 sealed Execution graph 复用或产生 Judge Evaluation，再建立不可变 Grading Claim

契约：[Replayable Architecture](roadmap/replayable-grading/architecture.md#judgeevaluation-与-gradingclaim)

## GradingRun {#grading-run}

Roadmap 候选：对一个 Experiment Run 已写入 Record 的 SampleManifest 执行或复用全部 Grading 的持久批次

契约：[Replayable Architecture](roadmap/replayable-grading/architecture.md#gradingrun-与-gradedsample)

## GradingResult {#grading-result}

Roadmap 候选：单项 Grading 按 pass 或 score evaluation kind 判别的终态，与 ExecutionOutcome 分开保存

契约：[Replayable Architecture](roadmap/replayable-grading/architecture.md#gradingrun-与-gradedsample)

## SampleManifest {#sample-manifest}

Roadmap 候选：一个 Experiment Run 写入 Record 的候选分母、Execution graph 引用、carry provenance 与 coverage

契约：[Replayable Architecture](roadmap/replayable-grading/architecture.md#gradingrun-与-gradedsample)

## Judge Material View {#judge-material-view}

Roadmap 候选：从受管 Execution 或 Grading definition source 创建、只能绑定到 recipe input 的私有品牌 Judge 输入句柄

契约：[Judge Material Library](roadmap/judge-runtimes-material/library.md)

## Action Result Selector {#action-result-selector}

Roadmap 候选：按 occurrence 或封存动作元数据精确选择 Action result、且不能读取 output 的持久选择器

契约：[Judge Material Library](roadmap/judge-runtimes-material/library.md#action-result-selector)

其它写法：`ActionResultSelector`。

## MaterialBindingManifest {#material-binding-manifest}

Roadmap 候选：穷尽保存一次 Judge Check 的 input 声明、已定位 source、已交付 representation 与授权能力的 canonical manifest

契约：[Judge Material Architecture](roadmap/judge-runtimes-material/architecture.md#materialbindingmanifest)

其它写法：`材料绑定清单`。

## Judge Evaluation {#judge-evaluation}

Roadmap 候选：一次 evaluator occurrence 的 manifest、presentation 或 investigation closure 与 Decision；不拥有 threshold 或 score policy

契约：[Judge Material Architecture](roadmap/judge-runtimes-material/architecture.md#实体与-owner)

其它写法：`JudgeEvaluation`。

## Pilot 选择 {#pilot-selection}

Roadmap 候选：在 attempts 展开前按共同 Eval ID 总体执行 first 或固定 seed sample，并保留 non-final coverage

契约：[Experiment Pilot 抽样](roadmap/experiment-pilot-sampling/README.md)

其它写法：`Pilot selection`。

## 具名 Experiment 族 {#experiment-family}

Roadmap 候选：用一个 keyed record 展开多个普通 Experiment；文件路径与 key 共同形成稳定 ID

契约：[具名 Experiment 族](roadmap/experiment-authoring-families/README.md)

其它写法：`Experiment family`、`defineExperiments`。

## Fixture 内容命令 {#fixture-content-command}

Roadmap 候选：把本地内容登记、digest-backed identity 与 `putContent` 组成一个普通 prepare command

契约：[Fixture 内容命令](roadmap/sandbox-prepare-fixture-content/README.md)

其它写法：`Fixture content command`、`putFixture`。

## Agent Judge {#agent-judge}

Roadmap 候选：作为 Assertion evaluator 运行的独立 Agent；调查证据后返回 measurement、理由与引用，不拥有 Verdict 或 score policy

契约：[Agent Judge](roadmap/judge-runtimes-agent/README.md)

## 准入健康 {#admission-health}

Roadmap 候选：每条 fresh Planned attempt 在 Agent 进入前，对 producer occurrence 做一次健康裁决；结果归 Run，不形成 Assertion

契约：[准入健康](roadmap/admission-health/README.md)

其它写法：`Admission health`。

## State cohort {#state-cohort}

Roadmap 候选：State Provider 颁发身份的一条持久状态 lineage，约束 Checkpoint、Region 与 schema 的共同归属

契约：[持久状态](feature/state/README.md)

其它写法：`状态 Cohort`。

## State checkpoint {#state-checkpoint}

Roadmap 候选：State cohort 内由 Provider 发布的 immutable exact 状态点；Comparable 状态必须带内容摘要

契约：[持久状态](feature/state/README.md)

其它写法：`状态 Checkpoint`。

## Eval Trajectory {#eval-trajectory}

Roadmap 候选：由源码路径定身份、用显式依赖组成，并能从 exact Checkpoint 跨 immutable Run segment 恢复的 Eval DAG

契约：[Eval Trajectory](feature/eval-trajectories/README.md)

其它写法：`Eval trajectory`。

## Workspace access evidence {#workspace-access-evidence}

Roadmap 候选：可信 Sandbox producer 归因给 Agent 进程树的逻辑文件操作集合

契约：[Workspace 访问证据](roadmap/workspace-access-evidence/README.md)

其它写法：`Workspace 访问证据`。

## 发现边界 {#discovery-boundary}

Roadmap 候选：显式目录入口拥有的递归 Eval discovery 范围；父级扫描在入口处停止向内发现

契约：[发现边界](roadmap/discovery-boundaries/README.md)

其它写法：`Discovery boundary`。

## Experiment 展示名 {#experiment-display-name}

Roadmap 候选：与 description、Experiment identity 分离且不参与 reuse、选择或去重的人类可读标签

契约：[Experiment 展示名](roadmap/experiment-authoring-display-names/README.md)

其它写法：`Experiment display name`、`displayName`。

## Record 库存 {#record-inventory}

Roadmap 候选：在 frozen Record view 上按 canonical Run ID 枚举的只读库存；不推导最新结果

契约：[Record 库存](roadmap/record-inventory/README.md)

其它写法：`Record inventory`。

## 模型用途 {#model-role}

Experiment 为应用声明的模型用途，例如 mind 与 speech；键表达模型在应用里担任的角色。

契约：docs/feature/adapters/library/README.md

其它写法：`Model role`、`modelRole`、`ModelRoleSelection`、`defineModelRoles`。

## before {#before-hook}

作者声明的前置生命周期 Hook；所在字段或对象决定包裹的工作、执行位置与次数。

契约：docs/api-design.md#生命周期统一用-before--after

其它写法：`前置 Hook`、`AgentBefore`。

## after {#after-hook}

作者声明的收尾生命周期 Hook；按实际已激活顺序逆序执行，并保留既有失败语义与 cleanup callback 语义。

契约：docs/api-design.md#生命周期统一用-before--after

其它写法：`收尾 Hook`、`AgentAfter`。

## SessionKey {#session-key}

Adapter 私有会话状态的键；用于在 Agent Session 中保存和读取状态。

契约：docs/api-design.md#不再用-slot

其它写法：`会话状态键`、`createSessionKey`。

## recipe input {#recipe-input}

Judge recipe 接收的显式材料输入，由输入声明确定可交付的材料。

契约：docs/api-design.md#不再用-slot

其它写法：`recipe 输入`。

## Observability {#observability}

由 Adapter 收集并归一的事件、用量与时间等运行证据，供 Assertion 与 Inspection 消费。

契约：docs/observability.md

其它写法：`可观测性`、`ObservabilitySummary`。

## baseUrl {#base-url}

Agent factory 连接模型服务的基础端点地址。

契约：docs/api-design.md#作者字段与-cli

其它写法：`服务基础地址`。

## Agent 安装 {#agent-installation}

Agent 安装层执行并持久化的安装事实；与包裹运行的生命周期 Hook 分开表达。

契约：docs/api-design.md#生命周期词汇的遗漏位置

其它写法：`Agent installation`、`AgentInstallationManifest`、`reportInstallation`、`agentInstallation`。
