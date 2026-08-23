# PLAN-2 —— CLI

## 命令边界

```sh
niceeval query discover [--request <file|->]
niceeval query run [--request <file|->]
niceeval query explain [--request <file|->]

niceeval show [@<attempt-locator> | --run <run-id>... | --experiment <selector>...]
niceeval insight [@<attempt-locator> | --run <run-id>... | --experiment <selector>...] [--port <port>] [--no-open]
```

`query` 始终输出 machine document，没有 `--human`。`show` 始终输出英语 Human text，没有 `--json`。Insight chrome 私有支持 `en` 与 `zh-CN`，locale 不改变 Analysis 或 machine bytes。

`insight` v1 固定监听 loopback，不提供 `--host`、`--out`、`--report`、Page、theme 或自定义 component 参数。

## stdin 与操作 authority

Subcommand 是 operation 的唯一 authority。Request body 带 protocol version，但不重复 `op`。

- `--request <file>` 读取该文件。
- `--request -` 读取 stdin。
- `run` / `explain` 省略 `--request` 且 stdin 不是 TTY 时直接读取 stdin。
- `run` / `explain` 遇到 TTY stdin 时返回结构化 usage error，并给出 `--request -` 的 rerun argv。
- `discover` 无 request 时返回 compact bootstrap；有 request 时返回 capability detail 或 selection catalog page。

Machine stdout 恰好写一个 canonical JSON document。成功与可形成协议的领域失败都走 stdout；进度、启动失败和无法形成文档的进程级崩溃只写 stderr。

## `niceeval.query/v1`

```ts
interface ProtocolInput {
  readonly protocol: "niceeval.query/v1";
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type DiscoverRequest =
  | (ProtocolInput & {
      readonly kind: "capabilities";
      readonly descriptors: readonly DescriptorLookup[];
    })
  | (ProtocolInput & {
      readonly kind: "selection-catalog";
      readonly selectors: readonly string[];
      readonly page?: SelectionCatalogPageRequest;
    });

interface DescriptorLookup {
  readonly kind:
    | "selector"
    | "population"
    | "dimension"
    | "measure"
    | "relation"
    | "domain-view";
  readonly id: string;
  readonly behaviorVersion?: string;
}

interface SelectionCatalogPageRequest {
  readonly after?: SelectionCatalogCursor;
  readonly limit?: number;
}

interface SelectionCatalogCursor {
  readonly snapshot: string;
  readonly request: string;
  readonly afterKind: string;
  readonly afterIdentity: string;
}
```

`limit` 省略时为 50，最大 200。Cursor 只含 public content identity，不含 Record generation、Scope token、reader 或 nominal handle。

### Bootstrap discovery

无 request 的 `niceeval query discover` 返回：

- protocol 与三条 operation schema 的 identity；
- 每类 capability 的 ID、behaviorVersion、说明和 detail lookup；
- selection source、basis 与 selector 的紧凑 index；
- 可直接提交的最小 detail request、selection request 与 query request。

它不一次展开全部 JSON Schema、examples 或历史 handles。Detail discovery 按 kind / ID 返回完整 schema、Population、依赖、unit、basis、Evidence 能力与合法 alignment。

Selection discovery 返回 `AnalysisSelectionCatalogSnapshot` 的分页投影。每页都携带 `selectionSnapshotIdentity` 与 `next`；最后一页的 `next` 显式为 `null`。分页时 Catalog 内容变化返回 `selection-catalog-stale` 与无 request bootstrap correction。

Discovery snapshot 只约束各页来自同一个 catalog。`query run` 不复用该 snapshot；它重新打开 frozen Record view 并查找 request 中的 exact handles。

## 选择与 member basis

```ts
interface NamedSelectionSet {
  readonly name: string;
  readonly source: SelectionSource;
  readonly where: readonly SelectorPredicate[];
}

type SelectionSource =
  | { readonly kind: "project-current" }
  | { readonly kind: "explicit-runs"; readonly runIds: readonly string[] }
  | { readonly kind: "exact-slots"; readonly slotHandles: readonly string[] }
  | { readonly kind: "exact-attempts"; readonly locators: readonly string[] };

interface SelectorPredicate {
  readonly selector: string;
  readonly operator: "eq" | "in" | "prefix";
  readonly value: JsonValue;
}
```

Source kind 固定 basis：`project-current`、`explicit-runs`、`exact-slots` 是 `logical-slot`；`exact-attempts` 是 `attempt`。Caller 不能另传 basis。

