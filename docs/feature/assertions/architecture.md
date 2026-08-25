# Assertions —— 架构

`niceeval.assertions` 是一个 Attempt-owned、auditable、non-executable 的 `RecordAttachment`。它的 envelope 当前为 `schemaVersion: 3`，保存已经结束的检查事实；解释它不需要作者调用图、matcher 或 evaluator 内部实现。

它是 [Record architecture](../record/architecture.md) 定义的九个固定 durable family 之一。Record protocol 不提供第三方 family、字段 writer 或 schema registry：第三方只能在 Assertions entry 内提供可解释的 criterion schema。Verdict、earned score 和 Assertion source-site 视图都从 Core、Assertions 与既有固定 family 的 sealed 事实读侧形成，不能各自变成新的持久 family。

## 版本边界

`niceeval.assertions` 的 family identity 不带版本；当前 envelope 的 `schemaVersion` 是 `3`。当前领域类型不带版本后缀；v1／v2／v3 只存在于 package-private wire codec 与相邻 migration identity。普通 reader 只接受 exact-current，普通 writer 只写 v3。

Record maintenance 独占历史 codec、blob closure、文件 I/O、Git restore point、sentinel、atomic physical rewrite 与最终 exact-current 验证。Assertions attachment 提供纯 `1→2` 与 `2→3` payload transform。未来升级必须继续扩展这条相邻链。

```text
author calls / evaluator internals / producer control flow
                    ↓
          producer evaluates and seals
                    ↓
          niceeval.assertions
          ├─ entries: criterion, materials, evaluation, decision,
          │           policy, contribution, explanation retention
          └─ sourceSites: entryId → Sources item join
                    ↓
    Verdict / Score / source navigation DomainView
                    ↓
          closed analysis or report output
```

`sourceSites` 是 Assertions payload 的字段，不是物理 send Navigation Attachment。它只保存已执行 entry 的 source mapping；源码内容仍属于 origin Run-owned Sources family。精确 join 与显示规则见 [Source sites](architecture/source-sites.md)。

matcher 求值不把 source ledger 复制进 Assertions。producer 只保存权威聚合 receipt、决定结果的有界 locator、order query artifact，以及不超过 8 个 representative diagnostics；这些解释进入 payload 前最多 64 个节点与 64 KiB。决定性 witness 即使位于第 10,001 条 source record 也必须保留。

超限时只裁 nondecisive representatives 与逐行 overlay。截断只影响 `explanationRetention`，不改变 criterion、materials、evaluation、decision、policy、contribution、Verdict 或 score。source owner 的 ledger、Assertions 的 evaluation receipt、identity relation 与 overlay retention 是四个独立完整性维度，任何一个都不能替另一个升格。

4 MiB 是 Assertions JSON framing 的上限，不是一次 Assertion 求值可观察材料的上限。超过 32 KiB，或深度、数组项数等 shape 不适合内联的 source / evidence snapshot 自动成为本 Attachment 自己的 blob。若解释合计仍使 framing 超限，producer 只压缩 `explanationRetention`。它不拆出重复 document，也不删除 entry 或语义字段。只有不可裁的语义 framing 自身超限时才拒绝发布。

## Current 外层 payload

writer 产出的 current payload 是 `AssertionsAttachment`。所有契约拥有的 object 都 exact decode；不在下列形状中的字段一律拒绝。`BoundedJsonValue` 是唯一允许任意 JSON key 的值域，只用于 snapshot 或 criterion 的 raw `data`，不是开放 metadata。decoder 限制深度为 8、对象键数为 64、数组项数为 256、单字符串为 8 KiB，且整个 payload 最多 4 MiB。

```ts
type BoundedJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BoundedJsonValue[]
  | { readonly [key: string]: BoundedJsonValue };

type BoundedJsonObject = {
  readonly [key: string]: BoundedJsonValue;
};

type AssertionEntryId = string;

type AssertionDisplay = {
  readonly key?: string;
  readonly label?: string;
  readonly groupPath: readonly string[];
};

type AssertionsAttachment = {
  readonly entries: readonly AssertionEntry[];
  readonly sourceSites: readonly AssertionSourceSite[];
};

type AssertionEntry = {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplay;
  readonly criterion:
    | { readonly state: "available"; readonly value: BuiltInCriterion | ThirdPartyCriterion }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
  readonly materials: {
    readonly source:
      | AssertionMaterial
      | { readonly kind: "unavailable"; readonly reason: "not-recorded" };
    readonly evidence: readonly AssertionMaterial[];
    readonly coverage: AssertionCoverage;
    readonly limitations: readonly AssertionLimitation[];
  };
  readonly evaluation: AssertionEvaluation;
  readonly decision: AssertionDecision;
  readonly policy: AssertionDecisionPolicy;
  readonly contribution: ScoreContribution;
  readonly explanationRetention: ExplanationRetention;
};

type AssertionEvaluation =
  | {
      readonly kind: "ordinary";
      readonly observed: AssertionFactValue;
      readonly receipt?: AssertionCollectionReceipt;
    }
  | {
      readonly kind: "matcher-current";
      readonly observed: AssertionFactValue;
      readonly artifact: MatcherQueryArtifact;
    }
  | {
      readonly kind: "matcher-legacy";
      readonly observed: AssertionFactValue;
      readonly reason: "historical-not-recorded";
      readonly legacyDiagnostic?: AssertionFactValue;
    };

type AssertionEntryOuter = Omit<AssertionEntry, "criterion"> & {
  readonly criterion:
    | { readonly state: "available"; readonly value: BoundedJsonObject }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
};
```

