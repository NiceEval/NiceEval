# Judge Material —— Architecture

Judge Material 把可复用的执行事实、当前评分定义的私有输入和一次 evaluator 求值分成不同 owner。Material View 只是绑定句柄，不把任意 Record blob 暴露成公共 API。

## 实体与 owner

```text
Execution graph                         Grading definition
  └─ sealed semantic source refs          └─ current private inputs
                  │                              │
                  └──────────┬───────────────────┘
                             ▼
                    Judge Check declaration
                             │
                             ▼
                 MaterialBindingManifest
                             │
                             ▼
                       JudgeEvaluation
                 ┌───────────┼────────────┐
                 │           │            │
             presented  investigation  Decision
                             │
                             ▼
                       GradingClaim
                  AssertionResult + projection
```

| 实体 | owner | 内容 |
|---|---|---|
| Execution graph | 一次 Agent execution | Session/Turn input 与 reply、Action occurrence/result、显式快照的 custom text/file |
| Grading definition source | 当前 GradingDefinition | rubric、anchors、reference text/file、definition custom text |
| MaterialBindingManifest | 一次 Judge Check 求值 | slot 声明、已定位 source、实际 presentation 与授权能力 |
| JudgeEvaluation | 一次 evaluator occurrence | manifest、LLM presentation 或 Agent investigation closure、Decision |
| GradingClaim | 一次评分投影 | subject/check identity、AssertionResult、threshold/score/control policy |

Execution source ref 只在所属 Execution graph 内有语义。新的 Grading 可以重新选择和绑定已经封口的 source，但不能从 Attachment/blob 猜 ref，也不能恢复当时未采集的 bytes。

## MaterialBindingManifest

Manifest 是一次 Check 的 canonical 可见性清单。以下形状穷尽它的语义字段；持久格式可以规范化字段名，但不能合并这些事实。

```ts
type CoverageState = "complete" | "partial" | "unavailable";

interface BindingCoverage {
  readonly sourceCollection: CoverageState;
  readonly selectorResolution: CoverageState;
  readonly materialization: CoverageState;
}

type MaterialUnavailableReason =
  | "source-unavailable"
  | "source-collection-incomplete"
  | "selector-cardinality-mismatch"
  | "selector-universe-incomplete"
  | "result-unisolatable"
  | "materialization-incomplete"
  | "redaction-changed-required-material"
  | "truncation-required"
  | "source-budget-exceeded"
  | "total-budget-exceeded";

interface PresentedMaterial {
  readonly sourceRef: SemanticMaterialSourceRef;
  readonly mediaType: string;
  readonly bytes: number;
  readonly visibleDigest: string;
  readonly redacted: boolean;
  readonly truncated: false;
  readonly rendererOrdinal: number;
}

interface MaterialViewBindingManifest {
  readonly viewKind: MaterialViewKind;
  readonly authorOrder: number;
  readonly noncausalAuthorOrder: boolean;
  readonly sourceOwner: "execution" | "grading-definition";
  readonly sourceRole: MaterialSourceRole;
  readonly sourceRefs: readonly SemanticMaterialSourceRef[];
  readonly selector?: {
    readonly schemaVersion: number;
    readonly identity: string;
    readonly expectedCardinality: number;
    readonly resolvedOccurrenceRefs: readonly ActionOccurrenceRef[];
  };
  readonly coverage: BindingCoverage;
  readonly limitation?: MaterialUnavailableReason;
  readonly sourceMaxBytes: number;
  readonly presented?: readonly PresentedMaterial[];
}

interface SlotBindingManifest {
  readonly slotName: string;
  readonly slotRole: string;
  readonly multiplicity: "one" | "many";
  readonly views: readonly MaterialViewBindingManifest[];
}

type JudgeWorkspaceLimitation =
  | "snapshot-incomplete"
  | "file-count-exceeded"
  | "workspace-budget-exceeded"
  | "access-evidence-unavailable";

interface JudgeWorkspaceCapabilityManifest {
  readonly snapshotRef: SemanticWorkspaceSnapshotRef;
  readonly snapshotDigest: string;
  readonly scope: "attempt-workdir";
  readonly fileCount: number;
  readonly bytes: number;
  readonly limitations: readonly JudgeWorkspaceLimitation[];
  readonly toolAllowlist: readonly ManagedJudgeTool[];
  readonly networkAllowlist: readonly string[];
}

interface MaterialBindingManifest {
  readonly schemaVersion: number;
  readonly recipeIdentity: string;
  readonly slotSchemaIdentity: string;
  readonly executionGraphDigest: string;
  readonly evaluatorPrivateInputDigest: string;
  readonly bindings: readonly SlotBindingManifest[];
  readonly maxRenderedBytes: number;
  readonly renderedBytes?: number;
  readonly renderingProtocolVersion: string;
  readonly securityProtocolVersion: string;
  readonly securityConfigDigest: string;
  readonly workspace?: JudgeWorkspaceCapabilityManifest;
  readonly digest: string;
}
```

`presented` 和 `renderedBytes` 只有 evaluator 已启动并收到材料时才存在；预检失败或 required slot 不可用时不能写空 presentation。Manifest 不保存 human label、title、绝对路径、secret、raw secret digest、provider credential 或模型响应。

`workspace` 只属于 Agent Judge invocation，持久化 sealed snapshot ref/digest、授权 scope、file count、bytes、limitations、受管 tool allowlist 与 network allowlist。Workspace 不是 Material slot；完整授权范围代表“可能可见”，不冒充实际 read set。

## 绑定、coverage 与顺序

绑定依次经过三层：

1. `sourceCollection` 证明所需 Turn、Action universe 与 result bytes 是否完整封口。
2. `selectorResolution` 在完整 universe 上执行 selector，并验证精确 cardinality。
3. `materialization` 执行读取、MIME 校验、安全处理、预算与 renderer 转换。

