# Analysis Library

本页是 niceeval/analysis 的唯一公共契约。它定义字段声明、冻结样本上的查询，以及交给 Report 的闭合结果。

完整使用路径见 [Use case](use-case/README.md)。内部执行边界见 [Analysis](README.md)。

## 公共入口

```ts
import {
  defineDimension,
  defineMeasure,
  definePopulation,
  defineRelation,
  query,
} from "niceeval/analysis";
```

| 对象 | 公开职责 |
|---|---|
| AnalysisInput | NiceEval 发布的只读 typed input；作者只能选择，不能构造 |
| Population | 声明可分析成员及其稳定成员 identity |
| Dimension | 在一个总体内给出分组或稳定标识值 |
| Measure | 声明输入、三段归并、分母、缺失与证据口径 |
| Relation | 显式连接两个总体的成员 |
| AnalysisQuerySource | host（宿主）签发的不透明查询句柄；不能由作者构造 |
| AnalysisSampleSummary | 已固定选择、总体命中范围和问题的只读摘要；不是查询能力 |
| query | 唯一公开查询操作，返回 SemanticFrame 或 DomainView |

query() 是唯一公开查询名。niceeval/analysis 不导出 analyze() 或 aggregate()，因此不会出现两个名称各自暗示不同统计口径的情况。

## 一个指标怎样从 Record 计算出来

Analysis 不枚举 Record 物理表。NiceEval 内部把当前 attachment schema 投影成 Measure（度量）需要的 `AnalysisInput`；公共 SDK 只导出已发布的输入句柄，不导出 projector（投影器）或 attachment。

| Analysis input | 从 ① Record 读取什么 | 给 Measure 的值 |
|---|---|---|
| `attemptPassed` | Attempt-owned Assertions / Verdict attachment | `boolean` |
| `attemptLatencyMs` | Attempt-owned OTel attachment 中被该投影采用的 span 时长 | `number`，单位 ms |
| `attemptToolFailure` | Attempt-owned event attachment 中受支持的 tool failure | `boolean` |

Analysis 作者直接引用 NiceEval 发布的输入：

```ts
import {
  attemptPassed,
  attemptLatencyMs,
  attemptToolFailure,
} from "niceeval/analysis/inputs";
```

这些值是 opaque definition（不透明定义）。作者知道它们给 Measure 的类型和语义，但不能从中取得 Record reader、attachment identity、原始 payload 或磁盘路径。

一个通过率指标先声明完整口径，再由 `query()` 对冻结选择中的多个 Run 计算：

```ts
const passRate = defineMeasure({
  id: "niceeval.pass-rate",
  population: logicalSlots,
  input: attemptPassed,
  withinAttempt: oneValue<boolean>(),
  withinSlot: latestCompletedAttempt<boolean>(),
  acrossSlots: ratio(),
  denominator: allLogicalSlots(),
  missing: partial(),
  evidence: retainContributingEvidence(),
});

const frame = await query(source, {
  kind: "frame",
  population: logicalSlots,
  by: { model, condition },
  measures: { passRate },
});
```

`defineMeasure()` 定义算法，`query()` 执行算法，`SemanticFrame` 是闭合结果。三者都不写 Record。每个结果单元保留 `value`、`state`、`observed`、`denominator`、`issues` 和 `refs`。

## Population

Population 是具名、nominal 的成员集合。它的成员说明分析 grain；它的 identity 说明同名字符串不能替代同一个总体。

```ts
interface Population<Member> {
  readonly kind: "population";
  readonly id: PopulationId;
  readonly members: PopulationMembers<Member>;
}

interface PopulationMembers<Member> {
  readonly kind: "population-members";
  readonly id: PopulationMembersId;
}

declare function definePopulation<Member>(options: {
  readonly id: string;
  readonly members: PopulationMembers<Member>;
}): Population<Member>;
```

PopulationMembers 是平台或领域包发布的受控成员描述。它没有公开构造器，也不提供 Record reader、路径或 Attachment payload。

逻辑 slot 是标准总体的一个例子：

```ts
interface LogicalSlot {
  readonly identity: LogicalSlotIdentity;
  readonly model: string;
  readonly condition: string;
}

declare const logicalSlotMembers: PopulationMembers<LogicalSlot>;

export const logicalSlots = definePopulation({
  id: "niceeval.logical-slots",
  members: logicalSlotMembers,
});
```

