# PLAN-4 —— Library

本页定义 framework-neutral Bundle API 与可选 React adapter。未列出的能力不构成公共作者面。

## Package 边界

| package path | 责任 | 依赖边界 |
|---|---|---|
| `niceeval/analysis` | descriptor、query、alignment、PricingProfile、cost Measure、closed codec | 不依赖 React。 |
| `niceeval/benchmark` | Definition、Bundle manifest/resource codec、Bundle reader | 不依赖 React / ReactDOM。 |
| `niceeval/benchmark/host` | `materializeBenchmarkBundle()` 与静态写入 | 只在受信任 Node / server 运行。 |
| `niceeval/benchmark/react` | Provider、hooks、有限 render-prop / ARIA 状态投影 | React 是 peer dependency。 |

`niceeval/report`、`niceeval/report/host`、`niceeval/report/built-in`、`niceeval/report/react` 与 `niceeval/report/extension` 不进入目标 export map。

## BenchmarkBundleDefinition

Definition 用 TypeScript 编写，但其公开值是有限纯数据 graph。函数只存在于已经注册的 Analysis descriptor 内，不存在于 Bundle resource callback。

```ts
interface BenchmarkBundleDefinition {
  readonly id: string;
  readonly behaviorVersion: string;
  readonly parameters: JsonSchemaDocument;
  readonly resources: readonly BundleResourceDefinition[];
}

type BundleResourceDefinition =
  | SemanticFrameResourceDefinition
  | DomainViewResourceDefinition
  | BlobResourceDefinition;

interface SemanticFrameResourceDefinition {
  readonly id: string;
  readonly kind: "semantic-frame";
  readonly schema: ResourceSchemaRef;
  readonly request: FrameQueryTemplate;
  readonly dependsOn: readonly string[];
}

interface DomainViewResourceDefinition {
  readonly id: string;
  readonly kind: "domain-view";
  readonly schema: ResourceSchemaRef;
  readonly request: DomainViewQueryTemplate;
  readonly dependsOn: readonly string[];
}

interface BlobResourceDefinition {
  readonly id: string;
  readonly kind: "blob";
  readonly schema: ResourceSchemaRef;
  readonly source: PublishedBlobTemplate;
  readonly mediaType: string;
  readonly dependsOn: readonly string[];
}

interface ResourceSchemaRef {
  readonly id: string;
  readonly version: number;
}

type ParameterValue<Value extends JsonValue> =
  | { readonly kind: "literal"; readonly value: Value }
  | ParameterValueRef;

interface ParameterValueRef {
  readonly kind: "parameter";
  readonly pointer: string;
}

interface FrameQueryTemplate {
  readonly kind: "semantic-frame";
  readonly population: DescriptorRef;
  readonly by: readonly NamedDescriptorRef[];
  readonly measures: readonly NamedDescriptorRef[];
  readonly alignment: AlignmentRequest;
}

interface DomainViewQueryTemplate {
  readonly kind: "domain-view";
  readonly view: DescriptorRef;
  readonly locator?: ParameterValue<string>;
}

interface PublishedBlobTemplate {
  readonly source: DescriptorRef;
  readonly locator: ParameterValue<string>;
}

interface BenchmarkBundleModule {
  readonly contentFingerprint: `sha256:${string}`;
  readonly catalog: readonly AnalysisCatalogContribution[];
  readonly definition: BenchmarkBundleDefinition;
}

interface AnalysisCatalogContribution {
  readonly id: string;
  readonly descriptors: readonly PublishedAnalysisDescriptor[];
}

declare const PublishedAnalysisDescriptorTypeId: unique symbol;

interface PublishedAnalysisDescriptor {
  readonly kind:
    | "population"
    | "dimension"
    | "measure"
    | "relation"
    | "domain-view"
    | "blob-source";
  readonly id: string;
  readonly behaviorVersion: string;
  readonly contentIdentity: string;
  readonly dependencies: readonly DescriptorRef[];
  readonly [PublishedAnalysisDescriptorTypeId]: true;
}

declare function defineBenchmarkBundleModule(input: {
  readonly catalog: readonly AnalysisCatalogContribution[];
  readonly definition: BenchmarkBundleDefinition;
}): BenchmarkBundleModule;
```

`PublishedAnalysisDescriptor` 只能由 `niceeval/analysis` 的定义函数签发，普通结构相同的 object 不能伪造 brand。计算与 host binding 留在 descriptor 私有 closure，不进入 Definition 或 manifest。

