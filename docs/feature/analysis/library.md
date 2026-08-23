# Analysis Library（分析库）

本页定义 `niceeval/analysis` 的公开契约。Analysis 只读取 current Record definition 发布的输入。
它不接受旧格式、任意 Record 字段、路径、schema object、registration point 或 reader constructor。

`niceeval/analysis` 是普通 Analysis 与 Report 作者的导入面。`niceeval/analysis/host` 则导出公开、受支持的
高级 Host composition SDK `analysisHost`，其唯一操作是 `openSample()`。CLI、`reportHost` 与替代 host 用它把
已经由 `recordHost` 打开的 reader 和 selection 封装为 Sample；作者 API、Report callback 与闭合输出都不取得
Record reader。

完整场景见 [Use cases](use-case/README.md)。层职责见 [Analysis](README.md)。

## 导入面

```ts
import {
  aggregate,
  defineDimension,
  defineMeasure,
  definePopulation,
  defineRelation,
  narrowSample,
  query,
} from "niceeval/analysis";
```

`aggregate()` 的契约属于 Analysis。Report 可以为普通作者重导出这个操作，但不会定义第二套
Population、分母、缺失或 Evidence 规则。

## 定义面

### 已发布的输入与成员集

`AnalysisInput` 是 NiceEval 根据 current Record 事实发布的只读投影。它没有公开构造器或注册入口。
作者可以选择一个输入，不能把任意 payload、网络响应、当前文件或当前时间伪装成输入。

```ts
declare const AnalysisInputTypeId: unique symbol;

interface AnalysisInput<Member, Input> {
  readonly kind: "analysis-input";
  readonly id: AnalysisInputId;
  readonly population: Population<Member>;
  readonly [AnalysisInputTypeId]: (_: Input) => Input;
}

declare const attemptPassed: AnalysisInput<LogicalSlot, boolean>;
declare const attemptLatencyMs: AnalysisInput<LogicalSlot, number>;
declare const attemptToolFailure: AnalysisInput<LogicalSlot, boolean>;
```

`attemptPassed` 把 `passed` 投影为 `true`，把 `failed`、`errored` 与 `skipped` 投影为 `false`。这些都是已有 verdict 事实，
因此都进入通过率分母；只有没有可读 Record 输入的成员才形成 missing contribution，并使读数成为 `partial`。

`AnalysisInput.id` 只标识投影语义。它既不是 Record property token id，也不是 TS field 或 durableKey。
例如 `attemptLatencyMs` 可以有 `niceeval.analysis.attempt-latency-ms` 这个 input id，同时读取
`niceeval.observability` 中的多个固定 property。把任何 JSON key 或内部 property token 当成 input id
都会把 durable format 与统计语义绑在一起。

每个已发布 input 都有 NiceEval package-private binding。它声明 member 要定位的 owner 与所需 fixed Attachment
definition。它还定义读取失败怎样成为 issue，以及从已验证 payload 得到 input value 的 pure projection。
这个 binding 不是 public `defineAnalysisInput()`，也不是调用时查找的动态表。

```text
attemptPassed     → attempt / niceeval.assertions
attemptLatencyMs  → attempt / niceeval.observability
DomainViewRequest → its declared owner and fixed Attachment requirements
```

Host 只在 Measure 或 DomainView 实际需要一个 member 时执行 binding。Sample 以
`{ owner, package-private attachment definition }` 缓存完整的 lazy read；同一 Scope 中的后续请求复用结果，
但不会预读没有请求的 family、也不会把 cache 交给 Report。

binding 对一个 member 的闭合观察只有以下五种状态：

| state | value | 含义 |
|---|---|---|
| `value` | 有 | current input 已验证并形成值 |
| `missing` | 无 | current catalog 中应有的事实缺席 |
| `migration-required` | 无 | 已知旧 schemaVersion 有固定迁移路径；issue code 同为 `migration-required` |
| `unsupported` | 无 | reader 不认识所需的 future family，或 producer 不支持该 input |
| `failed` | 无 | 读取、验证或 pure projection 失败 |

