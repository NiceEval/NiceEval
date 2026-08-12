# PLAN-2 Library

## Record session

CLI 直接把 root 与 selection 交给 host：

```ts
const execution = await runReport({
  root,
  selection: explicitRuns({ runIds }),
  report,
});
```

非 UI 脚本使用同一 callback boundary：

```ts
const rows = await withRecord(
  { root },
  async (record) => {
    const analysis = await record.select(explicitRuns({ runIds }));
    return analysis.attemptSlots({
      selectedRun: { evaluation: evaluations },
      attempt: { verdict },
      originRun: {},
    });
  },
);
```

```ts
interface RecordSession {
  readonly runs: readonly RecordRunSummary[];
  select(selection: RunSelection): Promise<AnalysisSession>;
}

interface AnalysisSession {
  readonly scope: AnalysisScopeValue;
  attemptSlots<Selected, Attempt, Origin>(input: {
    readonly selectedRun: Selected;
    readonly attempt: Attempt;
    readonly originRun: Origin;
  }): Promise<AttemptSlotValues<Selected, Attempt, Origin>>;
  selectedRuns<Fields>(fields: Fields): Promise<SelectedRunValues<Fields>>;
  gradingClaims<Fields>(
    selection: GradingClaimSelection,
    fields: Fields,
  ): Promise<GradingClaimValues<Fields>>;
}
```

`withRecord()` 与 `runReport()` 在内部使用 Effect Scope，并等待 callback settlement 后才关闭 reader。
Promise rejection 保留 package error object 与 Cause summary，但 TypeScript signature 无法像 Effect 一样
表达完整 error union。

`analysis.scope` 是 pure selected Runs、logical slots、states 与 denominator。Session methods 只使用
绑定的 frozen view，不打开第二个 reader。

## Typed aligned read

`attemptSlots()` 同时声明 selected Run、Attempt 与 origin Run fields。它按 logical slots 返回一份
穷尽 union，不让作者分别读取数组再 join。

Field 是 package-created typed value：

```ts
const energy = attachment(energyFamily, ({ value }) => value.payload.kwh);
```

Projection callback 同步执行。`allowUnavailable(score)` 只放宽 missing Attachment，仍保留完整六态。

与 PLAN-1 不同，`attemptSlots()` 在调用时立即开始 I/O 并返回 Promise。它不是惰性声明，也不能被 Page
收集成静态 dependency graph。

## Report loader

```ts
interface ReportSpec<Model> {
  readonly id: string;
  readonly load: (analysis: AnalysisSession) => Promise<Model>;
  readonly pages?: Readonly<Record<string, Page<Model>>>;
  readonly families?: Readonly<Record<string, PageFamily<Model, unknown>>>;
  readonly downloads?: Readonly<Record<string, Download<Model>>>;
}
```

Host 先按顶层 `selection` 建立 `AnalysisSession`，再调用 `load()` 一次。成功后固定 model，再逐个执行
Page、Family 与 Download。Model 可以是普通
named interface，不要求 JSON codec；它只在当前进程的 `ReportExecution` 中存活。

所有 renderer 同步。它们没有 RecordSession、path 或 Promise。Built-in Report 使用相同 loader；host
不注入 `evidence(locator)` 或 private reader。

## 官方 metrics

指标是普通总函数：

```ts
const quality = passRate(attempts);
const score = earnedScore(attempts);
```

`passRate()` 输入必须包含 selected Run Evaluation、Attempt execution Verdict 与 origin Run Evaluation。
返回 `MetricValue`，携带 state、coverage、unit、direction、logical evidence 与 reasons。

Historical grading 使用另一组普通函数：

```ts
const claims = await analysis.gradingClaims(
  explicitGradingRuns({ runIds: gradingRunIds }),
  { verdict: gradingVerdict, score: gradingScore },
);
const quality = gradingPassRate(claims);
```

`gradingClaims()` 绑定同一 frozen view，但不改变 Analysis 的 base population。不存在 latest claim 默认值。