reader 先以 outer shape exact decode：除了 `criterion` 暂时只要求为有界 JSON object 外，其余 document 与 entry 字段已经完整验证。这样 reader 能先确定 entry 边界，再局部解释 criterion，而不会把未知 criterion 当成整个 payload 损坏。

`entryId` 精确匹配 `ae_[a-z0-9]{20}`，只在这份 Attachment 内唯一。`entries` 顺序就是原始声明／展示顺序；它不从 key、label、数组位置、源码或材料推导。一个 document 最多 4,096 个 entry；key、label、groupPath 的每项都是无控制字符、最多 256 code points 的文本，group 深度最多 16。

## Criterion envelope 与内建 criterion

criterion 的 outer envelope 只有两种 exact object。third-party 形态就是精确的 `{ name, schemaId, data }`；它没有额外 discriminator 或自由字段。builtin 形态保留 `id` 和 raw JSON `data`，以便未知的未来 builtin 仍可在单条 entry 内显示 unsupported。

builtin `id`、third-party `name` 与 `schemaId` 都是最多 128 bytes 的 ASCII identifier，不允许控制字符或空值。builtin `id` 的 `/vN` 后缀是 criterion schema version，不是 filesystem path；这些值是 schema 选择 identity，不是作者传入的可执行 evaluator 名。

```ts
type BuiltInCriterionEnvelope = {
  readonly kind: "builtin";
  readonly id: string;
  readonly data: BoundedJsonValue;
};

type ThirdPartyCriterion = {
  readonly name: string;
  readonly schemaId: string;
  readonly data: BoundedJsonValue;
};

type CriterionEnvelope = BuiltInCriterionEnvelope | ThirdPartyCriterion;

type BuiltInCriterion =
  | {
      readonly kind: "builtin";
      readonly id: "value-match/v1";
      readonly data: {
        readonly subject: "explicit-value";
        readonly matcher:
          | { readonly state: "declared"; readonly name: string }
          | { readonly state: "unavailable" };
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "numeric-comparison/v1";
      readonly data: {
        readonly comparator: "less-than" | "at-most" | "greater-than" | "at-least";
        readonly threshold: number;
        readonly subject:
          | { readonly kind: "explicit-value" }
          | {
              readonly kind: "scope-metric";
              readonly metric: "tokens" | "cost";
              readonly scope: "turn" | "session" | "attempt";
              readonly unit: "tokens" | "usd";
            }
          | {
              readonly kind: "collection-cardinality";
              readonly collection: "tool-calls";
              readonly scope: "turn" | "session" | "attempt";
            };
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "scope-status/v1";
      readonly data: {
        readonly scope: "turn" | "session" | "attempt";
        readonly assertion: "succeeded" | "no-failed-actions";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "occurrence/v1";
      readonly data: {
        readonly scope: "turn" | "session" | "attempt";
        readonly occurrence: "tool" | "skill" | "event";
        readonly assertion: "present" | "absent" | "count" | "order";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "judge-measurement/v1";
      readonly data: {
        readonly recipe: "closed-qa" | "factuality" | "summarizes";
        readonly scale: "unit-interval";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "sandbox-result/v1";
      readonly data: BoundedJsonObject;
    }
  | {
      readonly kind: "builtin";
      readonly id: "direct-score/v1";
      readonly data: { readonly source: "author" };
    };
```

这些 data 是可离线解释的闭合类别，不保存 `Match` object、predicate、regex、Judge client、collector 或作者 API 对象。第三方闭包不可序列化时，writer 使用诚实的 declared/unavailable 状态，不伪造 AST。criterion 以外的 materials、evaluation、decision、policy、contribution 与 explanation retention 提供本次检查的唯一审计事实。

`numeric-comparison/v1` 的 `threshold` 必须 finite，并由 matcher 工厂在登记前验证。
显式数值 matcher、Usage 上限包装，以及 `count`／`maxToolCalls` 都进入这个成员、同一个 evaluator 与同一次 entry registration。

`subject` 是 `check` 已经提供的被检查事实描述，不是公开 selector。
scope 包装把实际 receiver scope、metric 与 unit 封口进去。
`count` 在受管 `toolCalls` 上使用 `collection-cardinality`；普通作者 array 使用 `explicit-value`。

`value-match/v1` 没有推断迁移。旧 entry 即使 observed 是 number、matcher 名看似数值比较，或历史上由 `maxToolCalls` 写入，也仍按原 criterion 读取。
Assertions current envelope 保持 `schemaVersion: 3`，不为 collection cardinality 升级到 v4。

### 数值材料与 Usage pricing receipt

