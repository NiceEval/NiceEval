---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Experiments —— 怎么跑这批 eval

一个 eval 描述**测什么**(这轮对话该发生什么、怎么算对)。
一个 **experiment** 描述**怎么跑这批 eval**:用哪些 agent、跑几次、过滤哪些、预算多少。
两者刻意分开。

```
evals/        # 测什么 —— agent 无关,评分逻辑都在各自的 test() 里
experiments/  # 怎么跑 —— 运行矩阵:agent × model × attempts over 选定 evals
```

> 外部方案的参考与取舍单独收在[设计参照](../../research/experiments/README.md)，不作为目标契约的一部分。

## 为什么要分开

- **eval 不该知道被测的是谁。**
  同一条 memory eval,既要测 claude-code 也要测 codex/bub。
  把 agent 写死进 eval 就废了复用。
- **experiment 是可签入的运行配置。**
  比一串临时 CLI flag 可复现:`niceeval exp compare` 永远跑同一组对照。
- **跨 agent / 跨配置对比是一等公民。**
  每个实验文件声明一个配置；报告只在 `Sample` 已经选好的同一实验组内比较，不在页面打开时另选结果。

实验文件改名会改变 `experimentId`。需要采用已有 Attempt 时，使用[实验改名与 Run 采用](rename.md)建立 reference Member；其 Core `accepted` action 与精确引用就是可复核的采用事实。
  目录组织源码、生成 id、支持 CLI 前缀选择，并且由第一段表达实验组。

## 实验组与可比边界

实验组是 Experiment 的比较准入边界，不是 [Eval Group](../eval-groups/README.md) 的 Sandbox 复用 lane，也不是具名 Experiment 族的作者语法。

```text
experiments/compare/baseline.ts      -> Experiment compare/baseline  -> named/compare
experiments/compare/nested/model.ts  -> Experiment compare/nested/model -> named/compare
experiments/smoke.ts                 -> Experiment smoke             -> singleton/smoke
```

`named/<segment>` 取 `experimentId` 的第一段；更深的目录只组织成员。根级 Experiment 没有作者声明的同组成员，因此以 `singleton/<experimentId>` 形成自己的单成员组。两种 identity 是 Analysis、Report route 与机器输出中的判别联合，不成为另一套 CLI 参数；`niceeval exp foo` 与 Report 的 `--experiment foo` 继续使用同一实验 selector 规则。

目录就是作者声明的比较准入边界：同一组中的成员可以比较，Eval population 不同只表示样本命中范围不同，不能否决比较。每个成员的指标使用自己实际运行的 Eval 和自己的分母；未运行的 Eval 没有数据，不补零、不计为失败，也不自动收缩成共同交集。Analysis 仍保留 evaluation kind、Measure population 与 basis，不把 Pass 和 raw Score 混成同一种排名。

实验组不写入 Record。历史 Run 从已封存的 `experimentId` 派生组；跨第一段改名后，目标 Run 属于新组，origin Attempt 仍保留自己的历史身份。

## 与 Record 的边界

`<project>/.niceeval/record/` 是跨 Invocation、Experiment 与 Run 的 [Record](../record/README.md)。
Experiment 只提供运行配置；Runner 在一次 Invocation 中为每个选中的 Experiment 建立一个 Run。

一个 Run writer（Run 写入者）只拥有自己新建的 `runs/<RunId>/`。`complete`（完成标记）是这个 Run
独立的原子发布点。Record 没有全局 writer lock（写入锁）、Invocation 级发布点或全局内存快照。

Coordination（协调）在 Record 外拥有执行去重、`maxConcurrency`、同一 Experiment 的 dispatch claim
（派发占用）以及 build / lease（构建 / 租约）。这些本地协调状态位于 `.niceeval/`，不随 Record
直接复制或进入 Git。Record 只保存已发布 Run 的 durable fact（持久事实）；可搬运输入必须由 `record snapshot` 形成。

当前 Project Target 与本次 policy 先进入 [reuse planning](cache.md)。reuse planning 只从已发布 Run
得到 `reuse | gap`；planner/scheduler 只执行 gap。局部执行是本次 reuse planning 的结果，Record
不保存“需要补跑”或“当前可复用”。