CLI 加载的 module 必须恰好导出一个 `BenchmarkBundleModule`。Definition 仍是纯数据 graph，不能把函数藏进 resource。

`defineBenchmarkBundleModule()` 根据 canonical Definition graph 与 catalog contribution ID 形成 `contentFingerprint`。输入还包括每个 descriptor 的 kind、ID、behaviorVersion 与 contentIdentity。调用方不能手写 fingerprint。任何 descriptor dependency 的 content identity 改变都会形成新 module fingerprint。

Resource graph 的 ID、kind、schema、依赖和 descriptor ref 在 definition time 已固定。`ParameterValueRef.pointer` 是从已验证 parameters 根开始的 [RFC 6901 JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901)；空 pointer、`-` array append、越界索引与不存在的成员都拒绝。Parameter slot 只出现在上面穷尽列出的 `ParameterValue` 字段，不能增删 resource、改 kind、选择 descriptor 或触发条件 callback。

Parameters 先按 JSON Schema exact-decode，再 canonicalize。任何额外字段、无效 number 或未声明 slot 都在 Record I/O 前失败。

Catalog 先合并全部 contribution，再验证 descriptor identity、依赖存在性与有向无环。Resource graph 随后验证 resource ID、`dependsOn` 存在性与有向无环。全部检查都发生在 Record I/O 前。

每个 request ref 还必须匹配 descriptor kind：population / by / measures / view / blob source 分别只能引用对应 capability。`dependsOn` 只引用同一 Definition 内的 resource ID，不是 descriptor dependency 的第二种写法。

失败 code 是以下穷尽集合：

- 重复 contribution：`descriptor-contribution-duplicate`；
- 相同 identity 对应不同内容：`descriptor-identity-conflict`；
- descriptor 依赖缺失：`descriptor-dependency-missing`；
- descriptor graph 有 cycle：`descriptor-dependency-cycle`；
- resource 依赖缺失：`bundle-resource-dependency-missing`；
- resource graph 有 cycle：`bundle-resource-dependency-cycle`。

Definition identity 包含以下内容：

- definition ID / behaviorVersion；
- 规范化 resource graph；
- 全部 descriptor ID / behaviorVersion；
- `BenchmarkBundleModule.contentFingerprint`；
- materializer version。

它不使用 `Function.toString()`、mtime、绝对路径或当前时间。

## Manifest

```ts
interface BenchmarkBundleManifest {
  readonly format: "niceeval.benchmark-bundle/v1";
  readonly identity: BundleIdentity;
  readonly definition: {
    readonly id: string;
    readonly behaviorVersion: string;
    readonly contentFingerprint: string;
  };
  readonly parameters: JsonValue;
  readonly materializer: {
    readonly version: string;
    readonly analysisCatalog: string;
  };
  readonly sample: ExactSampleIdentity;
  readonly selection: ExactSelectionIdentity;
  readonly resources: readonly BundleResourceManifest[];
  readonly issues: readonly AnalysisIssueDocument[];
  readonly refs: readonly BundleEvidence[];
  readonly provenance: BundleProvenance;
}

type BundleIdentity = `sha256:${string}`;

interface BundleProvenance {
  readonly niceevalVersion: string;
  readonly analysisCatalog: string;
  readonly definitionFingerprint: string;
  readonly descriptorGraph: readonly {
    readonly id: string;
    readonly behaviorVersion: string;
  }[];
}

interface BundleResourceManifest {
  readonly id: string;
  readonly kind: "semantic-frame" | "domain-view" | "blob";
  readonly schema: ResourceSchemaRef;
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly dependsOn: readonly string[];
  readonly issues: readonly AnalysisIssueDocument[];
  readonly refs: readonly EvidenceRefDocument[];
}

type BundleEvidence =
  | {
      readonly state: "included";
      readonly ref: EvidenceRefDocument;
      readonly resourceId: string;
      readonly anchor: BundleResourceAnchor;
    }
  | {
      readonly state: "reference-only";
      readonly ref: EvidenceRefDocument;
    };

type BundleResourceAnchor =
  | { readonly kind: "json-pointer"; readonly value: string }
  | { readonly kind: "byte-range"; readonly start: number; readonly endExclusive: number };
```