较早 reader 若不认识 binding 需要的独立 future family，例如 `niceeval.energy`，保留该 family 的磁盘 bytes
而不解码它。Sample 把这一次 input / view request 形成 `unsupported`，不影响不依赖它的
Measure、Core selection 或闭合 Report 输出。这个局部结果不同于 current catalog family 缺失的
`not-recorded`，也不同于已知 family 的旧 schemaVersion 所需的 `migration-required`。

`PopulationMembers` 同样由 NiceEval 或领域包发布。它固定一个总体的成员穷尽规则，且不含 Record reader、
路径或原始 payload。

```ts
interface Population<Member> {
  readonly kind: "population";
  readonly id: PopulationId;
  readonly members: PopulationMembers<Member>;
}

declare function definePopulation<Member>(options: {
  readonly id: string;
  readonly members: PopulationMembers<Member>;
}): Population<Member>;

declare const logicalSlotMembers: PopulationMembers<LogicalSlot>;

export const logicalSlots = definePopulation({
  id: "niceeval.logical-slots",
  members: logicalSlotMembers,
});
```

查询不能用数组过滤、任意 predicate 或另一次读取悄悄改变 Population 的成员集。

### Dimension 与 Relation

Dimension 只映射自己 Population 已发布的 member。Relation 明确连接两个 Population；它禁止按
label、数组位置、时间接近或数值容差猜测对应关系。

```ts
interface Dimension<Member, Value extends DimensionValue> {
  readonly kind: "dimension";
  readonly id: DimensionId;
  readonly population: Population<Member>;
}

declare function defineDimension<Member, Value extends DimensionValue>(options: {
  readonly id: string;
  readonly population: Population<Member>;
  readonly value: (member: Member) => Value;
}): Dimension<Member, Value>;

interface Relation<From, To> {
  readonly kind: "relation";
  readonly id: RelationId;
  readonly from: Population<From>;
  readonly to: Population<To>;
  readonly cardinality: "one-to-one" | "many-to-one";
}

declare function defineRelation<From, To>(options: {
  readonly id: string;
  readonly from: Population<From>;
  readonly to: Population<To>;
  readonly cardinality: "one-to-one" | "many-to-one";
  readonly match: (member: From) => RelationTarget<To> | null;
}): Relation<From, To>;
```

没有可验证 target、关系不满足 cardinality 或 target 有歧义时，查询产生关系问题，不自行选择
一个成员。

### Measure 是唯一的计算定义

Measure 在一个 Population 上一次声明完整统计口径。Calculation 不是公开类型；一个需呈现的统计
结果必须先成为 Measure。显示层可以组合或格式化已闭合 `MetricValue`，但不能由未包装 scalar 重新包装
出指标。

```ts
interface Measure<Member, Value> {
  readonly kind: "measure";
  readonly id: MeasureId;
  readonly population: Population<Member>;
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
}

interface MeasureOptions<Member, Input, AttemptValue, SlotValue, Value> {
  readonly id: string;
  readonly population: Population<Member>;
  readonly input: AnalysisInput<Member, Input>;
  readonly withinAttempt: WithinAttemptReduction<Input, AttemptValue>;
  readonly withinSlot: WithinSlotReduction<AttemptValue, SlotValue>;
  readonly acrossSlots: AcrossSlotsReduction<SlotValue, Value>;
  readonly denominator: Denominator<Member>;
  readonly missing: MissingPolicy;
  readonly evidence: EvidencePolicy;
  readonly producers?: ProducerPolicy;
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
}

declare function defineMeasure<Member, Input, AttemptValue, SlotValue, Value>(
  options: MeasureOptions<Member, Input, AttemptValue, SlotValue, Value>,
): Measure<Member, Value>;
```