Run 的 expected membership 定义本次分母。Member 把每个 slot 连接到一个精确 Attempt；`origin | reference` 由关系派生，executed/carried/accepted 等原因属于 actions provenance。Attempt 永远保留实际执行它的 origin Run。
因此 locator 始终由同一个完整 `attemptId` 表达，不会因采用动作而改变。

Invocation 有 `invocationId`，用于关联瞬时进度与最终 receipt。receipt 的 `runIds` 只关联本次已发布
Run；Run、Member、action 与 reference 仍由 Core 保存，供之后从公开读取面复核。
一次 Invocation 可以产生零到多个 Run，每个 Run 恰好属于一个 Experiment。

## Host composition boundary

`niceeval/experiment/host` 导出公开、受支持的高级 Host composition SDK `experimentHost`。NiceEval CLI 的
`exp` 经 `list()`、`plan()` 与 `run()` 组合，`accept` 经 `accept()` 组合；替代 CLI / Web host 或深度应用集成
也使用同一窄操作面。dispatch claim 与 Record lease 属于 `coordinationHost`，durable Record I/O 属于
`recordHost`。`defineExperiment` 作者不导入 Host entry，也不能借它重建 Runner、selector 或 adoption 内部状态。

## `defineExperiment` 的形状

```typescript
import { defineExperiment, type JsonValue } from "niceeval";
import type { Agent } from "niceeval/adapter";

interface EvalDescriptor {
  id: string;
  description?: string;
  tags: readonly string[];
  evaluationKind: "pass" | "score";   // 题型:defineEval → "pass",defineScoreEval → "score"
  metadata?: Readonly<Record<string, JsonValue>>;
}

export default defineExperiment({
  description?: string;                       // 人读
  agent: Agent;                              // 跑哪个 agent(adapter 实例)
  model?: string;                            // 单个模型(agent 留空);省略=原生默认。跨模型对比写多个实验文件
  reasoningEffort?: string;                  // 推理努力程度(agent 留空);省略=原生默认。经 ctx.reasoningEffort / t.reasoningEffort 透传
  judge?: JudgeConfig;                       // 本实验的裁判执行配置；用于可签入的 judge A/B，不定义 rubric / severity / threshold
  flags?: Record<string, JsonValue>;        // KV 参数,透传到 ctx.flags / t.flags(见 Library);必须 JSON 可序列化——
                                            // 实验是可签入可复现的配置,函数/类实例装不进 Run;解析时校验,非 JSON 值直接报错
  labels?: Record<string, string | number>; // 报告归类标注:实验在各对比轴上的坐标(如 { line: "codex", memory: "mempal" })。
                                            // 不透传 ctx / t;报告用 label() / numericLabel() 按它归类(见 Library)
  attempts?: number;                         // 每个 (agent × model × eval) 跑几次(默认 1)
  earlyExit?: boolean;                       // 先过一次即停其余(默认 false,attempts 默认跑满测完整通过率)
  evals?: "*" | readonly string[] | ((e: EvalDescriptor) => boolean); // 跑哪些 eval(默认 "*")
  timeoutMs?: number;                        // 单次运行超时
  sandbox?: SandboxLayer;                    // 本实验向主 Sandbox 贡献的一层:template-bearing factory 产物,
                                            // 或 sandboxLayer() 的命令链;省略等价于空的 command-only layer
  sandboxReuse?: true;                       // 多条 Attempt 可以共用 Sandbox；省略时每 Attempt 全新
  sharedState?: { readonly key: string };    // 共享 checkpoint / 数据库的跨 Invocation 独占身份
  budget?: number;                           // 整个实验估算成本上限($),超了停止派发
  maxConcurrency?: number;                   // 只限制本 Invocation 内该实验的 attempt
  classifyFailure?: AttemptFailureClassifier; // 识别本实验共享基建的失败形态,为止损闸声明波及范围
  setup?: (ctx: ExperimentHookContext) => void | Promise<void>;     // 实验级生命周期:整场一次、宿主机侧(见下)
  teardown?: (ctx: ExperimentHookContext) => void | Promise<void>;  // 全部 attempt 收尾后执行;setup 时点走到过才触发
});
```

