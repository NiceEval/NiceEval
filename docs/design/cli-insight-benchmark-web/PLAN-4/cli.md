# PLAN-4 —— CLI

本页定义 CLI 的目标形状。CLI 不读取或执行网页组件，也不把 terminal 结果投影成网页。

## 命令边界

```sh
niceeval query discover [--request <file|->]
niceeval query run --request <file|-> [--human]
niceeval query explain --request <file|-> [--human]
niceeval show @<locator>
niceeval show --run <run-id>
niceeval bundle materialize <definition-module> --selection <file|-> --instances <file> --out <directory>
niceeval insight [selection flags]
```

`query` 默认输出 machine document。`--human` 只把同一次成功 materialization 交给 terminal formatter，不重新打开 Record。

`show` 只支持人读 exact locator、Run 与内建摘要。它不支持 `--json`；机器消费者改用 `query run` 的 domain request。

`bundle materialize` 加载受信任 Definition module，从 `SelectionDocument` 固定 exact selection，并从纯 JSON instances 文件取得参数实例。它不执行用户网站或 Astro build。

`insight` 启动第一方 debug UI。它不是 `view` 的兼容别名，也不支持 `--out`、自定义 Report 或静态站点生成。

## `niceeval.query/v1`

机器模式 stdout 恰好写一个 canonical JSON document。领域 validation failure 也写 error document，并返回非零退出码。stderr 只承载进度、启动失败或无法形成协议文档的进程级崩溃。

```ts
type QueryCommand =
  | DiscoverCommand
  | RunQueryCommand
  | ExplainQueryCommand;

interface DiscoverCommand {
  readonly protocol: "niceeval.query/v1";
  readonly op: "discover";
  readonly selection?: SelectionDocument;
}

interface RunQueryCommand {
  readonly protocol: "niceeval.query/v1";
  readonly op: "query";
  readonly selection: SelectionDocument;
  readonly request: QueryRequestDocument;
}

interface ExplainQueryCommand {
  readonly protocol: "niceeval.query/v1";
  readonly op: "explain";
  readonly selection: SelectionDocument;
  readonly request: QueryRequestDocument;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type JsonSchemaDocument = {
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly [keyword: string]: JsonValue;
};
```

`JsonSchemaDocument` 的唯一外部语义 owner 是 [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)。NiceEval 只接受 canonical JSON schema，拒绝远程 `$ref`、自定义 keyword 与运行期 codec callback。

`SelectionDocument` 是 Analysis selection 的闭合机器输入。它只能使用 discovery 公布的 selector 与 exact public handle，不能包含 Record path、函数、当前时间或隐式 latest 表达式。

```ts
interface SelectionDocument {
  readonly sets: readonly NamedSelectionSet[];
}

interface NamedSelectionSet {
  readonly name: string;
  readonly source:
    | { readonly kind: "project-current" }
    | { readonly kind: "explicit-runs"; readonly runIds: readonly string[] }
    | { readonly kind: "exact-attempts"; readonly locators: readonly string[] };
  readonly where: readonly SelectorPredicate[];
}

interface SelectorPredicate {
  readonly selector: string;
  readonly operator: "eq" | "in" | "prefix";
  readonly value: JsonValue;
}
```

`sets` 非空，name 唯一。Run ID 与 locator canonicalize 后排序去重；predicate 按 selector 与 canonical value 排序。`project-current` 绑定当前 target identity，不表示 latest Run。

```ts
type QueryRequestDocument =
  | FrameRequestDocument
  | DomainViewRequestDocument;

interface FrameRequestDocument {
  readonly kind: "semantic-frame";
  readonly population: DescriptorRef;
  readonly by: readonly NamedDescriptorRef[];
  readonly measures: readonly NamedDescriptorRef[];
  readonly alignment: AlignmentRequest;
}

interface DomainViewRequestDocument {
  readonly kind: "domain-view";
  readonly view: DescriptorRef;
  readonly locator?: string;
}

interface DescriptorRef {
  readonly id: string;
  readonly behaviorVersion: string;
}

interface NamedDescriptorRef extends DescriptorRef {
  readonly name: string;
}

type AlignmentRequest =
  | { readonly mode: "side-by-side" }
  | { readonly mode: "exact" }
  | {
      readonly mode: "paired";
      readonly relation: DescriptorRef;
      readonly leftSet: string;
      readonly rightSet: string;
    };
```