三个 reduction 固定依次处理 Attempt 内的输入、一个 logical Slot 中的 Attempt，以及一个分组
坐标中的 Slot。每段都保留贡献、问题与 Evidence；不能把中间 scalar 丢失语义后重新包装。

```ts
declare function oneValue<Value>(): WithinAttemptReduction<Value, Value>;
declare function sum(): WithinAttemptReduction<number, number>;
declare function latestCompletedAttempt<Value>(): WithinSlotReduction<Value, Value>;
declare function mean(): AcrossSlotsReduction<number, number>;
declare function sumAcrossSlots(): AcrossSlotsReduction<number, number>;
declare function ratio(): AcrossSlotsReduction<boolean, number>;
declare function allLogicalSlots<Member>(): Denominator<Member>;
declare function partial(): MissingPolicy;
declare function retainContributingEvidence(): EvidencePolicy;
declare function requireSameProducer(): ProducerPolicy;
```

`denominator` 在读取可用值前固定。`partial()` 允许可用成员继续形成结果，但不允许剩余成员从
`total` 消失。`requireSameProducer()` 拒绝把不可比 producer 混为一个数值。

```ts
export const passRate = defineMeasure({
  id: "niceeval.pass-rate",
  population: logicalSlots,
  input: attemptPassed,
  withinAttempt: oneValue<boolean>(),
  withinSlot: latestCompletedAttempt<boolean>(),
  acrossSlots: ratio(),
  denominator: allLogicalSlots(),
  missing: partial(),
  evidence: retainContributingEvidence(),
  unit: "ratio",
  format: "percent",
  better: "higher",
});
```

## Sample、选择与 coverage

`Sample` 是 Host 签发的 opaque capability。它带有可审计的纯 `SampleSnapshot`，但其惰性读取
能力只在开设它的 Scope 内存在。

```ts
declare const SampleCapabilityTypeId: unique symbol;

interface Sample {
  readonly kind: "analysis-sample";
  readonly snapshot: SampleSnapshot;
  readonly [SampleCapabilityTypeId]: true;
}

interface SampleSnapshot {
  readonly version: 1;
  readonly identity: AnalysisSampleIdentity;
  readonly selection: AnalysisSelectionSummary;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
  readonly coverage: SampleCoverage;
}

interface SampleCoverage {
  readonly frameTotal: number;
  readonly selected: number;
  readonly included: number;
  readonly notRecorded: number;
  readonly coreInvalid: number;
  readonly excluded: number;
}
```

每个 `AnalysisRun` 还关闭该 Run Core 的 `context`：`execution.agentId`、`model`、
`reasoningEffort`、secret-free JSON `flags` 与 string `labels`。这些值在 Snapshot 中递归冻结，
可由 `LogicalSlot.run` 供 Dimension 读取；它们不是 reader、当前项目配置或重新打开 Record 的能力。若
selection 后该 Run Core 已不可读，`context` 为 `null`，Analysis 不伪造历史配置。

`frameTotal === selected + excluded`，而 `selected === included + notRecorded + coreInvalid`。coverage
审计的是 Sample 的选择框架，不是任一 Measure 的业务分母；每个 Measure 仍独立声明自己的
`denominator`。

```ts
type ActiveAnalysisSlot =
  | IncludedAnalysisSlot
  | NotRecordedAnalysisSlot
  | CoreInvalidAnalysisSlot;

interface IncludedAnalysisSlot {
  readonly state: "included";
  readonly runId: RunId;
  readonly slotId: SlotId;
  readonly attempt: AttemptLocator;
  readonly relation: "origin" | "reference";
}

interface NotRecordedAnalysisSlot {
  readonly state: "not-recorded";
  readonly runId: RunId;
  readonly slotId: SlotId;
}

interface CoreInvalidAnalysisSlot {
  readonly state: "core-invalid";
  readonly runId: RunId;
  readonly slotId: SlotId;
  readonly issues: readonly AnalysisIssue[];
}

interface ExcludedAnalysisSlot {
  readonly state: "excluded";
  readonly runId: RunId;
  readonly slotId: SlotId;
  readonly base: ActiveAnalysisSlot;
  readonly reason?: "identity-mismatch";
}

type AnalysisSlot = ActiveAnalysisSlot | ExcludedAnalysisSlot;
```

