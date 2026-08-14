# Analysis Library（分析库）

本页定义 `niceeval/analysis` 的公开契约。Analysis 只读取首个正式 Record v1 协议发布的输入。
它不接受旧格式、任意 Record 字段、路径、schema 注册或读取器构造器。

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

`AnalysisInput` 是 NiceEval 根据 Record v1 事实发布的只读投影。它没有公开构造器或 registry。
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

`PopulationMembers` 同样由 NiceEval 或领域包发布。它固定一个总体的成员穷尽规则，且不含
Record reader、路径或原始 payload。

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
}

type AnalysisSlot = ActiveAnalysisSlot | ExcludedAnalysisSlot;
```

每个 Selection 建立的 expected Slot 恰有一项。`excluded.base` 保存一次收窄前的状态，且不能再
嵌套另一个 `excluded`。`runs` 按 RunId 排序，`slots` 按 RunId、SlotId 排序。

Host 的 `explicit-runs` 选择保留具名 sealed Run 的全部 expected Slot。`project-current` 只保留
身份仍匹配当前目标的 Slot。精确 Run 或 Attempt locator 可以形成显式选择或 Evidence 目标，但它
只是身份，不是打开 Record 的能力。应用代码从不拿到 Record root。

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

## query 与 aggregate

`aggregate()` 为普通 Report 直接返回闭合行。它从 by 与 values 推断共同 Population，并在读取事实前
拒绝 population mismatch、无 Relation 的跨总体组合、identity collision 与无效请求。

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

`DomainViewRequest` 的 locator 必须属于 Sample 的选择。Trace、事件、Evidence、file diff 或 blob
只在相应请求执行时读取；`aggregate()` 从不因它们预加载重内容。

## MetricValue 真值表

```ts
interface MetricValue<Value = number> {
  readonly value: Value | null;
  readonly state:
    | "available"
    | "partial"
    | "empty"
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
| `empty` | null | `samples === total` | Measure 的领域结果合法为空，且没有缺失、unsupported 或失败问题 |
| `unsupported` | null | 没有可形成结果的 v1 输入 | host 或 producer 未提供该已发布输入，issues 说明能力缺口 |
| `failed` | null | 已贡献数可小于或等于 total | 读取、验证、relation、producer 或 reduction 出现阻断性失败 |

合法零值始终是 `available` 或 `partial` 的 `value: 0`，绝不是 `empty`。`samples` 只数实际贡献
value 的成员，`total` 只数该分组坐标中 Measure 已固定的预期成员。请求本身不合法时，操作以
`AnalysisRequestError` 拒绝；它不是一个伪造的 MetricValue。

```ts
interface AnalysisIssue {
  readonly code:
    | "missing"
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
}

interface SemanticFrame<By, Measures> {
  readonly kind: "semantic-frame";
  readonly sample: AnalysisSampleIdentity;
  readonly population: PopulationIdentity;
  readonly rows: ClosedRows<SemanticRow<By, Measures>>;
  readonly issues: readonly AnalysisIssue[];
}
```

`SemanticFrame.issues` 与 `rows.issues` 是同一份冻结列表。每一行有稳定 opaque key、已经形成的
Dimension 坐标，以及完整 `MetricValue` 单元。`ClosedRows` 只能由 Analysis 创建；普通数组即使
字段形状相同也不是闭合行。排序、limit 或 filter 产生的普通显示数组可以交给组件，却不能重新进入
Analysis 或声称保留原 rows identity。

`DomainView` 也只含稳定 identity、闭合树或时序、issues 与 refs。两种输出都不含 reader、Scope、
executor、Promise、callback、路径或原始 Record payload。

## Host Scope 与失败

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

`openSample()` 校验 Selection 属于传入 reader，并固定 Snapshot。它不读取未请求的 Attachment。
Scope 关闭后，`query()`、`aggregate()` 和 `narrowSample()` 都以 `AnalysisSampleClosedError` 失败；
实现必须在读取之前检测该状态。闭合输出和 SampleSnapshot 不含 capability，因而不受此错误影响。

Analysis executor、缓存与具体执行后端是 Host 实现。它们可以替换，但同一请求必须保持 value、state、
samples、total、basis、issues 与 refs 相同。