一个 Population 的成员穷尽规则由它的 members 描述固定。查询不能用数组过滤、回调过滤或另一次读取悄悄改变该集合。

## Dimension

Dimension 只属于一个 Population。它把该总体中的一个成员映射为可分组或稳定标识的值，不跨总体寻找成员。

```ts
interface Dimension<Member, Value extends DimensionValue> {
  readonly kind: "dimension";
  readonly id: DimensionId;
  readonly population: Population<Member>;
}

declare function defineDimension<Member, Value extends DimensionValue>(
  options: {
    readonly id: string;
    readonly population: Population<Member>;
    readonly value: (member: Member) => Value;
  },
): Dimension<Member, Value>;
```

value 回调只接收该 Population 发布的 Analysis member。它不能取得未解释的 Record 载荷，也不能读取其它 member 或其它样本。

~~~ts
export const model = defineDimension({
  id: "niceeval.model",
  population: logicalSlots,
  value: slot => slot.model,
});

export const condition = defineDimension({
  id: "niceeval.condition",
  population: logicalSlots,
  value: slot => slot.condition,
});
~~~

## Measure

Measure 在一个 Population 上一次声明完整统计口径。它不返回未包装的 number；每次查询都返回带状态、分母、问题和证据引用的 MeasureResult。

```ts
interface Measure<Member, Value> {
  readonly kind: "measure";
  readonly id: MeasureId;
  readonly population: Population<Member>;
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
}

interface AnalysisInput<Member, Input> {
  readonly kind: "analysis-input";
  readonly population: Population<Member>;
  readonly id: AnalysisInputId;
  readonly [AnalysisInputTypeId]: (_: Input) => Input;
}

declare const attemptPassed: AnalysisInput<LogicalSlot, boolean>;

declare const attemptLatencyMs: AnalysisInput<LogicalSlot, number>;

declare const attemptToolFailure: AnalysisInput<LogicalSlot, boolean>;

interface MeasureOptions<
  Member,
  Input,
  AttemptValue,
  SlotValue,
  Value,
> {
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

declare function defineMeasure<
  Member,
  Input,
  AttemptValue,
  SlotValue,
  Value,
>(
  options: MeasureOptions<Member, Input, AttemptValue, SlotValue, Value>,
): Measure<Member, Value>;
```

`AnalysisInput` 的公共类型没有构造器。NiceEval 内部的 `publishAnalysisInput()` 才能绑定 attachment projector；该函数不从 package 导出。用户可以选择已发布输入并定义新的统计口径，但不能借此枚举 attachment、选择任意字段或改变 Record selection（事实选择）。

### 三段归并

| 阶段 | 输入成员 | 必须决定的事 | 保留的信息 |
|---|---|---|---|
| withinAttempt | 一个 Attempt 内的有限输入值 | 怎样把同一 Attempt 的多个值归成一个 Attempt 值 | state、observed、issues、refs |
| withinSlot | 一个 logical slot 的多个 Attempt 值 | 选哪次 Attempt，或怎样合并重试 | state、observed、issues、refs |
| acrossSlots | 同一分组坐标中的 logical slot 值 | 怎样计算平均值、比例、总和或其它最终读数 | value、state、observed、denominator、issues、refs |

这三个阶段按固定顺序运行。任何阶段都不能把只剩 scalar 的中间值重新包装为完整 MeasureResult。

标准 reducer 的调用形状如下：

```ts
declare function oneValue<Value>(): WithinAttemptReduction<Value, Value>;
declare function sum(): WithinAttemptReduction<number, number>;
declare function latestCompletedAttempt<Value>(): WithinSlotReduction<Value, Value>;
declare function mean(): AcrossSlotsReduction<number, number>;
declare function ratio(): AcrossSlotsReduction<boolean, number>;
```

### 分母与缺失

denominator 指定每个分组坐标中应计入的 logical slot。它在读取可用值前固定，因此不会因为缺失、失败或显示筛选而变小。

```ts
declare function allLogicalSlots<Member>(): Denominator<Member>;
declare function partial(): MissingPolicy;
```