每个 Selection 建立的 expected Slot 恰有一项。`excluded.base` 保存一次收窄前的状态，且不能再
嵌套另一个 `excluded`。`runs` 按 RunId 排序，`slots` 按 RunId、SlotId 排序。

Host 的 `explicit-runs` 选择保留具名 sealed Run 的全部 expected Slot。`project-current` 只保留
身份仍匹配当前目标的 Slot。

CLI 把已加载的 definitions 与 target identity 编成具名 `AnalysisCurrentSlotIdentity`。它携带
experiment、eval 与 execution identity digest。Report Host 不再重新发现项目，也不读物理 Record。

先打开所选 sealed Run 的完整 expected membership，再按 digest 收窄。不匹配的 Slot 进入
`excluded`，且 `reason` 为 `identity-mismatch`。它们不会静默混进 `coverage.selected` 分母。

显式 `--run` 走 `explicit-runs`。它审计该 Run 的完整 expected membership，不使用当前 identity
收窄。精确 Run 或 Attempt locator 可以形成显式选择或 Evidence 目标。它只是身份，不是打开 Record
的能力。应用代码从不拿到 Record root。

```ts
interface AnalysisCurrentSlotIdentity {
  readonly experimentId: ExperimentId;
  readonly evalId: EvalId;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
}

type AnalysisSelectionRequest =
  | {
      readonly policy: "explicit-runs";
      readonly runIds: readonly RunId[];
    }
  | {
      readonly policy: "project-current";
      readonly experimentIds?: readonly ExperimentId[];
      readonly currentSlots: readonly AnalysisCurrentSlotIdentity[];
    };
```

### Codec 与 narrowing

Snapshot 是唯一可编码的 Sample 形态。解码恢复冻结的选择审计，不会 mint 一份可查询 Sample。

```ts
declare function encodeSampleSnapshot(snapshot: SampleSnapshot): JsonValue;
declare function decodeSampleSnapshot(value: unknown): SampleSnapshot;
```

解码在 JSON 边界 exact 校验、按稳定 identity 规范化排序并 deep-freeze。失败返回
`SampleSnapshotCodecError`。它不接受 reader、root、路径或 Attachment，也不会读取 OTel、diff 或
blob。

```ts
interface SampleSelector {
  readonly runIds?: readonly RunId[];
  readonly slotIds?: readonly SlotId[];
}

declare function narrowSample(sample: Sample, selector: SampleSelector): Sample;
```

同一字段中的多个 ID 是 OR；不同字段是 AND。空 selector 是 invalid input，不表示“全部”。Narrowing
只做单调交集：已排除成员不会重新纳入，操作不重新打开 Record，也不会更新 Snapshot 的历史事实。
它是 Analysis 的范围操作，不是 Report 的显示筛选。

## 实验组与比较范围

`ExperimentComparisonScope` 是 Analysis 签发的私有品牌能力。它绑定一个父 `Sample` 与一个判别式实验组 identity，不能由作者构造、伪造品牌或在父 Scope 关闭后读取。

```ts
type ExperimentGroupIdentity =
  | { readonly kind: "named"; readonly groupId: ExperimentGroupId }
  | { readonly kind: "singleton"; readonly experimentId: ExperimentId };

interface ExperimentEvalCoverage {
  readonly member: ExperimentId;
  readonly coveredEvalCount: number;
  readonly groupEvalCount: number;
}

interface ExperimentComparison {
  readonly members: readonly ExperimentId[];
  readonly coverage: readonly ExperimentEvalCoverage[];
}

interface ExperimentComparisonScope {
  readonly group: ExperimentGroupIdentity;
  readonly comparison: ExperimentComparison;
  // private brand and parent-Sample capability
}

declare function experimentComparisonScope(
  sample: Sample,
  group: ExperimentGroupIdentity,
): ExperimentComparisonScope;
```