`side-by-side` 与 `exact` 对 selection 中全部 named set 求值。`paired.leftSet` / `rightSet` 必须引用两个不同的 set；它们的 Population 必须分别匹配 Relation 左右端。Materializer 不按 set 顺序猜左右端，也不把第三个 set 偷偷带入 pair。

JSON 请求不能提交 SQL、JavaScript、函数、临时 formula 或任意 expression AST。自定义 descriptor 先在受信任 TypeScript 中定义并注册，之后才由 discovery 暴露。

## Discovery

Discovery response 必须足以让 Agent 不读源码就构造合法请求：

```ts
interface DiscoveryDocument {
  readonly protocol: "niceeval.query/v1";
  readonly op: "discover";
  readonly success: true;
  readonly schema: JsonSchemaDocument;
  readonly selectors: readonly SelectorCapability[];
  readonly populations: readonly PopulationCapability[];
  readonly dimensions: readonly DimensionCapability[];
  readonly measures: readonly MeasureCapability[];
  readonly relations: readonly RelationCapability[];
  readonly domainViews: readonly DomainViewCapability[];
  readonly examples: readonly QueryCommand[];
  readonly catalog: CatalogIdentity;
}

type SelectorCapability = DescriptorCapability & {
  readonly kind: "selector";
  readonly operators: readonly ("eq" | "in" | "prefix")[];
};

type PopulationCapability = DescriptorCapability & {
  readonly kind: "population";
  readonly memberIdentitySchema: JsonSchemaDocument;
};

type DimensionCapability = DescriptorCapability & {
  readonly kind: "dimension";
};

type DomainViewCapability = DescriptorCapability & {
  readonly kind: "domain-view";
  readonly locator: "none" | "optional" | "required";
};
```

每项 capability 都包含 descriptor `id`、`behaviorVersion`、输入输出类型、Population、依赖、Evidence 能力与说明。Measure 另含 unit、format、better、basis 与可用 alignment；Relation 另含左右 Population 与 pair Population。

```ts
interface DescriptorCapability {
  readonly id: string;
  readonly behaviorVersion: string;
  readonly description: string;
  readonly population?: DescriptorRef;
  readonly inputSchema: JsonSchemaDocument;
  readonly outputSchema: JsonSchemaDocument;
  readonly dependencies: readonly DescriptorRef[];
  readonly evidence: "none" | "refs" | "domain-detail";
}

interface CatalogIdentity {
  readonly format: "niceeval.analysis-catalog/v1";
  readonly sha256: string;
}

interface MeasureCapability extends DescriptorCapability {
  readonly unit?: string;
  readonly format?: string;
  readonly better: "higher" | "lower" | "neutral";
  readonly basis: "attempt" | "eval" | "run" | "pair" | "slot";
  readonly alignments: readonly ("side-by-side" | "exact" | "paired")[];
}

interface RelationCapability extends DescriptorCapability {
  readonly leftPopulation: string;
  readonly rightPopulation: string;
  readonly pairPopulation: string;
}
```

相同 ID / behaviorVersion 对应不同定义、重复 contribution 或 dependency identity 冲突时，discovery 在任何 Record I/O 前失败。

## 比较资格

Alignment 是穷尽 union，没有默认值。

| mode | 允许 | 禁止 |
|---|---|---|
| `side-by-side` | 并排显示不同总体各自的 scalar、samples、total、coverage 与 issues。 | 跨总体 delta、rank、trend 或隐式 intersection。 |
| `exact` | 在 exact member set 上计算 delta、rank 与 trend。 | 任何 identity、成员、Measure behavior、producer 或 selection basis 不一致。 |
| `paired` | 通过具名 Relation 形成 pair Population，并计算 pair measure。 | 用显示字段或共同 Eval 猜 pair。 |

Exact response 的 comparability 必须保存 population identity、canonical member set identity、Measure identity / behavior、producer compatibility 与 selection basis。