每个 Population capability 穷尽列出支持的 basis。`exact-attempts` 不映射为 origin Slot，也不展开 reference Slots；需要 exact logical Slot 时必须使用 discovery 交付的 Slot handle。

Selector 是具名 capability，不接受 JSON path。它只读取 selection catalog 已关闭的 secret-free Run / Core / Slot / Attempt identity 与 Run context。Dimension、Measure、MetricValue、Attachment 与 DomainView 结果不能参与 selection。

`prefix` 只对 capability 明确标为 hierarchical 的稳定 identity 开放。Model、Agent、Run ID、Attempt locator 与 Slot handle 只支持 `eq | in`。所有 narrowing 都在 Sample 形成前完成，并在 exact selection audit 中保留 included、excluded、selector 与 reason。

## Query request

```ts
type RunRequest = FramesRunRequest | DomainViewRunRequest;

interface FramesRunRequest extends ProtocolInput {
  readonly kind: "frames";
  readonly sets: readonly NamedSelectionSet[];
  readonly frames: readonly NamedFrameRequest[];
  readonly alignment: AlignmentRequest;
}

interface NamedFrameRequest extends FrameSpec {
  readonly set: string;
}

interface FrameSpec {
  readonly population: DescriptorRef;
  readonly by: readonly NamedDescriptorRef[];
  readonly measures: readonly NamedDescriptorRef[];
}

interface DomainViewRunRequest extends ProtocolInput {
  readonly kind: "domain-view";
  readonly set: NamedSelectionSet;
  readonly view: DescriptorRef;
  readonly locator?: string;
}

type AlignmentRequest =
  | { readonly mode: "side-by-side" }
  | { readonly mode: "exact" }
  | {
      readonly mode: "paired";
      readonly relation: DescriptorRef;
      readonly leftSet: string;
      readonly rightSet: string;
      readonly pairFrame: FrameSpec;
    };

interface DescriptorRef {
  readonly id: string;
  readonly behaviorVersion: string;
}

interface NamedDescriptorRef extends DescriptorRef {
  readonly name: string;
}
```

`sets` 非空且 name 唯一。`frames` 对每个 set 恰好声明一个 frame。Paired 恰好引用两个不同 set；Relation 明确左右 Population，`pairFrame.population` 必须是该 Relation 的 pair Population。

JSON 不能携带 SQL、JavaScript、函数、任意 expression AST 或临时公式。自定义 Population、Measure 与 Relation 先在受信任 TypeScript 中注册，再由 discovery 暴露。

DomainView request 只有一个 set。`locator` 只定位该 exact selection 内的详情，不成为 frame Population selector。

## Alignment 响应

```ts
type FramesRunResult =
  | {
      readonly mode: "side-by-side";
      readonly derivedComparison: false;
      readonly sets: readonly ClosedSetFrame[];
    }
  | {
      readonly mode: "exact";
      readonly derivedComparison: false;
      readonly population: string;
      readonly memberSet: string;
      readonly sets: readonly ClosedSetFrame[];
    }
  | {
      readonly mode: "paired";
      readonly relation: DescriptorRef;
      readonly left: ClosedSetFrame;
      readonly right: ClosedSetFrame;
      readonly pair: ClosedPairFrame;
      readonly unmatched: readonly AlignmentMember[];
      readonly excluded: readonly AlignmentMember[];
      readonly issues: readonly AnalysisIssue[];
    };

interface ClosedSetFrame {
  readonly set: string;
  readonly selection: ExactSelectionAudit;
  readonly population: string;
  readonly denominator: number;
  readonly frame: SemanticFrame;
}

interface ExactSelectionAudit {
  readonly identity: string;
  readonly basis: "logical-slot" | "attempt";
  readonly included: readonly SelectionMemberAudit[];
  readonly excluded: readonly SelectionMemberAudit[];
}

interface SelectionMemberAudit {
  readonly identity: JsonValue;
  readonly state: "included" | "excluded";
  readonly selector?: string;
  readonly reason: string;
}

interface ClosedPairFrame {
  readonly population: string;
  readonly memberSet: string;
  readonly denominator: number;
  readonly frame: SemanticFrame;
}

interface AlignmentMember {
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

Side-by-side 允许不同 Population，各自保留 denominator 与 issues。Exact 要求所有 set 的 Population identity 与 exact member-set identity 相同。它只证明对齐，不自动计算 delta、rank 或 trend。

Paired 同时交付左右 frame、pair Population frame、三份 denominator、unmatched 与 excluded。三份 frame 必须在同一次 Analysis operation 原子形成。

Delta、rank、trend 只有作为显式注册并由 request 引用的 Analysis Measure，或未来新增的穷尽请求 union 才能出现。CLI、formatter 与 Insight 不从 scalar 临时派生。

`SemanticFrame`、`MetricValue`、`AnalysisIssue`、Evidence 与 DomainView 的字段和状态由 [Analysis Library](../../../feature/analysis/library.md) 唯一拥有。Machine codec 是这些闭合值的 exact JSON 投影，不能按调用面省略 missing、total、issues 或 refs。

## 成功 document

```ts
type QueryRunSuccessDocument =
  | {
      readonly protocol: "niceeval.query/v1";
      readonly op: "run";
      readonly success: true;
      readonly recordView: string;
      readonly request: FramesRunRequest;
      readonly result: FramesRunResult;
      readonly issues: readonly AnalysisIssue[];
      readonly provenance: QueryProvenance;
    }
  | {
      readonly protocol: "niceeval.query/v1";
      readonly op: "run";
      readonly success: true;
      readonly recordView: string;
      readonly request: DomainViewRunRequest;
      readonly result: DomainView;
      readonly issues: readonly AnalysisIssue[];
      readonly provenance: QueryProvenance;
    };