组列表只从 selection 选中的 Run 派生。纯 `identity-mismatch` 的 excluded 历史不产生组或成员；Core invalid、not-dispatched 和 interrupted 仍属于已选 Run，留在组内并贡献问题。comparison member 是去重后的 `ExperimentId`，同一 Experiment 的多个 Run 合并为一个 member。

population（Eval ID 集合）从该 member 的全部非 excluded expected Slot 形成，按 `EvalId` 去重。Attempt ordinal、Attempt 是否建立或 outcome 都不改变这个总体。根级 singleton 与当前 Sample 中只剩一个 member 的 named 组也形成 comparison scope；它们可显示单行，但不声称相对排名。

### 比较资格与样本命中范围

实验组是作者的比较准入声明：属于同一个实验组的 member 始终可以比较，Analysis 不再用 Eval population 是否相同否决作者声明。每个 member 的指标只消费它实际拥有的 expected Slot，并保留自己的分母；没有运行的 Eval 不补零、不记为通过、失败或错误，也不缩成共同 Eval 的交集。

`coverage` 同时给出每个 member 命中的 distinct Eval 数和该组所有 member 的 distinct Eval 并集数。它描述样本命中范围，不是比较 gate；并集为零时比例是空值而不是 `0%`。Pass 类指标可连同各自分母和 coverage 展示；依赖不同总体的 raw total score 不默认排序或连线。把多个实验组伪造成一个 branded projection 仍以 `analysis-comparison-group-mismatch` 失败。

## query 与 aggregate

`aggregate()` 为普通 Report 直接返回闭合行。它从 by 与 values 推断共同 Population，并在读取事实前
拒绝 population mismatch、无 Relation 的跨总体组合、identity collision 与无效请求。
行 identity 由完整、规范化的 Dimension coordinate 构成，不使用截断 hash；Dimension number 必须是
finite，`NaN` 与 `Infinity` 在形成坐标前即成为 input-invalid 问题。

```ts
interface AggregateRequest<By, Values> {
  readonly by: By;
  readonly values: Values;
}

declare function aggregate<By, Values>(
  sample: Sample,
  request: AggregateRequest<By, Values>,
): Promise<ClosedRows<AggregateRow<By, Values>>>;
```

`query()` 是完整 Analysis 操作。表格请求显式写出 Population，返回 `SemanticFrame`；领域请求只能使用
NiceEval 发布的 `DomainViewRequest`，返回不能压成表格的闭合视图。

```ts
interface FrameQuery<Member, By, Measures> {
  readonly kind: "frame";
  readonly population: Population<Member>;
  readonly by: By;
  readonly measures: Measures;
}

interface DomainViewQuery<View extends DomainView> {
  readonly kind: "domain-view";
  readonly view: DomainViewRequest<View>;
  readonly locator?: AttemptLocator;
}

declare function query<Member, By, Measures>(
  sample: Sample,
  request: FrameQuery<Member, By, Measures>,
): Promise<SemanticFrame<By, Measures>>;

declare function query<View extends DomainView>(
  sample: Sample,
  request: DomainViewQuery<View>,
): Promise<View>;
```

`DomainViewQuery` 可以带一个精确 `locator`。给出时它必须属于当前 Sample 的 included Attempt，且只请求
该 Attempt 所需的 Trace、事件、Evidence、file diff 或 blob。没有 locator 的内建概览才请求当前选择的
全部 included Attempt。每项请求复用同一个 Sample 的 attachment cache；`aggregate()` 从不因它们预加载
重内容。

### File Changes DomainView

