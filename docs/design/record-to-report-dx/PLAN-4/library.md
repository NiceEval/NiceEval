# PLAN-4 Library

## 共同的前两层

```ts
interface FrozenRecord {
  readonly runs: readonly RecordRunSummary[];
  select(selection: RunSelection): Effect.Effect<Analysis, SelectionError>;
}

interface Analysis {
  readonly population: Population;
  attemptSlots<Fields>(fields: Fields): Effect.Effect<AttemptRows<Fields>, ReadError>;
  selectedRuns<Fields>(fields: Fields): Effect.Effect<SelectedRunRows<Fields>, ReadError>;
}

declare const openRecord: (
  input: { readonly root: string },
) => Effect.Effect<FrozenRecord, OpenRecordError, Scope.Scope>;
```

`FrozenRecord` 固定读取视图与 migration owner；`Analysis` 固定 population。两者不能合成一个带可变
selection 的 session，也不能让一次 read 临时过滤后暗中改变 denominator。

## 三层 API

```ts
interface Report<Model> {
  readonly load: (analysis: Analysis) => Effect.Effect<Model, ReportLoadError>;
  readonly pages: Pages<Model>;
  readonly downloads?: Downloads<Model>;
}

const report = defineReport({
  load: Effect.fn(function* (analysis) {
    const rows = yield* analysis.attemptSlots(fields);
    return buildQualityModel(rows);
  }),
  pages,
});
```

`buildQualityModel()`、`passRate()` 和 `attemptDetails()` 是 ordinary pure functions。它们可以返回
带 state、coverage 与 lineage 的值，但 host 不理解函数内部结构。

## 四层 API

```ts
declare const DerivationOutput: unique symbol;

interface Derivation<A> {
  readonly identity: ExecutionLocalIdentity;
  readonly [DerivationOutput]: (_: A) => A;
}

declare const derive: <Inputs, Output>(input: {
  readonly from: Inputs;
  readonly compute: (inputs: Values<Inputs>) => Output;
}) => Derivation<Output>;

interface Report {
  readonly pages: PagesWithData;
  readonly downloads?: DownloadsWithData;
}
```

`Derivation` 只有在 executor 能用 execution-local identity 与 typed inputs 建立 dependency DAG、去重和
局部错误时才公开。Stable id、output Schema 与跨 execution cache 是可选扩展，不属于最小四层契约。
`compute` 不得打开 Record，也不得静默替换 Analysis 的 base population；它可以形成具名 subpopulation，
但必须保留 parent identity、排除理由、coverage 与 evidence。

## 顶层执行

```ts
declare const runReport: (input: {
  readonly root: string;
  readonly selection: RunSelection;
  readonly report: ReportLike;
}) => Effect.Effect<ReportExecution, ReportExecutionError>;
```

三层与四层共用顶层入口，使调用者不必管理 reader scope。差异保留在 Report authoring contract 和
executor 是否拥有 Derivation phase，不通过两个近似 CLI 暴露。