Paired response 必须同时保存左右原分母、pair denominator、unmatched、excluded 与 issues。Side-by-side 可以保留不同 raw total，但不能把它们折成共同排名。

```ts
type ComparabilityDocument =
  | {
      readonly mode: "side-by-side";
      readonly sets: readonly {
        readonly name: string;
        readonly population: string;
        readonly memberSet: string;
        readonly denominator: number;
      }[];
      readonly derivedComparison: false;
    }
  | {
      readonly mode: "exact";
      readonly population: string;
      readonly memberSet: string;
      readonly measures: readonly DescriptorRef[];
      readonly producers: readonly ProducerCompatibilityDocument[];
      readonly selectionBasis: "attempt" | "eval" | "run" | "slot";
      readonly derivedComparison: true;
    }
  | {
      readonly mode: "paired";
      readonly relation: DescriptorRef;
      readonly left: { readonly set: string; readonly population: string; readonly denominator: number };
      readonly right: { readonly set: string; readonly population: string; readonly denominator: number };
      readonly pair: { readonly population: string; readonly denominator: number };
      readonly unmatched: readonly AlignmentMemberDocument[];
      readonly excluded: readonly AlignmentMemberDocument[];
      readonly issues: readonly AnalysisIssueDocument[];
      readonly derivedComparison: true;
    };

interface ProducerCompatibilityDocument {
  readonly producer: string;
  readonly state: "same" | "declared-compatible";
  readonly compatibilityIdentity: string;
}

interface AlignmentMemberDocument {
  readonly side: "left" | "right";
  readonly population: string;
  readonly memberIdentity: JsonValue;
  readonly reason:
    | "relation-unmatched"
    | "selection-excluded"
    | "producer-incompatible"
    | "member-unavailable";
}
```

## 成功与解释响应

```ts
type QuerySuccessDocument =
  | FrameQuerySuccessDocument
  | DomainViewQuerySuccessDocument;

interface FrameQuerySuccessDocument {
  readonly protocol: "niceeval.query/v1";
  readonly op: "query";
  readonly success: true;
  readonly request: CanonicalQueryRequest;
  readonly sample: ExactSampleIdentity;
  readonly selection: ExactSelectionIdentity;
  readonly result: SemanticFrameDocument;
  readonly comparability: ComparabilityDocument;
  readonly issues: readonly AnalysisIssueDocument[];
  readonly refs: readonly EvidenceRefDocument[];
  readonly provenance: QueryProvenance;
}

interface DomainViewQuerySuccessDocument {
  readonly protocol: "niceeval.query/v1";
  readonly op: "query";
  readonly success: true;
  readonly request: CanonicalQueryRequest;
  readonly sample: ExactSampleIdentity;
  readonly selection: ExactSelectionIdentity;
  readonly result: DomainViewDocument;
  readonly comparability: { readonly mode: "not-applicable" };
  readonly issues: readonly AnalysisIssueDocument[];
  readonly refs: readonly EvidenceRefDocument[];
  readonly provenance: QueryProvenance;
}

type ExplainSuccessDocument = FrameExplainSuccessDocument | DomainViewExplainSuccessDocument;

interface FrameExplainSuccessDocument {
  readonly protocol: "niceeval.query/v1";
  readonly op: "explain";
  readonly success: true;
  readonly request: Extract<CanonicalQueryRequest, { readonly kind: "semantic-frame" }>;
  readonly selection: ExactSelectionIdentity;
  readonly plan: FrameQueryPlanDocument;
  readonly comparability: ComparabilityDocument;
  readonly provenance: QueryProvenance;
}

interface DomainViewExplainSuccessDocument {
  readonly protocol: "niceeval.query/v1";
  readonly op: "explain";
  readonly success: true;
  readonly request: Extract<CanonicalQueryRequest, { readonly kind: "domain-view" }>;
  readonly selection: ExactSelectionIdentity;
  readonly plan: DomainViewQueryPlanDocument;
  readonly comparability: { readonly mode: "not-applicable" };
  readonly provenance: QueryProvenance;
}

interface ExactSampleIdentity {
  readonly kind: "analysis-sample";
  readonly id: string;
  readonly snapshotDigest: string;
}

interface ExactSelectionIdentity {
  readonly kind: "analysis-selection";
  readonly id: string;
  readonly sets: readonly {
    readonly name: string;
    readonly memberSet: string;
    readonly denominator: number;
  }[];
}

interface QueryProvenance {
  readonly niceevalVersion: string;
  readonly materializerVersion: string;
  readonly catalog: CatalogIdentity;
  readonly descriptors: readonly DescriptorRef[];
}

interface FrameQueryPlanDocument {
  readonly population: DescriptorRef;
  readonly descriptors: readonly DescriptorRef[];
  readonly inputs: readonly DescriptorRef[];
  readonly alignment: AlignmentRequest;
}

interface DomainViewQueryPlanDocument {
  readonly view: DescriptorRef;
  readonly inputs: readonly DescriptorRef[];
  readonly locator?: string;
}

type CanonicalQueryRequest =
  | {
      readonly kind: "semantic-frame";
      readonly population: DescriptorRef;
      readonly by: readonly NamedDescriptorRef[];
      readonly measures: readonly NamedDescriptorRef[];
      readonly alignment: AlignmentRequest;
    }
  | {
      readonly kind: "domain-view";
      readonly view: DescriptorRef;
      readonly locator?: string;
    };
```