partial() 在至少一个成员贡献值且另一些成员缺失时产生 partial。它保留已贡献值形成的 value，并把贡献数量放入 observed，把预期数量放入 denominator。

没有贡献值时，Measure 根据输入状态产生 empty、unavailable 或 failed。合法零值仍是 available，value 为 0，不能被写成 empty。

### Evidence 口径

EvidencePolicy 决定归并后哪些精确 EvidenceRef 必须随结果保留。标准策略只保留参与 value、缺失判断或失败判断的成员引用，并按稳定 identity 去重。

```ts
declare function retainContributingEvidence(): EvidencePolicy;
declare function requireSameProducer(): ProducerPolicy;
```

refs 不含证据内容，只含精确引用。issues 必须保留未贡献成员、producer 不兼容或宿主不支持等原因及其相关引用。

producer policy 同样属于 Measure 口径。requireSameProducer() 在同一读数混入不同 producer identity 时拒绝计算，而不是把不同采集行为当成同一数值。

### 示例

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

export const latency = defineMeasure({
  id: "niceeval.latency-ms",
  population: logicalSlots,
  input: attemptLatencyMs,
  withinAttempt: sum(),
  withinSlot: latestCompletedAttempt<number>(),
  acrossSlots: mean(),
  denominator: allLogicalSlots(),
  missing: partial(),
  evidence: retainContributingEvidence(),
  unit: "ms",
  format: "duration",
  better: "lower",
});
```

`attemptPassed`、`attemptLatencyMs` 与 `attemptToolFailure` 是 NiceEval 发布的输入。若缺少某种原始事实或投影，应先演进 NiceEval 的 Record 与 input catalog（输入目录），而不是让项目代码注册新的持久定义。

## Relation

Relation 是两个 Population 之间具名、纯的成员关系。跨总体的字段组合必须引用 Relation，不能按 label、数组位置、时间接近或数值容差猜测对应成员。

```ts
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

interface RelationTarget<Member> {
  readonly identity: PopulationMemberIdentity<Member>;
}
```

match 只使用两端 Population 已发布的稳定身份。没有可验证 target、关系不满足 cardinality 或同一成员出现歧义时，查询返回 issue，不自行选择一个成员。

## AnalysisQuerySource 与 query

`AnalysisQuerySource`（分析查询句柄）是 `query()` 唯一接受的不透明 capability（能力）。Analysis Host 从当前 Record snapshot（事实快照）签发它；作者不能构造、复制或从文件路径恢复它。它绑定一次冻结 snapshot、selection（选择）、executor（执行器）与 execution cache（执行缓存），并随 operation Scope（操作资源作用域）关闭而失效。

```ts
declare const AnalysisQuerySourceTypeId: unique symbol;

interface AnalysisQuerySource {
  readonly [AnalysisQuerySourceTypeId]: true;
}

interface AnalysisSampleSummary {
  readonly identity: AnalysisSampleIdentity;
  readonly selection: AnalysisSelectionSummary;
  readonly populations: readonly FrozenPopulationSummary[];
  readonly issues: readonly AnalysisIssue[];
}

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

interface DomainViewRequest<View extends DomainView> {
  readonly kind: View["kind"];
  readonly target: DomainViewTarget;
}

declare function query<Member, By, Measures>(
  source: AnalysisQuerySource,
  request: FrameQuery<Member, By, Measures>,
): Promise<SemanticFrame<By, Measures>>;

declare function query<View extends DomainView>(
  source: AnalysisQuerySource,
  request: DomainViewQuery<View>,
): Promise<View>;
```

`AnalysisQuerySourceTypeId` 的构造能力不从 package（包）导出。公开类型只让 TypeScript 验证句柄由 NiceEval host 签发；它没有可读字段，也不提供成员枚举、Record root、reader、锁或任意查询方法。`AnalysisSampleSummary` 可以显示选择和整体问题，但不能传给 `query()`。

FrameQuery 中的 by 和 measures 必须属于同一 Population，或由显式 Relation 连接到目标 Population。query() 在执行前检查这一点，并在不合法时返回明确的 Analysis error。

DomainViewRequest 是官方领域包发布的受控诊断请求。作者传入 exact identity 或 ref，不能用路径、任意 predicate 或 raw payload 生成诊断视图。

## 闭合输出

SemanticFrame 是表格、比较和图形的闭合输入。

```ts
interface SemanticFrame<By, Measures> {
  readonly kind: "semantic-frame";
  readonly sample: AnalysisSampleIdentity;
  readonly population: PopulationIdentity;
  readonly rows: readonly SemanticRow<By, Measures>[];
  readonly issues: readonly AnalysisIssue[];
}