数值 evaluator 只接收三态材料。`exact` 是完整有限值；`lower-bound` 是可证明的有限下界；`unavailable` 带有限 reason。producer 不能用零、`null`、缺字段或 observed provider cost 代替 unavailable。

```ts
type NumericFactMaterial =
  | { readonly state: "exact"; readonly value: number }
  | {
      readonly state: "lower-bound";
      readonly value: number;
    }
  | {
      readonly state: "unavailable";
      readonly reason:
        | "usage-not-recorded"
        | "usage-input-invalid"
        | "non-finite-number"
        | "model-not-recorded"
        | "price-source-not-found"
        | "pricing-input-invalid"
        | "source-unavailable";
    };

type PricingChargeReceipt = {
  readonly bucket: "input" | "output" | "cache-read" | "cache-write";
  readonly tokens: number;
  readonly rateUSDPerMTok: number;
  readonly amountUSD: number;
};

type PricingEstimateReceipt = {
  readonly kind: "pricing-estimate";
  readonly model: string;
  readonly priceSource: {
    readonly kind: "configured-override" | "builtin";
    readonly selector: string;
  };
  readonly charges: readonly PricingChargeReceipt[];
  readonly amountUSD: number;
};
```

`NumericFactMaterial.value` 必须 finite；显式 value 可以是负数。Usage 的 exact／lower-bound value、charge 的数值和 `amountUSD` 都必须 finite 且不小于零，token 数还是 safe integer。number candidate 是 `NaN` 或正负 `Infinity` 时使用 `unavailable/non-finite-number`，不能把它写成 exact、作者错误或 mismatch。非 number candidate 可在调用边界作为作者错误拒绝。

pricing receipt 最多四个 charge，每个 bucket 最多出现一次，`amountUSD` 等于这些已封口 charge amount 的精确和。producer 保存求值时实际使用的 model、price source kind 与 selector；selector 是选择收据，不是 reader 时重新查价的能力。

`usage-tokens` 只聚合互斥的 input 与 output token 桶，不包含 cache-read、cache-write、reasoning、other 或 requests。`usage-cost-usd` 使用 pricing estimate receipt；它绝不读取 Agent Turns 中 provider／Adapter observed 的 `usage.costUSD`。pricing receipt 作为这条 Assertion 的 source material 保存，不能由 Report 根据当前 rate card 重算。

lower-bound 按区间而不是按 exact number 求值。对 `at-most`，下界严格大于 threshold 才能确定 mismatched；下界小于或等于 threshold 都是 unavailable。`less-than` 在下界大于或等于 threshold 时确定 mismatched；`greater-than` 在下界严格大于 threshold 时确定 matched；`at-least` 在下界大于或等于 threshold 时确定 matched。其余 lower-bound 结果均为 unavailable。

第二层按 identity 处理 criterion：已知 builtin 的 `id` 用相应 exact schema decode；third-party 的 `{ name, schemaId }` 选择已安装的精确 schema，再 decode `data`。未知 builtin `id` 或未安装的第三方 schema 使这条 entry 为 `unsupported`；envelope、known builtin data 或 third-party data 不合法时，这条 entry 为 `invalid`。二者都不重新执行 evaluator。

```ts
type AssertionEntryRead =
  | { readonly state: "available"; readonly entry: AssertionEntry }
  | {
      readonly state: "unsupported";
      readonly entry: AssertionEntryOuter;
      readonly reason: "builtin-unknown" | "third-party-schema-unavailable";
    }
  | {
      readonly state: "invalid";
      readonly entry: AssertionEntryOuter;
      readonly reason: "criterion-envelope-invalid" | "criterion-data-invalid";
    };
```

若 document framing、entry 字段边界、entryId 唯一性、JSON 限额或 own blob closure 无法验证，整个 Assertions family 是 `invalid`。只有已经通过 outer decode 的单条 criterion 问题才使用上面的 entry-local state；一个第三方 criterion 不会拖垮同一 Attempt 的其它 Assertions，也不会改写 Verdict。

## 材料、coverage、limitations 与 diff evidence

