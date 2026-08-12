# Report Query Library

本页定义 PLAN-1 的 `niceeval/report` 顶层作者调用面。所有 constructor 在模块求值时只创建不可执行的
声明；只有 Report host 能在 frozen Record selection 内执行 `ReportQuery`。

## Record 与 selection

```ts
declare const openRecord: (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<FrozenRecord, RecordOpenError, Scope.Scope>;

type RunSelection =
  | ReturnType<typeof explicitRuns>
  | ReturnType<typeof latestRuns>;

declare const selectRuns: (
  record: FrozenRecord,
  selection: RunSelection,
) => Effect.Effect<AnalysisScope, AnalysisSelectionError | RecordReadError>;
```

`AnalysisScope` 同时是 pure logical universe 与绑定当前 frozen Record 的 I/O capability。作者不能
从 pure rows 重新构造它。普通 Report module 不收到 `AnalysisScope`；脚本高级入口可以把它交给
`runQuery()`。

## 最小报告

官方 metric 自己拥有所需 query、grain、lineage、完整度策略与公式。作者不先声明 projection，
也不为 metric 传入一份可能缺字段的数据源。

```ts
const quality = metrics.execution.passRate();

export default defineReport({
  id: "quality-report",
  pages: {
    overview: page({
      route: "/",
      data: { quality },
      render({ data }) {
        return reportDocument({
          title: "Quality",
          children: [reportMetric(data.quality)],
        });
      },
    }),
  },
});
```

`id`、route 与 object key 都写普通字符串。`defineReport()` 在任何 Record I/O 前集中验证它们，
并返回能定位完整 object path 的 definition error。普通作者不调用 branded string constructor，
也不写 `Either.getOrThrow(reportComponentId(...))`。

## Opaque ReportQuery

```ts
declare const reportQueryTypeId: unique symbol;

interface ReportQuery<out Value> {
  readonly [reportQueryTypeId]: () => Value;
}
```

`ReportQuery` 没有 `compute()`、`run()`、reader 或 lazy fetch 方法。作者只能把它交给
Page、PageFamily、Download 的 `data`，或交给 `derive()` 形成另一条 query。

宿主仅按 package-created object identity 去重：

```ts
const quality = metrics.execution.passRate();

page({ data: { quality }, render });
download({ data: { quality }, build }); // 复用同一次 query

const anotherQuality = metrics.execution.passRate(); // 另一条 query
```

宿主不比较 query 结构、callback source 或闭包。query numeric ID 只属于一次 execution，不是
durable identity。

## Attachment field

Package 提供 built-in Attachment fields，例如 `assertions`、`verdict`、`score` 与
`evaluations`。自定义字段只有一个入口：

```ts
const energy = attachment(energyFamily, ({ value, owner }) => ({
  kwh: value.payload.kwh,
  attemptId: owner.attemptId,
}));
```

`project` 必须同步。它只读取当前 relation 的完整 immutable Attachment value 与 owner identity；
按 author contract，callback 只能读取已声明 inputs，不能读取其它 query、RecordReader 或 ambient Effect
service。Report module 仍是 trusted Node code，技术上可以 import filesystem/network；宿主不跟踪或阻止
这种副作用，因此参数收窄不是安全或完全确定性保证。

每个 addressable field 保留完整六态：

```ts
type AttachmentFieldResult<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "unavailable" }
  | { readonly state: "migration-required"; readonly command: string }
  | { readonly state: "migration-unavailable"; readonly reason: string }
  | { readonly state: "unsupported"; readonly schemaId: string }
  | { readonly state: "invalid"; readonly issues: readonly unknown[] };
```

`allowUnavailable(field)` 只声明 `unavailable` 对 generic completeness 是合法结构。它不把 property
变成 optional、`undefined` 或 `Option`，也不吞 migration、unsupported 或 invalid。

## Attempt logical slots

```ts
const assessment = attemptSlots({
  selectedRun: {
    evaluation: evaluations,
  },
  attempt: {
    assertions,
    verdict,
    score: allowUnavailable(score),
  },
  originRun: {
    evaluation: evaluations,
  },
});
```

三个 relation 区块不能互相替代：

- `selectedRun` 表示建立 logical slot universe 的 Run；
- `attempt` 表示 included Member 精确引用的 Attempt；
- `originRun` 表示该 Attempt 最初发布所在的 Run。

Run-owned field 必须放进 `selectedRun` 或 `originRun`，没有默认值。Attempt-owned field 只放进
`attempt`。类型系统拒绝错误 owner。

结果是穷尽 union：

```ts
type AttemptSlotRow<SelectedRunFields, AttemptFields, OriginRunFields> =
  | {
      readonly state: "excluded" | "not-recorded" | "core-invalid";
      readonly logical: LogicalSlotRef;
      readonly selectedRun: SelectedRunFields;
    }
  | {
      readonly state: "included";
      readonly logical: LogicalSlotRef;
      readonly selectedRun: SelectedRunFields;
      readonly attemptRef: RecordAttemptRef;
      readonly attempt: AttemptFields;
      readonly originRun: OriginRunFields;
    };

interface AttemptSlotValues<SelectedRunFields, AttemptFields, OriginRunFields> {
  readonly rows: readonly AttemptSlotRow<
    SelectedRunFields,
    AttemptFields,
    OriginRunFields
  >[];
  readonly denominator: number;
  readonly coverage: ReportQueryCoverage;
  readonly reasons: readonly ReportDataReason[];
}
```

selected Run fields 对所有 logical rows 可达。Attempt 与 origin Run 只有 included row 才可达；
其它 row 不伪造 owner 或 Attachment read。十个 slots 引用同一个 Attempt 时仍有十个 rows。

