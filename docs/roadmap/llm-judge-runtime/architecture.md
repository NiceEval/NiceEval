# 原生 LLM Judge Runtime —— 架构

Judge Runtime 位于 Assertion collector 与模型 Provider 之间。
它把作者的 Check 编译成规范化图，再把图的最终 Decision 投影为一条 AssertionResult。

## 编译与执行时序

```text
Eval discovery
  ├─ validate judge.llm.uses
  └─ resolve used profiles
          │
Run planning
  ├─ validate provider capabilities
  └─ precheck each used profile once
          │
Attempt test
  └─ register assertion + compile recipe graph
          │
Attempt finalize
  ├─ resolve and snapshot materials
  ├─ schedule graph nodes
  ├─ validate final Decision
  ├─ append judge artifact records
  └─ emit one AssertionResult
```

profile 与模态要求在 discovery 时已知。
图在 `t.judge.llm` 注册 Assertion 时编译，之后拓扑不可改变。
scope 与 file 材料可以依赖 Turn 或 Sandbox 终态，因此只在 Assertion 求值前取得。
`material.json` 是例外：它在构造调用点取得 canonical snapshot，后续阶段只复用该值。

预检按“Run × 已使用 profile”去重。
它验证凭据、端点、模型存在性和已声明模态，不发送真实 rubric 或材料。
预检失败只作废声明依赖该 profile 的 Eval × Experiment pair。

## 规范模型请求

Recipe 不生成某家 SDK 的 message 对象。
模型节点先编译成唯一的规范请求：

```ts
interface JudgeModelRequest {
  requestId: string;
  recipe: { id: string; version: number };
  nodeId: string;
  rubric: string;
  materials: ResolvedJudgeMaterial[];
  response: {
    schema: "niceeval.judge-decision";
    schemaVersion: 1;
    scoreMode: "continuous" | "binary";
  };
  model: string;
  signal: AbortSignal;
}

interface ResolvedJudgeMaterial {
  id: string;
  role: "candidate" | "reference" | "context" | "instruction";
  label?: string;
  parts: JudgeContentPart[];
  sha256: string;
}
```

材料与 rubric 在请求中保持分离。
Provider 必须把材料标为不可信内容，不能把材料文本拼进 system instruction 后再交回 Runtime。

`instruction` role 只表示题目提供的任务说明，不获得 system 权限。
这条命名使报告能区分材料用途，但不能绕过 prompt injection 边界。

## 统一 Decision

所有模型节点和最终节点都使用同一形状：

```ts
interface JudgeDecision {
  score: number;
  rationale: string;
  citations: JudgeCitation[];
  labels?: string[];
}

interface JudgeCitation {
  materialId: string;
  part: number;
  quote?: string;
  region?: { x: number; y: number; width: number; height: number };
  startMs?: number;
  endMs?: number;
}
```

`continuous` 请求的 `score` 必须是有限的 `0..1` 数。
`binary` 请求的 response schema 把 `score` 限为 `0 | 1`，Runtime 在 Provider 返回后再次执行同一校验。
`rationale` 是面向复核者的简短结论依据，不要求也不保存模型的私有推理过程。

每条 citation 必须指向本请求的一份材料和有效 part。
文字 quote 必须能在对应文本中定位；图片 region 使用 `0..1` 的归一化坐标；音频时间不得超出材料时长。
无引用时写空数组，不能伪造一个材料 id。

Provider 原始返回先变成 `JudgeProviderResponse`，再由 Runtime 校验 Decision。
缺字段、非法分数、未知 citation 或超界位置都是响应协议失败，不会被修补成 0 分。
binary 请求合法返回 `score: 0.7` 时同样是 `judge-response-invalid`，不会四舍五入，也不会留下 70% 的 points。

## Prompt 编译

NiceEval 拥有 rubric prompt compiler。
同一 compiler 版本固定以下内容：

- candidate、reference、context 与 instruction 的语义。
- continuous 模式中 `0`、`0.5`、`1` 的共同评分锚点。
- binary 模式中 Y/N 语义和只允许 `0 | 1` 的 response schema。
- 对材料内指令的隔离要求。
- Decision JSON schema 与 citation 规则。
- 简短 rationale 的长度上限。

内置配方只贡献 rubric、输入槽和图，不复制整套 system prompt。
prompt compiler 版本进入算法身份；改变评分锚点或输出解释必须改变该版本。

Provider 可以把规范请求映射到 Responses、Chat Completions、Messages 或其它模型协议。
Provider 不能重写 rubric、调换材料角色或私自改变评分范围。

## 材料规范化与多模态

材料规范化器把 scope、JSON snapshot、项目文件、Sandbox 文件和内联文件变成内容寻址 part。
file 与 scope 材料按以下顺序处理：