Manifest 没有 `createdAt`、mtime、绝对 path、部署 URL、随机 nonce、Record path 或 blob locator。`BundleEvidence.ref` 只能是 Analysis 签发的逻辑 Evidence identity。

`manifest.definition.contentFingerprint` 必须等于输入 `BenchmarkBundleModule.contentFingerprint`；`definition.id` 与 `behaviorVersion` 则来自同一 module 内的 Definition。Materializer 不能接受调用方另传或替换这三项 identity。

每个 `EvidenceRefDocument.identity` 在 manifest 内只能出现一次。`included` 的 `resourceId` 必须存在。JSON resource 只能使用 canonical RFC 6901 pointer；blob 只能使用非负、非空且不超过 exact byteLength 的 byte range。

Materializer 必须用 anchor 定位到实际值或 bytes。目标不存在、类型不匹配、identity 重复或 range 越界都会使 Bundle 形成失败，不能降为 `reference-only`。

## Analysis JSON codec

这一组 document 是 CLI、Bundle 与 Insight 共用的唯一 JSON 投影。运行期 Analysis 类型仍由 [`niceeval/analysis`](../../../feature/analysis/library.md#metricvalue-%E7%9C%9F%E5%80%BC%E8%A1%A8) 拥有；这里穷尽跨进程字段，codec 不能依调用面删减。

```ts
interface EvidenceRefDocument {
  readonly identity: {
    readonly kind: "attempt";
    readonly locator: string;
  };
}

interface AnalysisIssueDocument {
  readonly code:
    | "missing"
    | "migration-required"
    | "unsupported"
    | "producer-incompatible"
    | "input-invalid"
    | "reduction-failed"
    | "relation-unmatched";
  readonly message: string;
  readonly refs: readonly EvidenceRefDocument[];
}

interface MetricValueDocument {
  readonly value: JsonValue | null;
  readonly state:
    | "available"
    | "partial"
    | "unavailable"
    | "empty"
    | "migration-required"
    | "unsupported"
    | "failed";
  readonly samples: number;
  readonly total: number;
  readonly basis: "attempt" | "eval" | "run" | "pair" | "slot";
  readonly issues: readonly AnalysisIssueDocument[];
  readonly refs: readonly EvidenceRefDocument[];
  readonly unit?: string;
  readonly format?: string | { readonly kind: string; readonly options?: JsonValue };
  readonly better?: "higher" | "lower" | "neutral";
  readonly bounds?: { readonly min?: number; readonly max?: number };
}

interface PopulationIdentityDocument {
  readonly kind: "population";
  readonly descriptor: DescriptorRef;
  readonly memberSet: string;
  readonly denominator: number;
}

type AlignmentDocument =
  | { readonly mode: "side-by-side"; readonly sets: readonly PopulationIdentityDocument[] }
  | { readonly mode: "exact"; readonly population: PopulationIdentityDocument }
  | {
      readonly mode: "paired";
      readonly relation: DescriptorRef;
      readonly left: { readonly set: string; readonly population: PopulationIdentityDocument };
      readonly right: { readonly set: string; readonly population: PopulationIdentityDocument };
      readonly pair: PopulationIdentityDocument;
      readonly unmatched: readonly AlignmentMemberDocument[];
      readonly excluded: readonly AlignmentMemberDocument[];
    };

interface SemanticRowDocument {
  readonly key: string;
  readonly coordinates: readonly {
    readonly name: string;
    readonly descriptor: DescriptorRef;
    readonly value: JsonValue;
  }[];
  readonly measures: readonly {
    readonly name: string;
    readonly descriptor: DescriptorRef;
    readonly value: MetricValueDocument;
  }[];
  readonly issues: readonly AnalysisIssueDocument[];
  readonly refs: readonly EvidenceRefDocument[];
}

type DescriptorRefDocument = DescriptorRef;
```

`samples`、`total`、range boundary 与所有 count 必须是非负 safe integer；byte range 还要求 `start < endExclusive`。Metric state/value 真值表沿用 Analysis，不另造 Browser 或 CLI state。

## Resource body

```ts
interface SemanticFrameDocument {
  readonly format: "niceeval.semantic-frame/v1";
  readonly schemaVersion: 1;
  readonly sample: ExactSampleIdentity;
  readonly population: PopulationIdentityDocument;
  readonly alignment: AlignmentDocument;
  readonly comparability: ComparabilityDocument;
  readonly rows: readonly SemanticRowDocument[];
  readonly issues: readonly AnalysisIssueDocument[];
  readonly refs: readonly EvidenceRefDocument[];
}

interface DomainViewDocument {
  readonly format: "niceeval.domain-view/v1";
  readonly schemaVersion: 1;
  readonly sample: ExactSampleIdentity;
  readonly view: DescriptorRefDocument;
  readonly body: JsonValue;
  readonly issues: readonly AnalysisIssueDocument[];
  readonly refs: readonly EvidenceRefDocument[];
}
```

每个 Measure cell 完整保存 `MetricValue` 的 value、state、samples、total、basis、issues、refs、unit、format、better 与 bounds。缺失不能编码成删除 row、空 string 或 scalar `0`。

Blob body 是 manifest 声明 media type 的 exact bytes。它只能来自 NiceEval 发布的闭合 blob source，不能由 Definition callback 任意读 host path。

`DomainViewDocument.body` 必须按 manifest 的 resource schema exact-decode。外层不猜不同 DomainView 的 entry 形状；每个已发布 schema 单独穷尽自己的 body union。

一个 frame / domain resource 在 v1 对应一个文件。大材料独立为 blob；transparent chunking、pagination 与 lazy continuation 不属于 v1。

## Reader

```ts
interface BundleReader {
  readonly read: (path: string) => Promise<Uint8Array>;
}

type BundleResource =
  | {
      readonly kind: "semantic-frame";
      readonly manifest: BundleResourceManifest;
      readonly value: SemanticFrameDocument;
    }
  | {
      readonly kind: "domain-view";
      readonly manifest: BundleResourceManifest;
      readonly value: DomainViewDocument;
    }
  | {
      readonly kind: "blob";
      readonly manifest: BundleResourceManifest;
      readonly bytes: Uint8Array;
    };

interface BenchmarkBundle {
  readonly manifest: BenchmarkBundleManifest;
  readonly resources: readonly BundleResource[];
}

interface BundleHandle {
  readonly identity: BundleIdentity;
  readonly manifest: BenchmarkBundleManifest;
  readonly resource: (id: string) => Promise<BundleResourceState>;
}

type BundleResourceState =
  | {
      readonly state: "available";
      readonly resource: BundleResource;
    }
  | {
      readonly state: "unsupported";
      readonly resourceId: string;
      readonly code: "resource-schema-unsupported" | "resource-dependency-unsupported";
      readonly schema: ResourceSchemaRef;
      readonly dependencies: readonly string[];
    }
  | {
      readonly state: "error";
      readonly resourceId: string;
      readonly code: BundleResourceErrorCode;
      readonly path: readonly (string | number)[];
      readonly message: string;
    };

type BundleResourceErrorCode =
  | "resource-not-declared"
  | "bundle-corrupt";

interface BundleOpenError {
  readonly code:
    | "bundle-version-unsupported"
    | "bundle-manifest-invalid"
    | "bundle-resource-read-failed"
    | "bundle-corrupt";
  readonly path: readonly (string | number)[];
  readonly message: string;
}

declare function openBenchmarkBundle(input: {
  readonly manifest: BenchmarkBundleManifest;
  readonly reader: BundleReader;
}): Promise<BundleHandle>; // rejects only with BundleOpenError

declare function materializeBenchmarkBundle(input: {
  readonly module: BenchmarkBundleModule;
  readonly parameters: JsonValue;
  readonly selection: AnalysisSelectionRequest;
}): Promise<BenchmarkBundle>;
```

用户拥有 reader 的 HTTP、文件、鉴权和缓存策略。`openBenchmarkBundle()` 会读取全部已声明 resource bytes，验证 canonical path、byte length、每项 digest，并重算完整 BundleIdentity；任何 read failure 或 corruption 都在返回 handle 前拒绝。成功 handle 私有持有这些已验证 bytes，`resource()` 不再次调用 reader。

`BundleHandle.resource()` 不接受类型参数，也不返回 caller 指定的 cast。它先按 manifest 查找 ID，再按 manifest kind/schema decode 已验证 bytes，最终返回上面的穷尽 state。`available.resource.kind` 是调用者继续收窄的唯一依据。

Digest mismatch、缺失 bytes、重复 path 或 path collision 是 `bundle-corrupt`，不能降级为 unsupported。未知 resource schema 在 digest 验证后局部为 unsupported；依赖该 resource 的已知 resource 也必须为 unsupported。

未知 manifest major 整体拒绝。Bundle 不迁移；用户用新版本从 Record 重新 materialize。

## React adapter

React adapter 只导出下列类别：

```ts
interface BenchmarkBundleProviderProps {
  readonly handle: BundleHandle;
  readonly resourceTransition: "clear" | "retain-stale";
  readonly children: React.ReactNode;
}

declare function BenchmarkBundleProvider(
  props: BenchmarkBundleProviderProps,
): React.ReactElement;

declare function useBundleIdentity(): BundleIdentity;
declare function useBundleResource(id: string): ResourceState;
declare function MetricValueState(props: MetricValueStateProps): React.ReactElement;
declare function EvidenceState(props: EvidenceStateProps): React.ReactElement;

type ResourceState =
  | { readonly state: "loading"; readonly identity: BundleIdentity; readonly resourceId: string }
  | {
      readonly state: "available";
      readonly identity: BundleIdentity;
      readonly resource: BundleResource;
    }
  | {
      readonly state: "unsupported";
      readonly identity: BundleIdentity;
      readonly detail: Extract<BundleResourceState, { readonly state: "unsupported" }>;
    }
  | {
      readonly state: "error";
      readonly identity: BundleIdentity;
      readonly detail: Extract<BundleResourceState, { readonly state: "error" }>;
    }
  | {
      readonly state: "stale";
      readonly identity: BundleIdentity;
      readonly requestedIdentity: BundleIdentity;
      readonly resource: BundleResource;
    };

interface MetricValueStateProps {
  readonly value: MetricValueDocument;
  readonly ariaLabel: string;
  readonly children: (state: MetricValueRenderState) => React.ReactElement;
}

interface MetricValueRenderState {
  readonly state: MetricValueDocument["state"];
  readonly value: JsonValue | null;
  readonly samples: number;
  readonly total: number;
  readonly issues: readonly AnalysisIssueDocument[];
  readonly refs: readonly EvidenceRefDocument[];
  readonly aria: {
    readonly "data-state": MetricValueDocument["state"];
    readonly "aria-invalid"?: true;
    readonly "aria-label": string;
  };
}

interface EvidenceStateProps {
  readonly evidence: BundleEvidence;
  readonly ariaLabel: string;
  readonly children: (state: EvidenceRenderState) => React.ReactElement;
}

type EvidenceRenderState =
  | {
      readonly state: "included";
      readonly ref: EvidenceRefDocument;
      readonly target: { readonly resourceId: string; readonly anchor: BundleResourceAnchor };
      readonly aria: { readonly "data-state": "included"; readonly "aria-label": string };
    }
  | {
      readonly state: "reference-only";
      readonly ref: EvidenceRefDocument;
      readonly aria: { readonly "data-state": "reference-only"; readonly "aria-label": string };
    };
```

`MetricValueState` 与 `EvidenceState` 是无样式 render-prop / ARIA 状态投影。Adapter 负责把闭合 state 映射为稳定 `data-state` 和调用方提供的可访问 label；Metric state 为 `failed` 时还输出 `aria-invalid: true`，其它 state 不输出该属性。调用者必须把 `state.aria` spread 到自己返回的可见 element，并负责最终文字、class、交互、语言与 Evidence URL。Adapter 不创建 link，也不猜 URL。

Adapter 不导出 fetch、URL constructor、Table、Chart、router、CSS、theme、head、asset、Page 或 bundle materializer。它不接受 Sample、Definition、selection、Measure 或 sort/rank request。

同一 Provider tree 只能消费一个 BundleIdentity。更换 handle 会形成新的 React revision；旧 resource Promise 不得提交到新 identity。`resourceTransition: "clear"` 会立即进入新 identity 的 `loading`；`"retain-stale"` 只在相同 resource ID 先前为 available 时保留旧值，并形成带旧 `identity` 与新 `requestedIdentity` 的 `stale`。新资源返回后原子进入新 identity 的 terminal state。`loading` 没有旧值，`available` / `unsupported` / `error` 都只属于字段中的 identity。

BundleHandle 包含 reader capability，不能作为 Astro hydration prop 序列化。用户的客户端 `.tsx` wrapper 从可序列化 manifest 与自有 byte reader 构造 handle，再由 `.astro` 直接 import wrapper 并声明 `client:*`。