`fileChangesView` 被请求时才读取目标 Attempt 的 File Changes Attachment。它关闭 attribution、collection 和
按 send 区间排序的 `windows`，保留 window ID、sequence、change ID、path、端点形态与 collection limitation。
这份 trajectory 是领域视图的主体；每个 send 区间仍保留自己的数组，也不生成持久 patch 或 hunk。

`net` 只是一项 reader 派生值，绝不回写 Attachment。Analysis 仅在 collection 为 complete，且每条重复 path 的
相邻端点连续可证明、端点没有未知时给出 reliable `net`。端点不连续、`unavailable` revision 或结构为
`partial` 时，`net` 为 `indeterminate` 并携带对应 issue。consumer 仍取得完整已知 trajectory，不能把安全前缀
补成净变化。

File Changes family 缺席时，DomainView 保留 `not-recorded`；完整空轨迹与 partial 的空安全前缀仍分别保留自己的
collection 状态。它们都不是 query 失败，也不等同于 `net` 的 reliable 空结果。

### Source Navigation DomainView

`sourceNavigationView` 只在请求时读取 Attempt-owned `niceeval.source-navigation`。它关闭 collection 与每个
`turnId`、`sourceOrder`。mapped frame 保留 `sourceItemId`、`sha256` 和坐标；linked timing 保留 `agent.send`
interval。

它保留 `unmapped` 的精确原因和 unavailable timing 的 `timing-not-recorded`。limitation 的
`navigation-row` 表示遗漏的行，`timing-link` 表示遗漏的 timing link。它不复制 outcome 或 duration。

Host 已在 family read 前验证 Navigation 对同一 Attempt Observability 与 exact origin Sources 的显式 join。
Analysis 因而不扫描 source blob、不重建 sourceOrder，也不以数组位置拼 turn、source 或 timing；它只交付闭合
值。若 family 缺席，entry 保留 `not-recorded`，不能伪造成一条 unmapped send。

`attempt-evidence` 是一个闭合的非表格视图。Sample 在同一次成功读取 `ReadableAttempt` 时取得 Core `outcome`。

它将该 Outcome 和已验证 Assertions 交给权威 fold，形成 detail 的派生 `verdict`。Outcome 是执行终态，Verdict
是权威 fold 的结果，二者不能互换。

如果 Sample 无法读取该 Attempt 的 Core，entry 明确为 `failed`，并带 `reduction-failed` Evidence issue。Analysis
不会补出猜测的 outcome 或 verdict。

detail 只含闭合 outcome、verdict、Assertions、source-site 和 material 文本/状态。它绝不含 reader、owner、Scope
或 blob capability。

## MetricValue 真值表

```ts
interface MetricValue<Value = number> {
  readonly value: Value | null;
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
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
  readonly bounds?: { readonly min?: number; readonly max?: number };
}
```

| state | value | samples / total | issues 与含义 |
|---|---|---|---|
| `available` | 非 null | `samples === total` 且 `total > 0` | 全部预期成员按该 Measure 的规则贡献 |
| `partial` | 有贡献时非 null；零贡献时为 null | `samples < total` 且 `total > 0` | 每个未贡献成员都有 missing、unsupported 或可恢复的数据问题 |
| `unavailable` | null | 由专门的闭合投影定义 | 该投影没有可报告值；原因由它自己的闭合 reason union 说明 |
| `empty` | null | `samples === total` | Measure 的领域结果合法为空，且没有缺失、unsupported 或失败问题 |
| `migration-required` | null | `samples === 0` 且 `total > 0` | 全部预期输入，或 across reduction，都只因已知旧 schemaVersion 而不可读；先运行 `niceeval migrate` |
| `unsupported` | null | 没有可形成结果的 current 输入 | host / producer 未提供 input，或 reader 不认识它依赖的 future family |
| `failed` | null | 已贡献数可小于或等于 total | 读取、验证、relation、producer 或 reduction 出现阻断性失败 |