1. 读取字节，并校验大小上限。
2. 根据声明、扩展名和内容确定 MIME；冲突时报作者错误。
3. 文本按 UTF-8 解码并保留 media type；二进制计算 SHA-256。
4. 生成材料清单，并把尚无稳定 Record 来源的字节写入 attempt blob 存储。
5. 汇总实际模态，与 Eval 的 `judge.llm.uses` 和 Provider capabilities 对照。

`material.json` 在构造调用时先用 own property descriptor 校验整棵值，再按 RFC 8785 JCS 生成 immutable canonical UTF-8 bytes。
它不调用 getter、`toJSON` 或 prototype；非法值、cycle 与超出材料大小预算在调用点报 author error。
同一 snapshot 在注册、求值、hash 与保存阶段复用，调用者之后的 mutation 不会改变 Judge 输入。
JSON snapshot 生成单个 `application/json` text part，不引入新 modality。

Runtime 不做隐式 OCR、语音转录、图片描述或 PDF 文本抽取。
这些操作会改变评估语义，必须由显式图节点或用户准备步骤完成。

同一份 blob 在一个 Attempt 内只保存一次。
HTTP URL 不直接进入 Provider，避免远端内容在重放时漂移，也避免 Provider 获得未声明的网络读取权限。

## 图模型

Judge Graph 是带稳定 id 的有限 DAG。
边由节点输入引用产生，返回节点是唯一公开结果。

```ts
type JudgeNode = ModelNode | AggregateNode | FallbackNode;

interface JudgeGraphDefinition {
  recipe: { id: string; version: number };
  scoreMode: "continuous" | "binary";
  inputs: Record<string, JudgeInputSlot>;
  nodes: JudgeNode[];
  outputNodeId: string;
}
```

definition 阶段拒绝重复 id、未知依赖、环、空图、不可到达的返回节点和错误输出类型。
节点数组顺序不决定执行顺序；拓扑关系决定 readiness，节点 id 决定稳定记录顺序。

### 节点结果

```ts
type JudgeNodeResult =
  | { status: "completed"; decision: JudgeDecision }
  | { status: "unavailable"; reason: JudgeUnavailableReason; detail?: string }
  | { status: "skipped"; because: string };
```

得分为 0 的模型结论仍是 `completed`。
网络、能力和响应协议问题是 `unavailable`；没有被选择的 fallback 分支是 `skipped`。

普通 `aggregate` 的必需依赖 unavailable 时，该节点同样 unavailable。
`fallback` 是唯一能消费 unavailable 并继续成功的内置节点。
secondary 是惰性分支，只有 primary unavailable 时才进入调度；primary completed 时记为 skipped。
fallback 只处理声明的可用性失败，不会吞掉配方 bug、非法图或用户取消。

`weightedMean` 要求每个 weight 是正有限数，score 是 `Σ(score × weight) / Σ(weight)`。
它的 citations 是子节点引用按材料位置去重后的并集，rationale 是节点 id、分数与权重的有界明细。

binary graph 不接受 `weightedMean`，因为两个二元 Decision 的加权平均可能产生连续分数。
`minimum`、`maximum` 与 `fallback` 保持二元域，因此可用于 binary graph；编译器同时验证最终节点只能产生 `0 | 1`。

`minimum` 与 `maximum` 选择对应 score 的完整 Decision。
并列时按节点 id 排序取第一项；节点记录保留全部输入，避免报告把未选项误写成未执行。

### 调度

所有 ready 节点进入 Runtime scheduler。
确定性节点在当前进程执行；模型节点按 profile 的 `maxConcurrency` 取得租约。

同一图中的独立模型节点允许并行，但默认 profile 并发为 `1`。
多个 Attempt 和多个图共用 profile 级限制，因此图并行不会绕过网关限流。

`requestTimeoutMs` 限制一次物理请求。
`graphTimeoutMs` 限制整张图的请求、退避和确定性节点总时长。
用户取消优先于两个预算，并传播到所有在飞 Provider 请求。

## 重试

Runtime 拥有重试策略，Provider 关闭隐式重试。
一次模型节点最多执行 profile 的 `maxAttempts` 次物理请求。

408、429、连接错误和 5xx 可以重试。
鉴权失败、未知模型、不支持的模态、非法请求和用户取消不重试。
结构化输出解析失败允许重试一次，但仍计入 `maxAttempts` 与图总预算。
binary 请求返回 `score: 0.7` 属于同一类响应协议失败；重试耗尽后节点 unavailable，原因是 `judge-response-invalid`。

退避优先使用 `Retry-After`，否则使用指数全抖动。
每次尝试的状态、服务端 code、延迟和用量进入节点记录；凭据、完整响应 header 和敏感 body 不落盘。

## Assertion 映射

一张图只产生一条 AssertionResult。
最终节点 completed 时，`decision.score` 交给 Assertion collector：

- 没有阈值的 soft Judge 记录 score，并得到 `outcome: "passed"`。
- `.atLeast(x)` 与 `.gate(x)` 使用既有阈值规则得到 passed 或 failed。
- `.points(n)` 使用 `n × score` 计算实得分。