任一 required slot 为 partial 或 unavailable 时，不启动 evaluator；该 Assertion 以具体 unavailable reason 交付。Redaction 改变 required bytes、需要截断、选择为零、选中数量不符、Action universe 不完整或 Adapter 不能把某次 result 从混合 transcript 中隔离，都不能回退成更宽材料，也不能当作 measurement `0`。

同一 Turn 的 View 保留事件位置；同一 Session 的多 Turn 保留 Session-local ordinal。跨 Session 没有共同因果全序，manifest 分别保存 per-session sequence；作者把多个 View 放入 `many` slot 的顺序标记为 `noncausalAuthorOrder`。V1 不读取 wall-clock 顺序推导因果关系。

## 安全、预算与呈现

Renderer 把材料编码成版本化 untrusted block 或受管 file；rubric、Decision protocol、系统消息和 tool permission 走独立可信 channel。材料文字即使声称“忽略 rubric”也不能改变 channel 或 capability。

Redaction 只使用已知 credential registry、显式 secret input 与结构化 sensitive field，不做通用秘密猜测。先 redaction，再计算 evaluator 可见 bytes 和 `visibleDigest`；系统不保存 raw secret、raw-secret digest 或可逆 preview。

每个 slot 有 source byte 上限，每个 recipe 有 rendered total 上限。预算在 provider 或 Agent 启动前检查，不做静默裁剪。Token、cost 与 timeout 属于 runtime profile；显式 cost cap 无法保守估算时，不发送请求。

构造器的 `name`、Assertion label 和展示 title 都不进入 evaluator presentation，所以不进入 Judge Evaluation identity。Renderer 只使用 recipe slot identity 与 ordinal 生成稳定 heading/path。任何未来可见的 heading、filename 或 label 都必须进入 `PresentedMaterial.visibleDigest` 和复用身份。

## 四层审计

读面使用下面四组词，不声称“模型实际看见”：

- 声明：recipe slot、View、selector 与 workspace 请求。
- 已定位：source refs、selector cardinality 与三层 coverage。
- 已交付：发送给 LLM 的 blocks，或授权给 Agent 的 workspace/material files。
- 调查：Agent Judge 的受管命令、tool result 与 evidence refs。

Evaluator 未启动时只显示声明、已定位事实与 unavailable reason，不显示已交付材料或调查项。没有独立可信 workspace-access producer 时，read set 为 unavailable；workspace authorization 仍完整显示可能可见的范围。

## Identity 与复用

`evaluatorPrivateInputDigest` 只纳入 rubric、anchors、Decision protocol、definition reference/custom bytes 与受管 loader identity。GradingDefinition version、evaluation kind、threshold、score contribution、control 与 label 都不进入这个摘要。

Judge Evaluation reuse identity 包含 recipe/control identity、manifest digest、runtime kind、provider/model 或 Agent identity/version。它还包含 rendering/security/runtime profile、workspace/tool/network capability digest，以及 batch composition 与 batch-safe recipe identity。

相同 reuse identity 只表示可以沿用，不表示随机 evaluator 必然产生同一 Decision。每次执行都有独立 occurrence ID。

Grading Claim identity 另含 GradingDefinition identity/version、精确 execution subject ref、Check declaration/source identity 与 Judge Evaluation ID。Evaluation kind、threshold、score contribution 与 control policy 也属于 Claim identity。

只改 projection policy 时创建新 Claim 并复用旧 Evaluation。Material、reference、rubric、runtime/security 或 batch 改变时必须运行新 Evaluation。

若另有纳入整个 GradingDefinition 的 digest，它只能进入 Claim identity，不能进入 manifest 或 Judge Evaluation reuse identity。`--force` 在同一 eligibility identity 下创建新的 Evaluation occurrence 和 Claim，并保存 forced provenance。

## Judge Evaluation

Judge Evaluation 是不可变终态联合。未启动 evaluator 的求值也有 Evaluation occurrence，用来交付 manifest 和 unavailable reason；它没有 presented 或 investigation closure。

```ts
interface JudgeEvaluationReuseIdentity {
  readonly recipeControlIdentity: string;
  readonly materialManifestDigest: string;
  readonly runtimeIdentity: string;
  readonly renderingProtocolVersion: string;
  readonly securityProfileDigest: string;
  readonly runtimeProfileDigest: string;
  readonly capabilityDigest?: string;
  readonly batchIdentity?: string;
}

type JudgeEvidenceRef = PresentedMaterialRef | InvestigationItemRef;

interface JudgeDecision {
  readonly measurement: number;
  readonly rationale: string;
  readonly evidenceRefs: readonly JudgeEvidenceRef[];
}

type JudgeEvaluationOutcome =
  | { readonly status: "decided"; readonly decision: JudgeDecision }
  | { readonly status: "unavailable"; readonly reason: MaterialUnavailableReason | RuntimeUnavailableReason }
  | { readonly status: "errored"; readonly error: JudgeEvaluationError };

interface JudgeEvaluation {
  readonly id: JudgeEvaluationRef;
  readonly occurrenceId: string;
  readonly reuseIdentity: JudgeEvaluationReuseIdentity;
  readonly material: MaterialBindingManifest;
  readonly investigationItems: readonly InvestigationItemRef[];
  readonly outcome: JudgeEvaluationOutcome;
  readonly forced: boolean;
}
```

`measurement` 必须是有限 `[0,1]`。Rationale 是可公开文本，不保存隐藏思维链。Evidence ref 只能指当前 manifest 的已交付 source 或当前 Evaluation 的 investigation item；其它 owner、digest 或 occurrence 的引用使 Evaluation errored。