interface QueryProvenance {
  readonly niceevalVersion: string;
  readonly analysisVersion: string;
  readonly catalogIdentity: string;
  readonly descriptors: readonly DescriptorRef[];
}
```

`recordView` 是本次 query execution 的公开内容身份，不是 discovery snapshot 或 runtime generation。Request 使用 canonical handles、predicates 与 descriptor order；response 的 set、descriptor、issue 与 Evidence 顺序由对应 identity 固定。

## Explain

`niceeval query explain` 接受与 `run` 相同的 operation-specific request。它关闭 exact selection、member identity、descriptor graph、Relation 与 producer compatibility 所需的最小 metadata，不读取 Measure 或 DomainView 的重 payload。

Explain 明确声明正式 query 仍可能因 input I/O 失败。它不返回未经执行的 MetricValue，也不把 plan 当结果。

## 可修正错误

```ts
interface QueryErrorDocument {
  readonly protocol: "niceeval.query/v1";
  readonly op: "discover" | "run" | "explain";
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly path: readonly (string | number)[];
    readonly message: string;
    readonly expected?: JsonValue;
    readonly candidates?: readonly JsonValue[];
    readonly correction?: {
      readonly argv: readonly string[];
      readonly request?: JsonValue;
    };
  };
}
```

Correction 是完整、可直接重试的 operation-specific request，并给出已经 tokenized 的 argv，例如 `["niceeval", "query", "run", "--request", "-"]`。CLI 不返回需要 shell quoting 的单个 command string。

至少固定以下错误 code：

- `query-document-invalid`、`query-protocol-unsupported`；
- `query-selector-unknown`、`query-selector-operator-unsupported`；
- `query-selection-handle-unknown`、`query-selection-basis-incompatible`；
- `selection-catalog-stale`；
- `query-descriptor-unknown`、`query-descriptor-version-mismatch`、`query-descriptor-conflict`；
- `query-alignment-required`、`query-alignment-incompatible`、`query-relation-required`；
- `query-sample-open-failed`、`query-operation-failed`。

## `niceeval show`

`show` 只提供具名第一方 recipe：

- `show --run` 保留 Experiment → Eval → Attempt 层级摘要、`Attempt #N`、历史 locator 与判定；
- 失败 Attempt 交付 `niceeval show @<locator>` 和 `niceeval insight @<locator>`；
- `show @<locator>` 直接形成 exact Attempt selection，并呈现 Evidence、observability、file changes 与具名问题；
- `show --experiment` 使用 project-current + typed Experiment selector；
- 无 selector 使用 project-current overview。

Attempt locator、`--run` 与 `--experiment` 三类 selector 互斥。`--run` 与 `--experiment` 可分别重复；CLI 在 Record 或 Attachment I/O 前拒绝非法组合。

每个 recipe 调用 Analysis operation并消费同一 closed values。Terminal formatter 只能排序、截断视觉宽度和排版；不能选择成员、聚合 scalar、改 denominator、丢 missing 或重建 Evidence。

## `niceeval insight`

Insight 与 `show` 使用相同 selector 语义。无 selector 进入 project-current overview，`--run` 进入 Run overview，exact locator 进入 Attempt detail。

默认让 OS 分配端口。`--port` 固定端口，`--no-open` 阻止自动打开浏览器。Server 与首个 revision 都成功后才报告 ready；生命周期与授权见 [Lifecycle](lifecycle.md)。