`AnalysisIssueDocument`、`EvidenceRefDocument`、`SemanticFrameDocument` 与 `MetricValue` 的唯一语义 owner 是 [Analysis Library](../../../feature/analysis/library.md#metricvalue-真值表)。Machine protocol 使用这些 interface 的 exact JSON 投影，不增加同义 state 或省略字段。

`explain` 关闭选择、descriptor graph、alignment 与预计 input，不执行重 payload query。它不会给出未经执行的指标值。

所有 object key、descriptor、row、issue 与 ref 使用协议规定的 canonical order。Human formatter 只消费成功文档里的同一 closed result。

## 可修正失败

```ts
interface QueryErrorDocument {
  readonly protocol: "niceeval.query/v1";
  readonly op: "discover" | "query" | "explain";
  readonly success: false;
  readonly error: {
    readonly code: QueryErrorCode;
    readonly path: readonly (string | number)[];
    readonly message: string;
    readonly expected?: JsonValue;
    readonly candidates?: readonly JsonValue[];
    readonly correction?: QueryCommand;
  };
}

type QueryErrorCode =
  | "query-document-invalid"
  | "query-protocol-unsupported"
  | "query-selection-invalid"
  | "query-selector-unknown"
  | "query-descriptor-unknown"
  | "query-descriptor-version-mismatch"
  | "query-descriptor-conflict"
  | "query-alignment-required"
  | "query-alignment-incompatible"
  | "query-relation-required"
  | "query-sample-open-failed"
  | "query-materialization-failed";
```

`correction` 必须是可直接重试的完整 command。CLI 不猜 alignment；缺少时可以给出有限 candidates，但不能任选一个成功执行。

## Insight lifecycle

`niceeval insight` 默认只绑定 loopback，并为浏览器 session 签发不可从 URL 猜出的短期 token。它不开放 CORS，也不把私有 RPC 宣布为公共 API。

打开时形成 `InsightRevision` 与 frozen Sample。该 revision 内的 frame、trace、diff 与 artifact 请求都携带 revision identity；晚到的旧请求不能进入新 revision。

Watcher 只显示“有新结果”。用户确认刷新后，Host 完整形成下一 revision，再原子切换。Insight 不在浏览器导航中重选 latest，也不在现有 revision 上追加新 Record 事实。

## Bundle CLI receipt

静态实例由调用方在 `--instances` 文件中显式列出。文件是 canonical JSON array，不运行 `enumerate(sample)` callback。

```ts
interface BundleMaterializationReceipt {
  readonly parameters: JsonValue;
  readonly bundleIdentity: BundleIdentity;
  readonly outputDirectory: string;
  readonly reused: boolean;
}
```

一次调用返回有序 `BundleMaterializationReceipt[]`。不存在 BundleSet、dataset、latest manifest 或当前指针。
