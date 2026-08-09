# 原生 LLM Judge Runtime —— 架构

Judge Runtime 位于 Assertion collector 与模型 Provider 之间。
它把作者的 Check 编译成规范化图，再把图的最终 Decision 形成一条 Assertion Claim；Verdict collector 再形成
Verdict Claim，三者都不改变 Attempt 的 `active` / `completed` / `abandoned` lifecycle。

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
  ├─ append judge Observations and Judge Claim
  └─ emit one Assertion Claim
```

profile 与模态要求在 discovery 时已知。
图在 `t.judge.llm` 注册 Assertion 时编译，之后拓扑不可改变。
材料值可以依赖 Turn 或 Sandbox 终态，因此只在 Assertion 求值前读取。

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

`score` 必须是有限的 `0..1` 数。
`rationale` 是面向复核者的简短判断依据，不要求也不保存模型的私有推理过程。

每条 citation 必须指向本请求的一份材料和有效 part。
文字 quote 必须能在对应文本中定位；图片 region 使用 `0..1` 的归一化坐标；音频时间不得超出材料时长。
无引用时写空数组，不能伪造一个材料 id。

Provider 原始返回先变成 `JudgeProviderResponse`，再由 Runtime 校验 Decision。
缺字段、非法分数、未知 citation 或超界位置都是响应协议失败，不会被修补成 0 分。

## Prompt 编译

NiceEval 拥有 rubric prompt compiler。
同一 compiler 版本固定以下内容：

- candidate、reference、context 与 instruction 的语义。
- `0`、`0.5`、`1` 的共同评分参照点。
- 对材料内指令的隔离要求。
- Decision JSON schema 与 citation 规则。
- 简短 rationale 的长度上限。

内置配方只贡献 rubric、输入槽和图，不复制整套 system prompt。
prompt compiler 版本进入算法身份；改变评分参照点或输出解释必须改变该版本。

Provider 可以把规范请求映射到 Responses、Chat Completions、Messages 或其它模型协议。
Provider 不能重写 rubric、调换材料角色或私自改变评分范围。

## 材料读取与多模态

材料读取器把 scope、项目文件、Sandbox 文件和内联文件读取成内容寻址 part。
读取按以下顺序进行：

1. 读取字节，并校验大小上限。
2. 根据声明、扩展名和内容确定 MIME；冲突时报作者错误。
3. 文本按 UTF-8 解码并保留 media type；二进制计算 SHA-256。
4. 生成材料清单，并把尚无稳定 Record 出处的字节写入由 provenance / Observation 强引用的 typed evidence object。
5. 汇总实际模态，与 Eval 的 `judge.llm.uses` 和 Provider capabilities 对照。

Runtime 不做隐式 OCR、语音转录、图片描述或 PDF 文本抽取。
这些操作会改变评估语义，必须由显式图节点或用户准备步骤完成。

同一份 blob 在一个 Attempt 内只保存一次。
HTTP URL 不直接进入 Provider，避免远端内容在重新执行时漂移，也避免 Provider 获得未声明的网络读取权限。

## 图模型

Judge Graph 是带稳定 id 的有限 DAG。
边由节点输入引用产生，返回节点是唯一公开结果。

```ts
type JudgeNode = ModelNode | AggregateNode | FallbackNode;

interface JudgeGraphDefinition {
  recipe: { id: string; version: number };
  inputs: Record<string, JudgeInputSlot>;
  nodes: JudgeNode[];
  outputNodeId: string;
}
```

definition 阶段拒绝重复 id、未知依赖、环、空图、不可到达的返回节点和错误输出类型。
节点数组顺序不决定执行顺序；拓扑关系决定 readiness，节点 id 决定稳定登记顺序。

### 节点结果

```ts
type JudgeNodeResult =
  | { status: "completed"; decision: JudgeDecision }
  | { status: "unavailable"; reason: JudgeUnavailableReason; detail?: string }
  | { status: "skipped"; because: string };