`evals` 的一次实际选择必须全是通过制或全是计分制 eval；混型在启动前拒绝并列出两类 ID。
题型由 `EvalDescriptor.evaluationKind` 给报告：通过制读 Verdict 的通过率，计分制读 sealed Assertions 的
earned score。两种 Eval 的每个 Attempt 都有四态 Verdict，Score Eval
另有 complete、partial 或 unavailable 的 score state。`points` 只是 Assertion 分值，不是第三种题型。
计分语义见[计分粒度](../assertions/library/score-points.md)。

`judge` 属于运行配置：同一批 eval 可以在两个 Experiment 中只改变裁判模型或端点，得到可签入、可复现、会进入指纹的 judge A/B。它只规定**怎样执行裁判**（model / baseUrl / apiKeyEnv / timeoutMs），不允许 Experiment 定义题目的 rubric、评分材料、severity 或 threshold；这些仍只写在 Eval 的 judge assertion 上。求值链见 [Architecture · 配置求值](architecture.md#配置求值链一次求值处处同源)，完整场景见 [Judge A/B 用例](../judge/use-case/experiment-ab.md)。

`flags` 与 `labels` 的分界是**这个值会不会改变 attempt 里发生的事**。
会改变行为的值，例如联网开关或注入的 skill，写入 `flags`，并由 `ctx.flags` / `t.flags` 使用。

只给报告归类的值，例如「这格用的记忆机制是 mempal」，写入 `labels`。
Agent 与 Eval 看不见它，改它不让已有 Attempt 失去采用资格。
再次运行会以当前 labels 建立新 Run，并通过 reference Member 连接已有 Attempt；Core relation、action 与精确 origin 共同说明该成员怎样进入目标 Run。

两者都是实验作者写下的**声明**。
运行后才存在的值，例如 `setup` 起出的隧道 URL 或服务端报回的版本，两个袋子都不进。只有 NiceEval 已发布的 typed collector 或 Adapter 能力，才能把语义匹配的运行时观测写入 Record catalog 中与 owner 匹配的 fixed family。
没有已发布 collector 的第三方值不自动持久化，也不能查询。

三个家的判据按场景查[用例手册 · 实验值归属](use-case/实验值归属/)。声明与消费见 [Library · labels 与运行时观测](library.md#labels-与运行时观测)。

`maxConcurrency` 是本 Invocation 内的**实验并发限制**:只让该实验的 Attempt 排队,同批其它实验照常按全局并发跑。
它可以表达一次运行内严格串行、严格重试或只维护 N 个可复用 Sandbox，但不会因为另一个终端也选了同一 Experiment 而共享名额。
什么场景配什么值(跨 eval 累积记忆、给撞限额的实验降速、`attempts` + `earlyExit` 的严格重试等),逐例见[用例手册 · 并发怎么配](use-case/并发/);限制的持有期语义单点在 [Runner · 调度](../../runner.md#调度有界并发)。

`sharedState: { key }` 声明该 Experiment 会恢复、修改并回存一份跨 Invocation 共享的可变状态。
Runner 通过同一项目 Coordination 域内的 `key` 独占整个状态区间。同一 Record root 的多个
Invocation 也使用这条规则；Record 自身不提供这个互斥。

区间从 Experiment `setup` 与任何 Sandbox lifecycle `setup()` 之前开始。最后一个 Attempt settle 后，Runner
先冻结该 Experiment 的 reusable Sandbox pool registry。随后它只停止一次全部 pool，包括 Sandbox teardown 与
Provider finalizer，最后执行 Experiment `teardown`。

只有整条 cleanup 链全部成功才释放租约。setup 失败仍要等待停稳并继续 cleanup；它本身不会把成功的 cleanup
变成遗留 lease。任何实际 cleanup、finalizer 或 teardown 的失败、超时或中断都会保留 lease，CLI exit sweep 不会删除它。

sharedState 没有 heartbeat 过期接管或 PID 自动接管。owner token 与 generation 都不可变；heartbeat 以 exact
token/generation 专属的原子 sidecar 更新，且只作诊断。sidecar 不能改变 authority，也不会让旧 owner 影响新 generation。
确认原 owner 已终止且远端状态已静默后，操作员才可用公开的 `niceeval exp <selector> --teardown` recovery flow 运行
一次补偿 teardown；详见 [CLI · 协调等待与恢复](cli.md#协调等待与恢复)。这个字段只提供互斥，不代替 checkpoint
存储、原子提交或强杀恢复。

#### Linux zombie owner recovery

同机 Linux owner 的 `/proc/<pid>/stat` 为 `Z`、`X` 或 `x` 时已终止；状态证据无法读取或解码时，显式恢复仍 fail closed。

同一 Experiment 的独立 Sandbox 不共享可变状态时省略它；两个 Experiment 确实指向同一 checkpoint 时使用同一 `key`。
key 是会进入 Run 条目的稳定非密字符串，必须匹配 `[a-z0-9][a-z0-9._/-]{0,127}`；不把 token、账号或其它凭据编进 key。
未声明时，配置身份对象和 manifest 都不写 `sharedState` 键，保持既有 base config hash；声明、删除或改 key 分别在
`--dry` 的具名差异中显示为 `config:sharedState.key` 的 added、removed 或 changed。

`classifyFailure` 是实验作者识别共享基建死因的纯分类器。
它只声明失败是否可重试、以及死因波及 attempt、eval 还是整个 experiment，不配置重试次数或退避策略，也不参与 fingerprint。
输入形状、分类链和止损语义见[执行失败分类](../error-classification/architecture.md#类型)，真实写法见其[Library](../error-classification/library.md#实验--eval-作者声明死因的波及范围)。

`setup` / `teardown` 是**实验级生命周期 Hook 对**:整场至多一次、跑在宿主机上。
`setup` 在本实验第一个真正要派发的 attempt 之前执行;`teardown` 在本实验全部 attempt 收尾后执行(失败、中断也执行),当且仅当 `setup` 的时点走到过——`setup` 抛错不豁免,半路失败的现场同样要扫尾;一个 attempt 都不派发时两者都不跑。
它们管「每个实验一份、所有 attempt 共享」的宿主机侧资源:起一条到内网服务的隧道、拉起本实验专用的 mock server、租一个 license。

`setup` 的定义值写模块级变量,`teardown` 与同文件的 agent 工厂 / prepare command 从闭包读——runner 不做值的中介。
成对 `setup` / `teardown` 只属于 Experiment 与 Agent 两层;Sandbox 与 Eval 的准备走 layer 的 `prepare()`,闭包传状态对两类入口同样适用(统一语义见 [Runner · 预置顺序](../../runner.md))。
用法与失败语义见 [Library · 实验级共享服务](library.md#实验级共享服务setup-与-teardown)、执行语义见 [Architecture · 实验级生命周期](architecture.md#实验级生命周期setup-与-teardown)。

生命周期各层各归各位,`setup` 不替代其它层:

- 按实验变化的**沙箱内**准备(装二进制、预热、写实验配置)写 Experiment `sandbox` layer 的 `prepare()` 命令,每条 Attempt 在变更分类账标记前执行。
- 这条 eval 自己的题目准备写 Eval layer 的 `prepare()` 或 `test(t)` 普通代码。
- 装 Agent CLI 归 Agent layer(Adapter 的 ensure 声明 + 配对安装层),连 agent 归 `SandboxAgent.setup`。
- 跨 Attempt 的实际 Sandbox 目录、服务或快照由 `SandboxLayer.setup()` / `teardown()` 成对恢复与回存；声明 `sandboxReuse: true` 时，它们按每个物理 Sandbox 执行一次。
- 跨实验、这次 run 之前就该存在的资源仍用外部编排。

哪层放什么按场景查[用例手册 · 预置与收尾怎么放](use-case/生命周期/);完整分工表见 [Sandbox 预置分工](../sandbox/library.md)、准备命令的声明见 [Sandbox Layer](../sandbox/layers.md)。

`sandbox` 字段声明本实验的 `SandboxLayer`。
具体 Provider factory(如 `e2bSandbox({ template })`)产出携带完整起点的 template-bearing layer;`sandboxLayer()` 产出只执行准备命令的 command-only layer。

每个实际选中的 Eval × Experiment 配对恰好一方带 template。
双方都带报 `sandbox.template-conflict`,双方都不带报 `sandbox.template-missing`;link 全矩阵聚合,在创建任何资源前报错。
配对规则见 [Sandbox Layer](../sandbox/layers.md#每个配对的-link-约束)。
一批 eval 起点不同时,各条 Eval 自带 template-bearing factory,experiment 侧保持 command-only;写法见 [Library · 不同 Eval 自带预制起点](library.md#不同-eval-自带预制起点)。

`sandboxReuse: true` 是实验作者对 Sandbox 生命周期的声明，不是一次运行的提速开关。
它表示选中的 Eval 可以在题间 reset 后共用 Sandbox。
复用只改变 Case 创建次数:reset 到 Case 就绪点后,每条 Attempt 仍重新执行两层 layer 的 prepare 命令。
省略时，每个 Attempt 使用全新 Sandbox。

同时活跃的 Sandbox 数由现有并发限制决定：同一个 Sandbox 一次只执行一条 Attempt；Experiment 的 `maxConcurrency` 与全局并发位共同限制同时运行数。
需要严格串行时声明 `maxConcurrency: 1`。
完整顺序、Provider 能力与 Attempt 采用边界见 [Sandbox 复用](../sandbox/reuse.md)。

新的 run 需要从 checkpoint 起步时，同样在实际 Sandbox 创建后的 `setup()` 恢复，并在该实例退休前的 `teardown()` 回存。
需要同一条连续实例时声明 `sandboxReuse: true`；本 Invocation 需要固定顺序时另行声明 `maxConcurrency: 1`；多个 Invocation 指向同一 checkpoint 时再声明 `sharedState`。
完整的物理 Sandbox 生命周期与复用次数见 [Sandbox 生命周期](../sandbox/lifecycle.md) 与 [Sandbox 复用](../sandbox/reuse.md)。

`timeoutMs` 始终是单条 Attempt 的 deadline，不能为了延长 Sandbox 存活而提高。
需要更长 Sandbox 复用寿命时，在 template-bearing factory 的 options 里声明 `lifetimeMs`。
两个时间的关系见 [Sandbox 复用 · 两种时间](../sandbox/reuse.md#两种时间不能混用)。

id 只从**路径**推导:`experiments/agents/codex/gpt-5.4.ts` → `agents/codex/gpt-5.4`(禁止手写 id)。
任意深度目录都只形成 id 前缀，见 [Library · 路径只表达身份](library.md#路径只表达身份与选择)。

## 相关阅读

- [用例手册](use-case/README.md) —— 规则难懂先查这里:并发怎么配、预置放哪层、flags 还是 labels、选哪些 eval,以及各 CLI 输入面的全流程用例。
- [Library](library.md) —— model/flags 怎么透传、怎样选择 eval、路径怎样形成 id、与 config 的关系。
- [缓存与携带](cache.md) —— 上一轮的结果哪些还算数:指纹算什么、携带要过哪几道门、`--rerun` 三档。
- [Sandbox 生命周期](../sandbox/lifecycle.md) —— 记忆库与 checkpoint 怎样在物理 Sandbox 边界恢复与回存。
- [计分粒度](../assertions/library/score-points.md) —— 对比里一个 eval 记几分:通过制(`defineEval`,一题一分,读通过率)与计分制(`defineScoreEval`,题内叠加挣分,读 earned score)；混合时两种读数各算各的。
- [计分粒度的 Experiments 边界](score-points.md) —— Experiment 不复制评分语义，只保留选择与运行边界。
- [Architecture](architecture.md) —— 实体、配置求值、生命周期、跨 Invocation 协调与完成状态。
- [设计参照](../../research/experiments/README.md) —— agent-eval 等外部方案带来了什么、哪些边界没有跟随。
- [CLI](cli.md) —— `niceeval exp` 命令。
- [Authoring](../eval/README.md) —— eval 怎么写(experiment 跑的就是它们)。
- [Observability](../../observability.md) —— 跨 agent 的质量×成本对比与 `niceeval view`。
- [Runner](../../runner.md) —— 矩阵展开、并发、首过即停、预算的调度。
