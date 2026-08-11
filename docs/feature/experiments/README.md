# Experiments —— 怎么跑这批 eval

一个 eval 描述**测什么**(这轮对话该发生什么、怎么算对)。
一个 **experiment** 描述**怎么跑这批 eval**:用哪些 agent、跑几次、过滤哪些、预算多少。
两者刻意分开。

```
evals/        # 测什么 —— agent 无关,评分逻辑都在各自的 test() 里
experiments/  # 怎么跑 —— 运行矩阵:agent × model × attempts over 选定 evals
```

> 外部方案的参考与取舍单独收在[设计参照](reference/README.md)，不作为目标契约的一部分。

## 为什么要分开

- **eval 不该知道被测的是谁。**
  同一条 memory eval,既要测 claude-code 也要测 codex/bub。
  把 agent 写死进 eval 就废了复用。
- **experiment 是可签入的运行配置。**
  比一串临时 CLI flag 可复现:`niceeval exp compare` 永远跑同一组对照。
- **跨 agent / 跨配置对比是一等公民。**
  每个实验文件声明一个配置；报告只比较 `AnalysisSample` 已经选好的 Run 与 Attempt，不在页面打开时另选结果。

实验文件改名会改变 `experimentId`。需要采用已有 Attempt 时，使用[实验改名与 Run 采用](rename.md)建立 accepted Member，并保存改名上下文。
  目录只组织源码、生成 id 和支持 CLI 前缀选择。

## 与 Record 的边界

`<project>/.niceeval/record/` 是跨 Invocation、Experiment 与 Run 的 [Record](../record/README.md)。
Experiment 只提供运行配置；Runner 在一次 Invocation 中为每个选中的 Experiment 建立一个 Run。

当前 Project Target 与本次 policy 先进入 [execution projector](cache.md)。projector 从 Record 事实得到 `reuse | gap`；planner/scheduler 只执行 gap。局部执行是本次 projection 的结果，Record 不保存“需要补跑”或“当前可复用”。

Run 的 expected membership 定义本次分母。executed、carried 或 accepted Member 把每个 slot 连接到一个 Attempt；Attempt 永远保留实际执行它的 origin Run。
因此 locator 始终由同一个完整 `attemptId` 表达，不会因采用动作而改变。

Invocation 有 `invocationId`，用于关联瞬时进度与最终 receipt。Run 关系由 receipt 的 `runIds` 表达；需要落盘 provenance 时使用可选 Run-owned 通道，不扩张 Run 核心。
一次 Invocation 可以产生零到多个 Run，每个 Run 恰好属于一个 Experiment。

## `defineExperiment` 的形状

```typescript
import { defineExperiment, type JsonValue } from "niceeval";
import type { Agent } from "niceeval/adapter";

interface EvalDescriptor {
  id: string;
  description?: string;
  tags: readonly string[];
  evaluationKind: "pass" | "points";   // 题型:defineEval → "pass",defineScoreEval → "points"
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

`evals` 可以同时选择通过制与计分制 eval。
题型由 `EvalDescriptor.evaluationKind` 给报告：通过制只进入通过率，计分制只进入总分；两者分别聚合、并排展示，不相加。
计分语义见[计分粒度](../assertions/library/score-points.md)。

`judge` 属于运行配置：同一批 eval 可以在两个 Experiment 中只改变裁判模型或端点，得到可签入、可复现、会进入指纹的 judge A/B。它只规定**怎样执行裁判**（model / baseUrl / apiKeyEnv / timeoutMs），不允许 Experiment 定义题目的 rubric、评分材料、severity 或 threshold；这些仍只写在 Eval 的 judge assertion 上。求值链见 [Architecture · 配置求值](architecture.md#配置求值链一次求值处处同源)，完整场景见 [Judge A/B 用例](../judge/use-case/experiment-ab.md)。

`flags` 与 `labels` 的分界是**这个值会不会改变 attempt 里发生的事**。
会改变行为的值，例如联网开关或注入的 skill，写入 `flags`，并由 `ctx.flags` / `t.flags` 使用。

只给报告归类的值，例如「这格用的记忆机制是 mempal」，写入 `labels`。
Agent 与 Eval 看不见它，改它不让已有 Attempt 失去采用资格。
再次运行会以当前 labels 建立新 Run，并通过 carried Member 采用已有 Attempt。

两者都是实验作者写下的**声明**。
运行后才存在的值，例如 `setup` 起出的隧道 URL 或服务端报回的版本，两个袋子都不进；使用 `ctx.fact()` 上报为运行观测。
三个家的判据按场景查[用例手册 · flags / labels / facts 放哪个](use-case/实验值归属/);声明与消费见 [Library · labels](library.md#labels声明归类坐标不进运行时)与[运行时坐标不进配置](library.md#运行时坐标不进配置三个家)。

`maxConcurrency` 是本 Invocation 内的**实验并发限制**:只让该实验的 Attempt 排队,同批其它实验照常按全局并发跑。
它可以表达一次运行内严格串行、严格重试或只维护 N 个可复用 Sandbox，但不会因为另一个终端也选了同一 Experiment 而共享名额。
什么场景配什么值(跨 eval 累积记忆、给撞限额的实验降速、`attempts` + `earlyExit` 的严格重试等),逐例见[用例手册 · 并发怎么配](use-case/并发/);限制的持有期语义单点在 [Runner · 调度](../../runner.md#调度有界并发)。

`sharedState: { key }` 声明该 Experiment 会恢复、修改并回存一份跨 Invocation 共享的可变状态。
Runner 在同一项目的协调域内按 `key` 独占整个状态区间。
区间从 Experiment `setup` 与任何 Sandbox lifecycle `setup()` 之前开始，直到所有 Sandbox `teardown()`、Provider finalizer 与 Experiment `teardown` 完成。
这个字段只提供互斥，不代替 checkpoint 存储、原子提交或强杀恢复。

同一 Experiment 的独立 Sandbox 不共享可变状态时省略它；两个 Experiment 确实指向同一 checkpoint 时使用同一 `key`。
key 是会进入 Run 条目的稳定非密字符串，必须匹配 `[a-z0-9][a-z0-9._/-]{0,127}`；不把 token、账号或其它凭据编进 key。

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
- [计分粒度](../assertions/library/score-points.md) —— 对比里一个 eval 记几分:通过制(`defineEval`,一题一分,读通过率)与计分制(`defineScoreEval`,题内叠加挣分,读总分)；混合时两种读数各算各的。
- [计分粒度的 Experiments 边界](score-points.md) —— Experiment 不复制评分语义，只保留选择与运行边界。
- [Architecture](architecture.md) —— 实体、配置求值、生命周期、跨 Invocation 协调与完成状态。
- [设计参照](reference/README.md) —— agent-eval 等外部方案带来了什么、哪些边界没有跟随。
- [CLI](cli.md) —— `niceeval exp` 命令。
- [Authoring](../eval/README.md) —— eval 怎么写(experiment 跑的就是它们)。
- [Observability](../../observability.md) —— 跨 agent 的质量×成本对比与 `niceeval view`。
- [Runner](../../runner.md) —— 矩阵展开、并发、首过即停、预算的调度。