合法零值始终是 `available` 或 `partial` 的 `value: 0`，绝不是 `empty`。`samples` 只数实际贡献
value 的成员，`total` 只数该分组坐标中 Measure 已固定的预期成员。请求本身不合法时，操作以
`AnalysisRequestError` 拒绝；它不是一个伪造的 MetricValue。

```ts
interface AnalysisIssue {
  readonly code:
    | "missing"
    | "migration-required"
    | "unsupported"
    | "producer-incompatible"
    | "input-invalid"
    | "reduction-failed"
    | "relation-unmatched";
  readonly message: string;
  readonly refs: readonly EvidenceRef[];
}

interface EvidenceRef {
  readonly identity: EvidenceIdentity;
}
```

## ClosedRows、SemanticFrame 与 DomainView

```ts
declare const ClosedRowsTypeId: unique symbol;

interface ClosedRows<Row> extends ReadonlyArray<Readonly<Row>> {
  readonly [ClosedRowsTypeId]: true;
  readonly identity: ClosedRowsIdentity;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}

interface SemanticFrame<By, Measures> {
  readonly kind: "semantic-frame";
  readonly sample: AnalysisSampleIdentity;
  readonly population: PopulationIdentity;
  readonly rows: ClosedRows<SemanticRow<By, Measures>>;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}
```

`SemanticFrame.issues` 与 `rows.issues` 是同一份冻结列表，`SemanticFrame.refs` 与 `rows.refs` 也是同一份
去重冻结列表。它们汇总每个 group 与 MetricValue 已产生的 Analysis issues 和 Evidence refs，因而显示层
过滤 rows 也不能把已闭合的问题从结果中抹去。每一行有稳定 opaque key、已经形成的 Dimension 坐标，
以及完整 `MetricValue` 单元。

`ClosedRows` 只能由 Analysis 创建；普通数组即使字段形状相同也不是闭合行。
排序、limit 或 filter 产生的普通显示数组可以交给组件，却不能重新进入
Analysis 或声称保留原 rows identity。

`DomainView` 也只含稳定 identity、闭合树或时序、issues 与 refs。两种输出都不含 reader、Scope、
executor、Promise、callback、路径、Attachment、blob capability 或原始 Record payload。

需要组合两个 Attempt DomainView 时，消费者按 canonical Attempt locator 建立显式 Map。缺少 entry 或同一
locator 出现多个 entry 都是可见的闭合对齐状态，不能靠数组位置、展示顺序或“第一个匹配项”推断关联。

## Host Scope 与失败

`niceeval/analysis/host` 是公开、受支持的高级 Host composition SDK，且只导出 `analysisHost` 的
`openSample()`。它取得 Record reader 的 package-private adapter，并把 lazy Attachment cache 封装进 Sample。
`query()` 与 `aggregate()` 仍由作者入口 `niceeval/analysis` 拥有；Report author 不导入 host，也不取得 reader
或 Attachment。

```ts
interface AnalysisHostSDK {
  openSample(input: {
    readonly reader: RecordReadSession;
    readonly selection: RecordSelection;
  }): Effect.Effect<Sample, AnalysisSampleOpenError, Scope.Scope>;
}

interface AnalysisSampleClosedError {
  readonly code: "analysis-sample-closed";
  readonly sample: AnalysisSampleIdentity;
}
```

`openSample()` 校验 Selection 属于传入 reader，并固定 Snapshot。它不读取未请求的 Attachment。Scope
关闭后，`query()`、`aggregate()` 和 `narrowSample()` 都以 `AnalysisSampleClosedError` 失败；实现必须在读取
之前检测该状态。闭合输出和 SampleSnapshot 不含 capability，因而不受此错误影响。

Analysis executor、缓存与具体执行后端是 Host 实现。它们可以替换，但同一请求必须保持 value、state、
samples、total、basis、issues 与 refs 相同。