interface SemanticRow<By, Measures> {
  readonly key: SemanticRowKey;
  readonly dimensions: DimensionValues<By>;
  readonly measures: MeasureValues<Measures>;
}

interface MeasureResult<Value> {
  readonly value: Value | null;
  readonly state:
    | "available"
    | "partial"
    | "empty"
    | "unavailable"
    | "failed";
  readonly observed: number;
  readonly denominator: number;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
  readonly producerCompatibility: ProducerCompatibility;
}

interface AnalysisIssue {
  readonly code:
    | "missing"
    | "unsupported"
    | "producer-incompatible"
    | "producer-failed"
    | "relation-unmatched"
    | "invalid-input";
  readonly message: string;
  readonly refs: readonly EvidenceRef[];
}

interface EvidenceRef {
  readonly identity: EvidenceIdentity;
}

interface ProducerCompatibility {
  readonly state: "compatible" | "incompatible";
  readonly issues: readonly AnalysisIssue[];
}
```

available 表示分母内成员都按该 Measure 的规则贡献值。partial 表示部分成员贡献值；empty 表示完整的领域空值；unavailable 表示宿主无法提供所需输入；failed 表示输入或归并失败。

observed 永远是实际贡献到 value 的成员数。denominator 永远是该 Measure 在该分组坐标中的预期成员数。issues 说明缺失、unsupported、producer 不兼容或关系异常；refs 指向支撑 value 或问题的精确 Evidence。

DomainView 保留不能压成表格的诊断结构。

```ts
type DomainView =
  | TraceView
  | AttemptTimelineView
  | EvidenceView;

interface ClosedDomainView {
  readonly identity: DomainViewIdentity;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
}

interface TraceView extends ClosedDomainView {
  readonly kind: "trace";
  readonly root: TraceSpanView;
}

interface AttemptTimelineView extends ClosedDomainView {
  readonly kind: "attempt-timeline";
  readonly events: readonly TimelineEventView[];
  readonly completion: AttemptCompletionView;
}

interface EvidenceView extends ClosedDomainView {
  readonly kind: "evidence";
  readonly entries: readonly EvidenceEntryView[];
}
```

两个输出都只含可序列化的值、稳定 identity、问题与引用。它们不保留 reader、执行器、回调、Promise 或 Record payload。

## 内部边界

Application Host 只能通过 `niceeval/analysis/host` 的 `analysis.openSource()` 把 ① Record 的当前冻结快照变成 ② Analysis 的不透明查询能力：

```ts
interface AnalysisSession {
  readonly source: AnalysisQuerySource;
  readonly sample: AnalysisSampleSummary;
}

interface AnalysisHostSDK {
  openSource(input: {
    readonly snapshot: CurrentRecordSnapshot;
    readonly selection: AnalysisSelection;
  }): Effect.Effect<AnalysisSession, AnalysisSourceError, Scope.Scope>;
}
```

`openSource()` 在传入 Scope（资源作用域）内完成选择、当前 schema 校验和总体冻结。`AnalysisQuerySource` 只在该 Scope 内有效；Scope 外只能保留 `AnalysisSampleSummary` 和 query 的闭合输出，不能保留 source。它不把 `CurrentRecordSnapshot`、reader 或 Scope 放进闭合结果。

QueryPlan、AnalysisExecutor 和 DuckDB 是 host 内部对象。QueryPlan 只包含编译后的字段、关系、归并与证据步骤；它不包含 SQL、组件属性或 renderer 配置。

AnalysisExecutor 可以使用 TypeScript 或 DuckDB 完成相同计划。任何后端替换都必须逐项保持 value、state、observed、denominator、issues 和 refs 相等。

没有公共 raw Record access。应用代码不能绕过 Population、Measure 或 query() 直接读取持久载荷，再自行计算比例、平均值或分母。