```

这些是 Judge Graph node 的执行状态，不是 Attempt lifecycle 或 Verdict Claim token。

得分为 0 的模型判断仍是 `completed`。
网络、能力和响应协议问题是 `unavailable`；没有被选择的 fallback 分支是 `skipped`。

普通 `aggregate` 的必需依赖 unavailable 时，该节点同样 unavailable。
`fallback` 是唯一能消费 unavailable 并继续成功的内置节点。
secondary 是惰性分支，只有 primary unavailable 时才进入调度；primary completed 时记为 skipped。
fallback 只处理声明的可用性失败，不会吞掉配方 bug、非法图或用户取消。

`weightedMean` 要求每个 weight 是正有限数，score 是 `Σ(score × weight) / Σ(weight)`。
它的 citations 是子节点引用按材料位置去重后的并集，rationale 是节点 id、分数与权重的有界明细。

`minimum` 与 `maximum` 选择对应 score 的完整 Decision。
并列时按节点 id 排序取第一项；节点登记保留全部输入，避免报告把未选项误写成未执行。

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
结构化输出读取失败允许重试一次，但仍计入 `maxAttempts` 与图总预算。

退避优先使用 `Retry-After`，否则使用指数全抖动。
每次物理请求的状态、服务端 code、延迟和原始 usage 都追加为 judge Observation；凭据、完整响应 header 和敏感 body
不落盘。重试策略、规范化 Decision 与诊断由引用这些 Observation 的 Judge Claim 表达，不另造 `retryAttempts` 结果真源。

## Assertion 映射

一张图只产生一条 Assertion Claim。
最终节点 completed 时，`decision.score` 交给 Assertion collector：

- 没有阈值的 soft Judge 登记 score，并得到 `outcome: "passed"`。
- `.atLeast(x)` 与 `.gate(x)` 使用既有阈值规则得到 passed 或 failed。
- `.points(n)` 使用 `n × score` 计算实得分。

最终节点 unavailable 时，Assertion Claim 使用 `outcome: "unavailable"`。
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
`executionId` 是 provenance、Observation 和 Claim 之间的 correlation；报告只在固定 GraphRef 上通过 Projector 读取相关
evidence，不从 `detail` 或 `evidence` 反推身份，也不读取私有结果文件。
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
profile、凭据或预检失败发生在派发前，形成带 `judge-precheck-failed` reason 的 Run-scoped structured execution-error Observation。
它还形成 precheck Claim，不创建 Attempt 或 judge stream；RunReceipt 如实表达没有派发的成员。

## Record

LLM Judge 不写 `judge.json`、`result.json` 或 Attempt 私有 blob 路径，也不把节点结果写入 AttemptPayloadV1。
每条 Assertion evaluation 使用一个 execution correlation；它的配方、profile 身份、材料摘要与图结构属于 provenance，
并由 Attempt 的 provenance ref 指向。

每个物理模型请求、节点开始/结束、fallback 选择、重试、原始 usage、规范化响应摘要与结构化执行错误都追加到带该
correlation 的 judge Observation stream。Provider 的完整原始响应、敏感 body 与凭据不落盘；可以保存经边界裁剪、脱敏的
Observation 摘要。节点的 `completed` / `unavailable` / `skipped` 仍只是图节点状态。

最终 Decision 形成 Judge Claim，引用它消费的材料与节点 Observation；Assertion collector 再形成一条 Assertion Claim。
两类 Claim 的 `basedOn` 是 typed EvidenceTarget，不能用一个 `executionId` 或人读摘要代替证据。缺材料、调用失败或超时
先形成结构化 execution-error Observation，再支持 `outcome: "unavailable"` 的 Assertion Claim；Verdict collector
按既有规则形成 Verdict Claim。

二进制材料作为内容寻址的 typed evidence object 保存，并由 provenance 或 Observation 写 strong reference；已在 Record 中
有权威出处的文本只保存 evidence ref、hash 与有界预览，不复制整份内容。`retention: "digest"` 只保存原内容 hash、
大小、MIME 与脱敏预览，并明确内容不可从该 GraphRef 复原。

show 的默认 Assertion 行仍只显示名称、score、阈值与 unavailable 摘要。
`show @locator --judge` 和 view 的 Judge Projection 在固定 GraphRef 上展示配方、profile、材料、节点 Observation、
Judge Claim、理由、引用、重试与 usage；它们不是 Record 内的第二份 report artifact。

## 身份与携带

以下内容进入 LLM Judge 算法身份：

- 配方 id、版本与规范化图结构。
- prompt compiler 与 Decision schema 版本。
- Provider id、identity、模型和会改变采样的 profile 字段。
- 材料读取算法与 MIME 规则版本。

rubric、配方源码和输入绑定属于 Eval 源码或数据身份。
凭据值、临时 request id、运行耗时和模型输出不进入身份。

任何 Judge 身份变化都使依赖它的 Attempt 不可携带。
可携带时，新的 RunContribution 明确采用原 Attempt revision，连同该 revision 的 provenance、Observation 与 Claim 读取；
不复制、不重挂也不新建 locator。
只配置未被 Eval 声明使用的 profile，不改变该 Eval 的配置身份。

## 架构不变量

- core 不依赖 scorer 供应商来定义公开 API、prompt 或结果类型。
- 同一模型响应不能同时被解释成分数和 unavailable。
- 0 分是有效 Decision，缺证据没有数值分数。
- Provider 不能看到未读取 URL，也不能把不支持的模态静默转成文本。
- 图内模型调用都经过同一个 scheduler、预算、重试和 Record 管道。
- 一个 `t.judge.llm` 调用恰好对应一条 Assertion Claim；实际执行时有一个仅作 correlation 的 judge Observation stream。
- 报告展示的 score、模型、理由和引用都能追溯到同一个 `executionId`。