Raw grain query 永远返回穷尽值，不提供 `where`。作者可以用普通 TypeScript 分类 rows，但派生结果
必须保存原 denominator、未采用原因与 logical evidence。

## Derive

`derive()` 把一个或多个 query value 变成另一条 opaque query：

```ts
const assertionCoverage = derive({
  data: { assessment },
  completeness: "allow-partial",
  calculate({ data }) {
    return calculateAssertionCoverage(data.assessment);
  },
});
```

`derive()` callback 同步执行，不能依赖另一份 derived value 之外的未声明输入。query DAG 在 I/O
前检查 cycle 与数量限制。同一 query 每次 execution 最多执行一次。

Completeness 只属于 `derive()` 与官方 metric，不属于 Page、PageFamily 或 Download：

- `require-complete` 在 required input 不完整时不调用 `calculate`；
- `allow-partial` 把穷尽 rows、coverage 与 reasons 交给 `calculate`；
- query data-unavailable 或 execution-failed 时，不调用依赖它的 consumer；
- 需要显示 partial/unavailable 的页面消费一条把状态保留为普通领域值的 allow-partial query。

## Consumer-local data

Page、PageFamily 与 Download 各自在 `data` 中声明 query：

```ts
const quality = metrics.execution.passRate();

export default defineReport({
  id: "quality-report",
  pages: {
    overview: page({
      route: "/",
      data: { quality, assertionCoverage },
      render({ data }) {
        return overviewDocument(data);
      },
    }),
  },
  families: {
    attempts: pageFamily({
      data: { assessment },
      instances({ data }) {
        return attemptInstances(data.assessment);
      },
      key: ({ slot }) => logicalSlotKey(slot),
      route: ({ slot }) => attemptRoute(slot),
      render({ instance }) {
        return attemptDocument(instance);
      },
    }),
  },
  downloads: {
    summary: download({
      data: { quality },
      mediaType: "text/csv",
      build({ data }) {
        return qualityCsv(data.quality);
      },
    }),
  },
});
```

所有 callback 同步返回。Family 的 `data` 是整个 family 唯一依赖集合；`instances`、`key`、
`route` 与 `render` 都不能创建或执行 query。动态实例 key 来自 durable identity，不能用数组下标。

Parameterized Attempt page 使用同一形状。它在 family-level `data` 声明 Assertions、Verdict、Score
与 source query，再从 aligned logical rows 形成 instances。Instance render 只接收已经形成的
Attempt detail value：

```ts
const attemptDetails = derive({
  data: { assessment, source },
  completeness: "allow-partial",
  calculate: ({ data }) => detailsFrom(data.assessment, data.source),
});

const standardAttemptPages = pageFamily({
  data: { attemptDetails },
  instances: ({ data }) => data.attemptDetails.items,
  key: ({ slot }) => logicalSlotKey(slot),
  route: ({ slot }) => attemptRoute(slot),
  render: ({ instance }) => attemptDetailsDocument(instance),
});
```

官方 `standardAttemptPages` 也只能调用这些 public constructors。Host 不向它注入
`evidence(locator)`、RecordReader、private Projection result 或 legacy `AttemptEvidence`。需要新的
source 数据时，先定义公共 Attachment field 并把它加入 query；不能用空值、旧 evidence 回填或私有
读取维持官方页面。

固定 consumer 的 object key形成结构化 identity：`{ reportId, kind, key }`。不同 kind 使用独立
namespace。route 与 component identity 分开校验。

## 官方 metrics

官方入口区分 execution-time claim 与后续 grading claim：

```ts
declare const gradingClaims: <Fields>(input: {
  readonly selection: GradingClaimSelection;
  readonly fields: Fields;
}) => ReportQuery<GradingClaimRows<Fields>>;

const selectedGradingClaims = gradingClaims({
  selection: explicitGradingRuns({ runIds: gradingRunIds }),
  fields: { verdict: gradingVerdict, score: gradingScore },
});

const executionPassRate = metrics.execution.passRate();
const gradingPassRate = metrics.grading.passRate({
  claims: selectedGradingClaims,
});
```

`gradingClaims()` 在同一个 frozen view 中查询 claim-producing Runs，但不改变 Analysis 的 base
population。不存在无限定的 `metrics.passRate()`，也不自动选择 latest grading claim。

Execution pass rate 使用 selected Run Evaluation 决定每个 logical slot 的 evaluation kind 与
denominator。Attempt-owned Verdict 提供 execution-time claim。Origin Run Evaluation 只校验
reference provenance；selected 与 origin 不兼容时返回 reason，不能静默选择一边。

```ts
interface MetricValue<Value> {
  readonly state: "complete" | "partial" | "unavailable";
  readonly value: Value | null;
  readonly coverage: {
    readonly observed: number;
    readonly denominator: number;
  };
  readonly unit: MetricUnit;
  readonly direction: "higher-is-better" | "lower-is-better" | "neutral";
  readonly evidence: readonly {
    readonly slot: LogicalSlotRef;
    readonly attempt?: RecordAttemptRef;
    readonly contribution: MetricContribution;
  }[];
  readonly reasons: readonly MetricReason[];
}
```

Evidence 以 logical slot occurrence 为主，并附带物理 Attempt ref。物理读取去重不能把多个 logical
contributions 折成一个。显示 label 由 Page 或组件提供，不进入 metric 语义。

任意 query value 不自动进入公开 JSON，也不增加 codec 约束。机器可读结果由作者显式声明 JSON
或 CSV Download；若未来需要独立结构化输出，新增 output consumer，而不是恢复全局 Calculation
registry。