上述乘法不会替 gate 做二元化。
例如 continuous Judge 返回 `0.7`，配置 `.points(2).gate()` 时 assertion failed，但仍获得 `1.4` 分；这是 continuous 模式的明确语义。
需要 Y/N 端点的 eval 必须选 binary mode。

binary Provider 返回 `0.7` 时没有合法 Decision。
重试耗尽后 AssertionResult 是 unavailable，没有 `score`，该项获得 0 分；非 optional assertion 继续按既有 unavailable 规则使 Attempt errored。

最终节点 unavailable 时，AssertionResult 使用 `outcome: "unavailable"`。
`reason` 取稳定的 Judge 原因码，`evidence` 只放有界诊断摘要。
`.optional()` 与 Verdict 的传播规则保持不变。

LLM Judge 成功形成 Decision 时增加 evaluator 引用：

```ts
interface LlmAssertionEvaluatorRef {
  kind: "llm";
  executionId: string;
}

interface AssertionBase {
  evaluator?: LlmAssertionEvaluatorRef | AgentAssertionEvaluatorRef;
}
```

普通 Assertion 不带 `evaluator`。
报告通过 `executionId` 读取完整节点记录，不从 `detail` 或 `evidence` 反解析身份。
`kind: "agent"` 的分支由 Agent-as-Judge 定义，本主题不改变其 execution。

## unavailable 原因

稳定原因码是穷尽联合：

```ts
type JudgeUnavailableReason =
  | "judge-capability-unavailable"
  | "judge-material-unavailable"
  | "judge-call-failed"
  | "judge-response-invalid"
  | "judge-graph-timeout"
  | "judge-dependency-unavailable";
```

配方定义错误、未声明 profile、实际模态超出 `judge.llm.uses` 与确定性节点抛错是作者错误。
它们进入 Eval 错误反馈，不伪装成模型证据 unavailable。
profile、凭据或预检失败发生在派发前，使用 `judge-precheck-failed` Attempt 错误，不创建 Judge execution。

## Record

每个 Attempt 的 LLM Judge 记录写入 `judge.json`：

```ts
interface JudgeArtifact {
  version: 1;
  executions: LlmJudgeExecution[];
}

interface LlmJudgeExecution {
  id: string;
  assertionSourceOrder: number;
  recipe: {
    id: string;
    version: number;
    graphHash: string;
    scoreMode: "continuous" | "binary";
  };
  profiles: Record<string, { providerId: string; identity: JsonValue; model: string }>;
  materials: JudgeMaterialRecord[];
  nodes: JudgeNodeRecord[];
  output: JudgeNodeResult;
  usage?: Usage;
}
```

节点按稳定 id 排列，记录依赖、状态、耗时、物理尝试、Decision 与实际模型。
Provider 的原始完整响应不落盘；有界服务端摘要可进入失败 attempt。

二进制材料写在 attempt 的 `blobs/<sha256>`。
`JudgeMaterialRecord` 保存 role、media type、字节数、SHA-256、来源引用与 blob 相对路径。
已经存在于权威 Record artifact 的文本只保存来源引用、hash 和有界预览，不复制整份内容。
`retention: "digest"` 的材料不写 blob；它仍保存原内容 hash，并标明内容不可从 Record 复原。

show 的默认 Assertion 行仍只显示名称、score、阈值与 unavailable 摘要。
`show @locator --judge` 和 view 的 Judge 详情展示配方、profile、材料、节点、理由、引用、重试与用量。

## 身份与携带

以下内容进入 LLM Judge 算法身份：

- 配方 id、版本与规范化图结构。
- score mode、prompt compiler 与 Decision schema 版本。
- Provider id、identity、模型和会改变采样的 profile 字段。
- 材料规范化算法、`json-jcs/rfc8785-v1` 与 MIME 规则版本。

rubric、配方源码和输入绑定属于 Eval 源码或数据身份。
凭据值、临时 request id、运行耗时和模型输出不进入身份。

任何 Judge 身份变化都使依赖它的 Attempt 不可携带。
只配置未被 Eval 声明使用的 profile，不改变该 Eval 的配置身份。

## 架构不变量

- core 不依赖 scorer 供应商来定义公开 API、prompt 或结果类型。
- 同一模型响应不能同时被解释成分数和 unavailable。
- 0 分是有效 Decision，缺证据没有数值分数。
- binary mode 不接受连续分数；Runtime 不通过 rounding 或 threshold 修补响应。
- Provider 不能看到未解析 URL，也不能把不支持的模态静默转成文本。
- 图内模型调用都经过同一个 scheduler、预算、重试和 Record 管道。
- 一个 `t.judge.llm` 调用恰好对应一条 AssertionResult 和一条 LlmJudgeExecution。
- 报告展示的 score、模型、理由和引用都能追溯到同一个 `executionId`。