current material 只来自有界 snapshot 或本 Assertions Attachment 自己的 blob closure。`RecordBlobRef` 的 owner 与 closure 规则由 [Record architecture](../record/architecture.md#attachment-closure-与读取状态) 定义：只有该 family 的 typed builder 能 mint 它，且一个 ref 只能留在自己的 family 与 owner 内。Assertions 不保存另一个 Attachment 的 `RecordBlobRef`、attachment name、磁盘 path 或可变“最新状态”。

每个 own blob ref 在整个 payload 中恰出现一次，符合 Record 的双向 closure 校验。同一大材料被多个 entry 需要时，producer 为每处 mint 独立 ref／bytes，或改存各自的有界 snapshot；它不能共享一个 ref。

```ts
type AssertionMaterial =
  | {
      readonly kind: "snapshot";
      readonly value: BoundedJsonValue;
    }
  | {
      readonly kind: "blob";
      readonly ref: RecordBlobRef;
      readonly encoding: "utf-8" | "binary";
      readonly byteLength: number;
      readonly sha256: Sha256Digest;
      readonly preview: string;
    };

type AssertionCoverage =
  | { readonly state: "complete" }
  | {
      readonly state: "partial";
      readonly reason: "sampled" | "truncated" | "redacted" | "provider-limited";
    }
  | {
      readonly state: "unavailable";
      readonly reason: "not-collected" | "source-unavailable" | "producer-failed";
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "optional-material" | "unsupported-subject";
    };

type AssertionLimitation =
  | { readonly kind: "redacted"; readonly fieldCount: number }
  | { readonly kind: "sampled"; readonly captured: number; readonly knownTotal?: number }
  | { readonly kind: "truncated"; readonly omittedBytes: number }
  | { readonly kind: "provider-limited" };
```

`byteLength`、`fieldCount`、`captured`、`knownTotal` 与 `omittedBytes` 都是 finite non-negative integers；preview 最多 8 KiB。coverage 是 entry-owned producer 事实，不是 Record envelope 的字段。`complete` 不允许 limitations；`partial` 至少有一个相符 limitation；`unavailable` 与 `not-applicable` 不伪装成空 evidence。snapshot、preview 与 blob bytes 都先经过 secret/redaction policy，不能携带函数、native bytes 或当前 worktree。

Sandbox diff Assertion 仍可保存实际检查过的路径、摘要和 evidence，但不能借用 FileChanges 的 blob ref。完整 file revision
只属于 FileChanges family；该 family 保存按 send 区间排列的端点轨迹，不保存 `net` 或 hunk。需要同时展示 trajectory
与 Assertion 的 consumer 由 Analysis 组合两个已验证的固定 family，而不是建立跨 owner ref。collector 的 partial
前缀不能被 Assertion 或 Report 补成完整事实。

scope Assertion 将 collection 已冻结的 vector cut 归一为 snapshot；它不保留一个可在 reader 时打开的 Session、Turn、Conversation 或其它 Attachment ref。

高基数 collection 不把 candidates、完整 tool occurrences、diff changes、occurrence ID list 或 Judge trace 搬进 payload。它对全量或决定性前缀求值，并保存 O(1) receipt：`examined`、`matched`、`mismatched`、`unavailable`、`knownTotal`、`complete`、`exhaustive` 与 `decisive`。

- absence 只有 complete + exhaustive + matched=0 + unavailable=0 才 matched；找到 witness 可提前 mismatch。
- exact 只有 exhaustive exact count 且 unavailable=0 才 matched；n+1 可提前 exceeded，too few 在不完整输入下 unavailable。
- at-least 达到 n 可提前 matched；未达到 n 只有 exhaustive 且 unavailable=0 才 mismatch。

evaluation/source coverage（语义）、persisted explanation retention（有界）与 display window（有界）是三个独立维度。裁剪 display 或 explanation 不得改变 evaluation、decision、gate、Verdict 或 score。

受管 `toolCalls` 的公开元素是 logical occurrence 投影。
locator、scope identity、cut 与 coverage 由 WeakMap sidecar 绑在整个 collection 对象上。
公开数组与 sidecar matcher rows 同序、同基数。作者不填写 locator。
复制或展开 collection 会丢失 sidecar；`matching` 与 `inOrder` 不得把丢失 sidecar 的 array 当成受管 collection 求值。

Analysis 与 Report 只按 criterion id 与 `evaluation.artifact.kind` 路由。它们不识别包装方法名，也不把私有 snapshot 形状当成路由键。

| 作者入口 | criterion | `occurrence` assertion | evaluation |
|---|---|---|---|
| `count`／`maxToolCalls` | `numeric-comparison/v1` | 无 | ordinary，无 matcher artifact |
| `matching(..., { atLeast: 1 })` 或省略计数的 `calledTool` | `occurrence/v1` | `present` | `collection-filter` |
| `matching(..., exactly(n))` 且 `n≥1`，或更大 `atLeast` | `occurrence/v1` | `count` | `collection-filter` |
| `matching(..., exactly(0))`、`notCalledTool`、`usedNoTools` | `occurrence/v1` | `absent` | `collection-filter` |
| `inOrder`／`toolOrder` | `occurrence/v1` | `order` | `ordered-sequence` |

`count`／`maxToolCalls` 的 `evaluation.kind` 是 `ordinary`。`observed` 是已知长度。不写 collection `receipt`，也不写 matcher artifact。

无法取得可信长度时，numeric 材料为 `unavailable`，reason 为 `source-unavailable`。
可证明前缀但集合不完整时为 `lower-bound`，完整度写在 `materials.coverage`。

## Matcher Filter Debugger 的持久边界

集合过滤与有序序列查询都在 producer 封口时完成。`collection-filter` artifact 保存 collection receipt；`ordered-sequence` artifact 还保存 query steps，以及 witness path 或 `failure frontier`。reader 不重跑 matcher，也不把 final tri-state 与 raw matches array 当成 order artifact。

```ts
type AssertionCollectionReceipt = {
  readonly examined: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly unavailable: number;
  readonly knownTotal?: number;
  readonly complete: boolean;
  readonly exhaustive: boolean;
  readonly decisive: boolean;
};

type MatcherRelationStatus =
  | { readonly state: "exact" }
  | {
      readonly state: "unavailable";
      readonly reason: "historical-not-recorded" | "source-unavailable" | "ambiguous";
    };

type MatcherSourceLocator =
  | {
      readonly kind: "tool-occurrence";
      readonly toolOccurrenceId: string;
      readonly relation: MatcherRelationStatus;
    }
  | {
      readonly kind: "event";
      readonly eventId: string;
      readonly toolOccurrenceId?: string;
      readonly relation: MatcherRelationStatus;
    };

type MatcherOverlayResult =
  | "matched"
  | "mismatched"
  | "unavailable"
  | "not-evaluated";

type MatcherRetainedRow = {
  readonly locator: MatcherSourceLocator;
  readonly result: MatcherOverlayResult;
  readonly difference?: AssertionFactValue;
};

type MatcherQueryStep = {
  readonly step: number;
  readonly summary: AssertionFactValue;
};

type MatcherSourceSnapshot =
  | {
      readonly scope: "turn";
      readonly sessionId: string;
      readonly turnId: string;
      readonly scopeId: string;
      readonly throughSessionSequence: number;
      readonly source: { readonly family: "niceeval.agent-turns"; readonly schemaVersion: number };
      readonly collectionAtCut: "complete" | "partial" | "unavailable";
    }
  | {
      readonly scope: "session";
      readonly sessionId: string;
      readonly scopeId: string;
      readonly throughSessionSequence: number;
      readonly source: { readonly family: "niceeval.agent-turns"; readonly schemaVersion: number };
      readonly collectionAtCut: "complete" | "partial" | "unavailable";
    }
  | {
      readonly scope: "attempt";
      readonly scopeId: string;
      readonly sessions: readonly {
        readonly sessionId: string;
        readonly throughSessionSequence: number;
      }[];
      readonly source: { readonly family: "niceeval.agent-turns"; readonly schemaVersion: number };
      readonly collectionAtCut: "complete" | "partial" | "unavailable";
    };

type OrderStepReceipt = {
  readonly step: number;
  readonly comparisons: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly unavailable: number;
};

type OrderEvaluationReceipt = {
  readonly sourceRows: number;
  readonly comparisons: number;
  readonly unavailableComparisons: number;
  readonly definitePrefixLength: number;
  readonly possiblePrefixLength: number;
  readonly stepReceipts: readonly OrderStepReceipt[];
  readonly complete: boolean;
  readonly exhaustive: boolean;
  readonly decisive: boolean;
};

type MatcherOrderPathNode = {
  readonly step: number;
  readonly locator: MatcherSourceLocator;
  readonly sessionId: string;
  readonly sessionSequence: number;
  readonly result: "matched" | "unavailable";
};

type MatcherFailureFrontier = {
  readonly longestDefinitePrefix: readonly MatcherOrderPathNode[];
  readonly longestPossiblePrefix: readonly MatcherOrderPathNode[];
  readonly firstBlockingStep: number;
  readonly suffixChecked: AssertionCollectionReceipt;
  readonly representatives: readonly MatcherRetainedRow[];
};

type MatcherQueryArtifact =
  | {
      readonly kind: "collection-filter";
      readonly sourceSnapshot: MatcherSourceSnapshot;
      readonly query: MatcherQueryStep;
      readonly receipt: AssertionCollectionReceipt;
      readonly retainedRows: readonly MatcherRetainedRow[];
    }
  | {
      readonly kind: "ordered-sequence";
      readonly sourceSnapshot: Extract<MatcherSourceSnapshot, { readonly scope: "turn" | "session" }>;
      readonly querySteps: readonly [MatcherQueryStep, MatcherQueryStep, ...MatcherQueryStep[]];
      readonly receipt: OrderEvaluationReceipt;
      readonly result:
        | { readonly state: "matched"; readonly witnessPath: readonly MatcherOrderPathNode[] }
        | { readonly state: "mismatched"; readonly failureFrontier: MatcherFailureFrontier }
        | { readonly state: "unavailable"; readonly reason: string };
      readonly retainedRows: readonly MatcherRetainedRow[];
    };
```

`MatcherSourceSnapshot` 是按 scope 封闭的联合，不存在跨 Session 的伪全局 `throughSequence`。Turn 与 Session 使用该 Session 的 inclusive `throughSessionSequence`。Attempt 使用按稳定 `sessionId` 规范化排序的 vector cut。根 `t` 只做 collection filter，不能从 vector 的数组位置创造 `inOrder`、`toolOrder` 或 `eventOrder`。

`witnessPath` 是 per-Session canonical source order 中按 query step 逐项选择的字典序最早 definite path。order 不复用 collection receipt。producer 对每条 source row 倒序更新 definite 与 possible frontier，保证同一 row 不能满足两个 step。

算法可以使用 `O(steps × rows)` 时间，但只能使用 `O(steps + representatives)` 内存，不保存 matrix。query 最多 64 步，representative diagnostics 最多 8 个。

失败只在 source complete、evaluation exhaustive，且 possible frontier 仍无法到达全部 steps 时成立。`failure frontier` 同时保留字典序最早的 longest definite prefix 与 longest possible prefix。possible path 的每个节点明确是 `matched` 或 `unavailable`。

`firstBlockingStep` 紧随 possible prefix。`suffixChecked` 只统计 possible path 末端之后 canonical suffix 上对 blocking matcher 的比较。possible frontier 能到达全部 steps、definite frontier 却不能时，结果是 unavailable，不保存失败边界。这个结构叫 `failure frontier`，不叫 `minimal counterexample`。

current decoder 还验证以下 order 不变量：

- `stepReceipts` 与 `querySteps` 一一对应，step 从 1 连续编号；
- 每个 step 的 matched、mismatched 与 unavailable 之和等于 comparisons；
- order receipt 的 comparisons 与 unavailableComparisons 分别等于各 step 对应计数之和；
- `definitePrefixLength <= possiblePrefixLength <= querySteps.length`；
- matched witness 的长度等于 query steps，所有节点均为 matched；
- mismatched frontier 的两条 path 长度分别匹配 receipt，`firstBlockingStep` 等于 `possiblePrefixLength + 1`；
- witness 与 frontier locator 都位于 source cut，同一 path 的 session sequence 严格递增；
- unavailable result 不携带 failure frontier，retained representatives 不超过 8 个。

Assertions 只保存上面的有界 locator 与差异，不保存 tool ledger 或 event ledger。source owner 为每条事件 mint `eventId`，为每笔 logical tool occurrence mint `toolOccurrenceId`，并保存准确的 scope relation 与 `scopeId`。同一工具生命周期的 started／finished 使用不同 `eventId`，但共享 `toolOccurrenceId`；producer-minted `callId` 不能替代这两种 identity。

tool lifecycle 可以跨 Turn。logical occurrence 的 Turn membership 只属于 operation.started 所在的 home Turn。finished event 保留自己的真实 finish Turn，却不会让 occurrence 成为第二个 Turn 的 tool candidate。

Turn-scoped `matching`／`inOrder` 只检查该 Turn 发起的调用；跨 Turn 完成由 `event`／`eventOrder` 检查。
Turn collection 使用 Turn 封口 cut。Session／Attempt collection 使用 getter 当时的 cut。
`check` 读取 subject 已携带的 cut，不在登记时按调用 ctx 重裁。后续 finish 或新增 row 不能改写已冻结 collection。

唯一 ingestion owner 必须在 event 对 Assertion runtime 可见前，先封口 immutable observed event 的 `eventId`、scope 与 per-Session `sessionSequence`。tool start 同时 mint `toolOccurrenceId`。

open-operation key 是 `(sessionId, adapterOperationId)`，finish 只复用已经封口的 occurrence identity。Adapter `operationId`、Record producer 的 `callId`、名称、时间与数组位置都不能成为跨 family identity。

Agent Turns 只持久化一次 observed event ledger，不再持久化 materialized occurrence ledger。package-owned `o11y` source projector 是 lifecycle 的唯一实现。它负责以下不变量：

- 每个 Session 的 sequence 跨 segment 唯一且严格递增；
- 一个 occurrence 恰有一个 start，最多有一个同 Session 的较晚 finish；
- duplicate open operation、重复 finish与 orphan finish成为 typed ambiguous／unavailable relation。

Assertions runtime 与 Analysis reader 都消费这个 projector。writer 只编码它收到的 observed event，不重新配对或 mint identity。

Debugger 独立报告四个完整性维度：

| 维度 | 回答的问题 | 不得冒充的事实 |
|---|---|---|
| source collection | ledger 的 source facts 是 complete、partial 还是 unavailable | source partial 不能由 Assertion receipt 补全 |
| evaluation receipt | 聚合计数和决定边界是否完整封口 | final tri-state 不能当作完整 receipt |
| identity relation | Assertion locator 与 source row 是否 exact、ambiguous 或 unavailable | 名称、时间和数组位置不能建立 relation |
| overlay retention | 每个已检查 row 的逐行结果是否完整保留 | 聚合计数不能还原逐行状态 |

`collectionAtCut` 只表达 evaluator 当时观察到的 cut receipt，不能单独把最终 ledger 升格为 complete。Analysis 只有在 source owner 的 final collection complete，且 scope、cut 与 sequence 都可验证时，才能确认 evaluation-cut source complete。

final source partial 时，除非 source owner 另有可验证的 cut checkpoint 或 limitation sequence boundary，evaluation cut 也只能是 partial／unverifiable。Assertions 的 receipt、locator 数量与 witness 末端都不能反向证明 source complete。二者冲突时保留 sealed decision 与 receipt，但不形成 complete overlay 或 failure frontier。

ledger 是中立 source facts，不能写入 `matched`、`mismatched`、`unavailable` 或 `not-evaluated`。这些状态只来自保留的 Assertion overlay。逐行 overlay 没有保留时，Debugger 显示“逐行结果未保留”。只有 exact identity relation、canonical order，以及 receipt 或 `failure frontier` 共同证明短路边界时，Analysis 才能把 source row 标为 `not-evaluated`。

current artifact 与 legacy fallback 是编译期不相容的联合。Agent Turns v1 的 `callId` 只能形成同 segment 的 `legacy-source-local` 中立详情。它不能赋给 `toolOccurrenceId`、`MatcherSourceLocator`、current witness／frontier、exact navigation target 或 Assertion overlay。

Assertions v2 的旧 diagnostic 迁入与 current artifact 互斥的 `legacyDiagnostic`，不能进入 retained rows、witness 或 frontier。历史迁移不从旧顺序、`callId` 或新随机值补造 capture-time identity、scope 或 cut。

overlay retention complete 表示每条 source row 都有已保留状态，或能由上述短路边界精确证明为 `not-evaluated`。只有这种状态才能形成 exact matched、mismatched 与 unavailable filters。其它状态只形成 All Records 与 Retained Evidence，并显示 `retained X / examined Y`；聚合总数仍以 receipt 为权威。

## Evaluation、decision、policy 与 score contribution

每个 entry 的 evaluation 一次封口。`observed` 无损区分 boolean outcome、measurement、direct score 与 Judge 的结构化 measurement；它不复制 diagnostic。

Judge 实际返回的 rationale、evidence、detail、citations 才能以 available 事实进入有界 explanation/material，未返回分别是 unavailable/not-recorded。输入材料只属于 materials，不能冒充 Judge returned evidence。Agent-as-Judge trace 暂不持久化。

```ts
type AssertionFactValue =
  | { readonly kind: "unavailable"; readonly reason: "not-recorded" | "not-declared" | "source-unavailable" }
  | { readonly kind: "value"; readonly value: null | boolean | number | string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly AssertionFactValue[] }
  | { readonly kind: "fields"; readonly fields: readonly { readonly label: string; readonly value: AssertionFactValue }[] };

type GateDisposition =
  | "not-gate"
  | "satisfied"
  | "failed"
  | "unavailable"
  | "not-applicable";

type NoScoreContribution = { readonly state: "not-scored" };

type EarnedScoreContribution = {
  readonly state: "earned";
  readonly points: number;
  readonly earned: number;
};

type UnavailableScoreContribution = {
  readonly state: "unavailable";
  readonly points: number;
  readonly reason: "source-unavailable" | "evaluation-errored" | "not-applicable";
};

type ScoreContribution = NoScoreContribution | EarnedScoreContribution | UnavailableScoreContribution;

type AssertionDecision = {
  readonly result: "matched" | "mismatched" | "unavailable" | "errored" | "not-applicable";
  readonly reason: string | null;
  readonly gate: GateDisposition;
};

type AssertionDecisionPolicy = {
  readonly requirement:
    | { readonly state: "available"; readonly value: "required" | "optional" }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
  readonly condition:
    | { readonly state: "available"; readonly value: { readonly kind: "boolean"; readonly expected: true } | { readonly kind: "at-least"; readonly threshold: number } | { readonly kind: "record-only" } }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
};

type ExplanationRetention =
  | { readonly state: "retained"; readonly value: AssertionFactValue }
  | { readonly state: "unavailable"; readonly reason: "not-recorded" };
```

`points` 与 `earned` 都是 finite non-negative numbers；`earned` 不大于 `points`。Score Eval 按已封口 entries 和其 rubric 在读侧汇总 earned score：没有 gate，正常低分或零分仍是 `passed`。执行错误或必要 score source 不可用时，已知 contribution 必须保留为可审计下界；读侧标明 partial 或 unavailable，绝不补 `0`。详见 [Score Eval](library/score-points.md) 与 [Verdict architecture](../verdict/architecture.md)。

## 内嵌 source sites 与 Sources join

source site 持久内容只能在 Assertions payload 或既有 Sources family 中出现。Assertions 保存 join 所需的最小位置事实；Sources 保存 origin Run 的源文件 manifest 与 own blobs。两者之外没有 source-navigation family。

```ts
type AssertionSourceRole =
  | "declaration"
  | "threshold"
  | "score"
  | "gate"
  | "optional"
  | "stop";

type AssertionSourcePosition = {
  readonly line: number;
  readonly column: number;
};

type AssertionSourceSite = {
  readonly entryId: AssertionEntryId;
  readonly sourceOrder: number;
  readonly role: AssertionSourceRole;
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
  readonly start: AssertionSourcePosition;
  readonly end: AssertionSourcePosition;
};
```

每个 row 的 `entryId` 必须属于同一 payload 的 entry；`sourceOrder` 在整个 Attempt 的 source sites 内唯一。rows 先按 `entryId`、再按 `sourceOrder` canonical 排序。`sourceItemId` 与 `sha256` 必须共同匹配该 Attempt exact origin Run 的 Sources manifest；它们不是 path、数组下标、blob key 或跨 owner capability。`role` 只标记确实执行过的 declaration 或 modifier；没有执行到的源码不产生 row。

source mapping 不能重新计算 criterion、points、gate、unavailable 或 Verdict。一个 entry 有多个 row 时，位置可以全部显示，但 Assertion summary 与 score contribution 仍按 `entryId` 只计算一次。没有 matching row、Sources 不是 `available`，或 join／坐标不成立时，source-navigation DomainView 仅把对应位置标为 `unmapped`。

## v1 → v2 相邻迁移

package-private v1 codec 只为 maintenance 存在。纯相邻 transform 只保留 v1 严格能证明的
display、result/gate/score 与 sourceSites。

v1 的 subject、evidence 与 diagnostic 无法区分 source、检查条件、observed、expected 与 explanation。
迁移时按以下方式明确丢弃：

- `materials.source` 写为 `unavailable/not-recorded`；
- evidence 与 limitations 写为空；
- coverage 写为 `unavailable/not-collected`；
- explanation 写为 `unavailable/not-recorded`。

这些旧字段不得以 snapshot、summary、legacy marker 或递归 object 冒充 current 事实。

若被丢弃的 v1 material 引用了 own blob，maintenance 同时物理删除失去引用的 blob，并把删除路径纳入 plan、sentinel 与 Git recovery write set；迁移后的双向 closure 不保留 orphan blob。

v1 没有持久化 criterion expression、measurement/threshold、Judge rationale/citations 时，对应 current field 一律写 `unavailable { reason: "not-recorded" }`。transform 不得从 diagnostic、score ratio 或零值反推。

v1 `gate` 为 `satisfied`、`failed`、`unavailable` 或 `not-applicable` 已证明该 entry 是 required gate，因此迁移为 requirement available/required。condition 仍 unavailable/not-recorded。只有 `gate: "not-gate"` 时 requirement 也是 unavailable/not-recorded。这样 required-unavailable 的旧 Verdict 保持 errored。

物理 payload 与 envelope 的 rewrite、Git/sentinel/recovery 和最终验证由 Record maintenance 执行。transform 本身绝不读写磁盘。

## v2 → v3 相邻迁移

v3 把 matcher artifact 从普通 explanation 中分离，放入 `evaluation` 的封闭联合。`matcher-current` 的权威 receipt 只存在于 artifact 内，不能再与 ordinary `evaluation.receipt` 双写。pure transform 先用 v2 的 published criterion 与 source snapshot discriminator 识别 matcher entry：

- `occurrence/v1` 且 domain 是 tool 或 event，属于 collection matcher；
- source snapshot 的 `assertion` 精确为 `tool-order` 或 `event-order`，属于 order matcher；
- 其它 entry 迁入 `ordinary` evaluation。

识别出的旧 matcher entry 一律写 `{ kind: "matcher-legacy", reason: "historical-not-recorded" }`。v2 retained explanation 若存在，只移动到这个分支的 `legacyDiagnostic`；它不再同时留在 `explanationRetention`。迁移不生成 current artifact，也不从 candidate count、旧 path、`callId`、source 顺序或新随机值补造 source cut 与 locator。

非 matcher entry 迁入 `kind: "ordinary"`，原 evaluation 与 explanation 无损保留。`observed`、decision、policy、contribution、materials 与 source sites 都无损复制。maintenance 随后以 v3 exact decoder 验证完整 payload；transform 本身不执行 matcher，也不读取 Agent Turns。

### 历史 Record 的 Matcher 降级

历史 Record 的 source ledger 可读，但 Assertions 没有保存 locator 或 scope relation 时，Analysis 只交付中立 ledger 和独立的旧 diagnostic。Report 必须显示 `会话已记录 N 条，但此历史 Record 未保存断言与记录的逐条关联`，不能把旧 diagnostic 与 ledger 合并成新的 overlay。

source collection partial 表示 source owner 只保留了安全前缀；observability unavailable 表示 ledger 本身不能形成；retained old diagnostics 只表示旧 Assertions 仍有一份有界解释。这三种状态分别显示。reader 绝不重跑 matcher，也不从旧 diagnostic、source 顺序、名称或 `callId` 推导缺失的 identity relation。

## 读取与读侧形成

固定 family 的 Host 只可能形成 `available`、`not-recorded` 或 `invalid`。`available` 才会提供 immutable payload 与 own blob closure；其余状态不会被消费端补成空 entries、零分或 passed。unknown、future 或不相容 durable bytes 在 reader session 形成前返回 `unsupported-format`。完整 Host 契约见 [Record architecture](../record/architecture.md#attachment-closure-惰性读取与-cache)。

Verdict 使用 Core outcome、sealed Assertions 与 skip 做确定性 fold；Score 从 Assertions contribution 与 rubric 形成。source navigation 则由 [Analysis Library](../analysis/library.md) 的 `query()` 产生已发布 `DomainView`。
这些读侧值不打开 Record path、不猜当前 worktree、不重跑 evaluator，也不回写 durable bytes。

## 相关阅读

- [Assertions](README.md) —— 作者面与范围。
- [Evidence](architecture/evidence.md) —— material 的采集边界。
- [Source sites](architecture/source-sites.md) —— Assertions 内嵌 mapping 与 Sources join。
- [Score Eval](library/score-points.md) —— score state、points 与 rubric。
- [Verdict architecture](../verdict/architecture.md) —— 四态折叠。
- [Record architecture](../record/architecture.md) —— owner、closure、九个 fixed family 与 source-local read。
- [Analysis Library](../analysis/library.md) —— `query()` 与 `DomainView`。
