# Reports Library

本页是 `niceeval/report`、`niceeval/report/host` 与 `niceeval/report/host/node` 的目标契约 owner。Report 把一份 reader-bound `AnalysisSampleHandle` 变成一次 immutable、self-contained `ReportExecution`；终端、热重载网页与静态导出只消费 execution，不重新读取 Record 或调用作者代码。

依赖方向固定为：

```text
niceeval/record
      ↓
niceeval/analysis
      ↓
niceeval/projection
      ↓
niceeval/report
      ↓
niceeval/report/host
      ↓
niceeval/report/host/node
```

Report 作者只理解两件事：需要哪些 `RecordProjection`，以及怎样把 projected values / derived values 包装成页面或下载。作者 callback 看不到 `RecordReader`、root、Scope、Effect、path、owner lookup、compiled plan 或 route expansion。

## 最小作者调用面

```ts
import { Effect, Either } from "effect";

const verdicts = attemptSlotProjection(verdictProjector);
const evaluations = selectedRunProjection(evaluationsProjector);
const passInputs = reportInputs({ verdicts, evaluations });

const passRate = defineCalculation({
  id: Either.getOrThrow(reportComponentId("pass-rate")),
  inputs: passInputs,
  completeness: "allow-partial",
  calculate: ({ sample, inputs }) =>
    calculatePassRate(sample, inputs.verdicts, inputs.evaluations),
});

const overview = definePage({
  id: Either.getOrThrow(reportComponentId("overview")),
  route: Either.getOrThrow(reportRoute("/")),
  calculations: { passRate },
  render: ({ calculations }) => {
    const result = calculations.passRate;
    return reportDocument({
      title: "Summary",
      children: [
        reportMetric({
          label: "Pass rate",
          value: result.state === "available" ? result.value.rate : null,
        }),
      ],
    });
  },
});

export default defineReport({
  id: Either.getOrThrow(reportId("summary")),
  calculations: { passRate },
  pages: [overview],
});
```

公开领域对象只叫 `Report`。`ReportDefinition` 不存在于 public API；`ReportPlan`、`ReportInput`、binding、matrix、prepare、materialize 与 route expansion receipt 都是 host 编译机械，不进入作者签名、教程或 Concepts。

## 数据计划

Report 直接复用 [Projection Library](../projection/library.md) 的声明与穷尽结果。`reportInputs` 把具名 projection 形状变成 `ReportDataPlan`，并让每个 key 精确推导出 `ProjectedSample<Access, Value>`：

```ts
type AnyRecordProjection = RecordProjection<any, any>;

declare const ReportDataPlanTypeId: unique symbol;

interface ReportDataPlan<
  out Shape extends Readonly<Record<string, AnyRecordProjection>> =
    Readonly<Record<string, AnyRecordProjection>>,
> {
  readonly [ReportDataPlanTypeId]: { readonly _Shape: () => Shape };
}

declare const reportInputs: <
  const Shape extends Readonly<Record<string, AnyRecordProjection>>,
>(shape: Shape) => ReportDataPlan<Shape>;

type ReportDataShape<Plan extends ReportDataPlan> =
  Plan extends ReportDataPlan<infer Shape> ? Shape : never;

type ReportProjectedValues<Plan extends ReportDataPlan> = {
  readonly [Key in keyof ReportDataShape<Plan>]:
    ReportDataShape<Plan>[Key] extends RecordProjection<infer Access, infer Value>
      ? ProjectedSample<Access, Value>
      : never;
};
```

`any` 只用于 package declaration 内部表达 existential `RecordProjection`；作者 callback 的每个 key 仍精确推导 `Access` 与 `Value`。普通 named interface 不需要 index signature、显式 generic 或 `as`。

`reportInputs` 是输入 key 的唯一 constructor。Key 满足 `[a-z][a-z0-9_-]*` 且 UTF-8 最多 64 bytes；constructor 拒绝 symbol、accessor、non-plain object 与非法 key。返回 plan 由 package-private WeakMap 持有 projection objects，不能靠复制 brand 伪造；host 从 canonical plan 生成 bounded numeric `ReportProjectionId`。

三个 factory 的基数分别是：

- `attemptSlotProjection(projector)`：对 `sample.slots` 每项一条；
- `attemptOriginRunProjection(projector)`：仍是每个 slot 一条，只把 included slot 的 owner 定位为该 Attempt 的 origin Run；
- `selectedRunProjection(projector)`：对 `sample.runs` 每项一条。

excluded、not-recorded 与 core-invalid 不会从 projected sample 消失。十个 slot 指向同一 origin Run 时仍有十条公开 logical entries；物理去重只属于 host telemetry。

每个 `RecordAttachmentProjector` 解释一个 owner 类型与一个 `RecordAttachmentFamily`。Projector callback 只在 Attachment `available` 时执行，同步消费完整 `RecordAttachmentValue` 并返回 view value，不能执行额外 Record I/O。callback throw 在 direct API 是 defect。Report host 在消费边界把它记为引用该 projection 的 consumer 的 execution problem，其它页面继续。

`ProjectedSample<Access, Value>` 只有两个 generic 参数：`sample`、`access`、`entries` 与 `coverage`。Attachment result 使用 `ProjectedRecordAttachmentResult<Value>` 的六态 union。

六态是 available、unavailable、migration-required、migration-unavailable、unsupported 与 invalid；available 保存 projector 从完整 Attachment 值返回的 view value。host 不引入第三个 failure generic、output codec 或 portable envelope。

`migration-required` 只表示存在相邻 converter 的完整迁移链，command 提示运行 `niceeval migrate`。`migration-unavailable` 表示旧 schema 的已知路径碰到 `not-losslessly-migratable`，明确没有无损 converter。因此它不提示再次运行 `niceeval migrate`，只呈现 reason；二者不能混淆。

## Report、Calculation 与组件

```ts
interface Report {
  readonly id: ReportId;
  readonly calculations: ReportCalculationSet;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads: readonly ReportDownload[];
}

declare const defineReport: (definition: {
  readonly id: ReportId;
  readonly calculations?: ReportCalculationSet;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads?: readonly ReportDownload[];
}) => Report;
```

`defineReport` 校验 ID 唯一性，并验证 Page / PageFamily / Download 引用的 Calculation object 都在同一个 Report 的 `calculations` 中注册。引用按 object identity，不按 string lookup；作者不能在 callback 中动态增加 Calculation 或 I/O。

### Completeness

```ts
type ReportCompleteness = "allow-partial" | "require-complete";
```

任何直接消费 `RecordProjection` 的 Calculation、Page、PageFamily 或 Download 都必须显式声明 completeness：

- `require-complete`：任一 required projected input 不完整时不调用作者 callback，形成 `data-unavailable` result。不完整包括 not-recorded、core-invalid、unavailable、migration-required、migration-unavailable、unsupported 与 invalid；
- `allow-partial`：调用 callback，交付穷尽 `ProjectedSample`、coverage 与 issues；host-owned problems surface 仍保留全部问题；
- projection callback throw 不是 partial data。Calculation、fixed Page 与 Download 不执行。`allow-partial` PageFamily 仍可收到穷尽 entries，只从成功的 `attachment-result` 展开实例，但 family/execution problem 不可隐藏，零实例也必须可见。static export 对任一 execution problem fail closed；
- 只消费 `ReportCalculationResult` 的组件总是收到 result union，可以呈现 unavailable，不把它改名为 execution failure。

### Calculation

Calculation 只从静态声明的 projections 派生一个值，不依赖另一个 Calculation。复用公式使用普通纯函数。

```ts
interface ReportCalculation<Inputs extends ReportDataPlan, out Value> {
  readonly id: ReportComponentId;
  readonly inputs: Inputs;
  readonly completeness: ReportCompleteness;
  readonly calculate: (context: {
    readonly sample: AnalysisSample;
    readonly inputs: ReportProjectedValues<Inputs>;
  }) => Value;
}

type AnyReportCalculation = ReportCalculation<any, any>;
type ReportCalculationSet = Readonly<Record<string, AnyReportCalculation>>;

type ReportCalculationResults<Set extends ReportCalculationSet> = {
  readonly [Key in keyof Set]:
    Set[Key] extends ReportCalculation<any, infer Value>
      ? ReportCalculationResult<Value>
      : never;
};

declare const defineCalculation: <
  Inputs extends ReportDataPlan,
  Value,
>(definition: {
  readonly id: ReportComponentId;
  readonly inputs: Inputs;
  readonly completeness: ReportCompleteness;
  readonly calculate: (context: {
    readonly sample: AnalysisSample;
    readonly inputs: ReportProjectedValues<Inputs>;
  }) => Value;
}) => ReportCalculation<Inputs, Value>;
```

`Value` 没有 JSON、codec 或 portability 约束。普通 named interface 可以直接作为结果；execution 在进程内保存原值，host 不重新编码。Callback throw 形成 `calculation-callback-defect`，不是 unavailable、invalid 或 data-unavailable；interruption 保持 Cause。

```ts
interface ReportDataState {
  readonly state: "complete" | "partial";
}

type ReportCalculationResult<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
      readonly inputState: ReportDataState;
    }
  | {
      readonly state: "data-unavailable";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    }
  | {
      readonly state: "execution-failed";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };
```

`inputState` 只声明 required inputs 是否完整，不携带分母。业务 `observed` / `denominator` 属于 Calculation value；host 不从 coverage、entry 数或 access count 推导。

组件共享同一个 context 形状：

```ts
type ReportComponentContext<
  Inputs extends ReportDataPlan | {} = {},
  Calculations extends ReportCalculationSet = {},
> = {
  readonly sample: AnalysisSample;
  readonly inputs: Inputs extends ReportDataPlan
    ? ReportProjectedValues<Inputs>
    : {};
  readonly calculations: ReportCalculationResults<Calculations>;
};
```

### Fixed Page

```ts
declare const definePage: {
  <Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly route: ReportRoute;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly render: (
      context: ReportComponentContext<{}, Calculations>,
    ) => ReportDocumentV1;
  }): ReportPage;

  <Inputs extends ReportDataPlan, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly route: ReportRoute;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly render: (
      context: ReportComponentContext<Inputs, Calculations>,
    ) => ReportDocumentV1;
  }): ReportPage;
};
```

Fixed Page 的 route 在任何 I/O 前已知。若 `inputs` 非空，TypeScript overload 要求 `completeness`；只消费 Calculation 时不要求虚假的 completeness。

### PageFamily

PageFamily 可以用它静态声明的 projected values 和已注册 Calculation results 纯内存展开动态 route，但不能请求新 I/O。

```ts
declare const definePageFamily: {
  <Instance, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly instances: (
      context: ReportComponentContext<{}, Calculations>,
    ) => Iterable<Instance>;
    readonly key: (instance: Instance) => ReportInstanceKey;
    readonly route: (instance: Instance) => ReportRoute;
    readonly render: (
      context: ReportComponentContext<{}, Calculations> & {
        readonly instance: Instance;
      },
    ) => ReportDocumentV1;
  }): ReportPageFamily;

  <Inputs extends ReportDataPlan, Instance, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly instances: (
      context: ReportComponentContext<Inputs, Calculations>,
    ) => Iterable<Instance>;
    readonly key: (instance: Instance) => ReportInstanceKey;
    readonly route: (instance: Instance) => ReportRoute;
    readonly render: (
      context: ReportComponentContext<Inputs, Calculations> & {
        readonly instance: Instance;
      },
    ) => ReportDocumentV1;
  }): ReportPageFamily;
};
```

标准用法包括：每个 Assertion 一页、每个 conversation turn / tool call 一页，以及先由 Calculation 聚合 diagnostics category、再由 PageFamily 展开分类页。Assertion 页的 route 依赖 Assertions Attachment 的 durable `entryId`。若坏 payload 无法提供 durable item key，host 只能保留列表页与问题，不能用数组下标伪造稳定 detail route。

`Instance` 是进程内私有值，不要求 `{ key }` 或 portability；`key(instance)` 单独提供稳定 identity。`key` / `route` callback throw 与 duplicate key 都形成具名 execution problem。family 即使产生零个 instance，也必须在 `ReportExecution.families` 留一条 result；作者不能靠 `flatMap` 或空 family 让坏输入从内建 problems surface 消失。

### Download

```ts
interface ReportDownloadFile {
  readonly path: ReportDownloadPath;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

declare const defineDownload: {
  <Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly build: (
      context: ReportComponentContext<{}, Calculations>,
    ) => Iterable<ReportDownloadFile>;
  }): ReportDownload;

  <Inputs extends ReportDataPlan, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly build: (
      context: ReportComponentContext<Inputs, Calculations>,
    ) => Iterable<ReportDownloadFile>;
  }): ReportDownload;
};
```

Download bytes 在 execution 中自包含，随静态站一起写出。

## 路由、实例 key 与静态路径

```ts
declare const ReportIdTypeId: unique symbol;
declare const ReportComponentIdTypeId: unique symbol;
declare const ReportRouteTypeId: unique symbol;
declare const ReportInstanceKeyTypeId: unique symbol;
declare const ReportDownloadPathTypeId: unique symbol;

type ReportId = string & { readonly [ReportIdTypeId]: true };
type ReportComponentId = string & { readonly [ReportComponentIdTypeId]: true };
type ReportRoute = string & { readonly [ReportRouteTypeId]: true };
type ReportInstanceKey = string & { readonly [ReportInstanceKeyTypeId]: true };
type ReportDownloadPath = string & { readonly [ReportDownloadPathTypeId]: true };

type ReportPathIssue = {
  readonly code: "report-path-invalid";
  readonly kind: "report-id" | "component-id" | "route" | "instance-key" | "download";
  readonly reason: string;
};

declare const reportId: (input: string) => Either.Either<ReportId, ReportPathIssue>;
declare const reportComponentId: (input: string) => Either.Either<ReportComponentId, ReportPathIssue>;
declare const reportRoute: (input: string) => Either.Either<ReportRoute, ReportPathIssue>;
declare const reportInstanceKey: (input: string) => Either.Either<ReportInstanceKey, ReportPathIssue>;
declare const reportDownloadPath: (input: string) => Either.Either<ReportDownloadPath, ReportPathIssue>;

declare const reportInstanceKeyFromRecordId: (input: {
  readonly kind: "run" | "attempt" | "slot";
  readonly value: RunId | AttemptId | SlotId;
}) => ReportInstanceKey;

declare const reportRouteFromKeys: (
  keys: readonly [ReportInstanceKey, ...ReportInstanceKey[]],
) => Either.Either<ReportRoute, ReportPathIssue>;
```

Route 是 `/`，或 `/` 加 1–32 个 lowercase ASCII segments。Download 是相同语法的 relative segments。Segment 满足 `[a-z0-9][a-z0-9._~-]*`，最多 128 bytes，整条最多 1,024 bytes。它拒绝 percent、query、fragment、backslash、空 segment、`.`、`..`、尾随 `/`、尾点/空格，以及 Windows device name。

Report / component ID 与 Instance key 满足 `[a-z0-9][a-z0-9_-]*`，最多 128 bytes；纯十进制 ordinal 非法，不能用数组下标冒充 durable identity。所有 definition arrays 与结果表按 branded ID 的 UTF-8 bytes 排序；同 ID 冲突在任何作者 callback 前返回 definition invalid，不能依赖 JavaScript object iteration order。

Record 的 `RunId` / `AttemptId` / `SlotId` 不能直接拼入 lowercase route。`reportInstanceKeyFromRecordId` 使用 `run-` / `attempt-` / `slot-` domain tag 加可逆 lowercase Crockford；decode/display 仍恢复并显示原 Record ID。`reportRouteFromKeys` 是唯一把这些 key 组成 route 的 public adapter。Assertions Attachment 的 durable `entryId` 经同一 adapter 进入 per-Assertion route。

Static mapping 唯一且跨平台：

```text
/           → index.html
/a/b        → a/b/index.html
download x  → downloads/x
```

Route outputs、downloads、host-data、built-in runtime 与 manifest 进入同一个 collision set。Host 拒绝 exact collision、ASCII case-fold collision、file/directory prefix collision、Windows device / trailing-dot-space collision 与长度超限。

Static link 不直接写 semantic `/a/b`。Host codec 从当前页面 output 的 POSIX dirname 到 target output file 计算 relative path，separator 固定 `/`，并始终显式包含 `index.html`。Host files 使用保留 namespace `_niceeval`，不属于 author route grammar。

## Closed semantic report tree

页面返回闭合语义树，不返回任意 JSON、HTML、DOM、React element、CSS 或 parallel `textAlternative`。

```ts
type ReportScalarV1 = null | boolean | number | string;

type ReportInlineV1 =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "code"; readonly value: string }
  | { readonly type: "emphasis"; readonly children: readonly ReportInlineV1[] }
  | {
      readonly type: "link";
      readonly label: readonly ReportInlineV1[];
      readonly target:
        | { readonly kind: "route"; readonly route: ReportRoute }
        | { readonly kind: "download"; readonly path: ReportDownloadPath };
    };

interface ReportDocumentV1 {
  readonly schema: "niceeval.report-document/v1";
  readonly title: string;
  readonly children: readonly ReportBlockV1[];
}

type ReportBlockV1 =
  | ReportSectionV1
  | ReportParagraphV1
  | ReportListV1
  | ReportTableV1
  | ReportMetricV1
  | ReportStatusV1
  | ReportCodeV1
  | ReportChartV1;

interface ReportSectionV1 { readonly type: "section"; readonly heading: string; readonly children: readonly ReportBlockV1[]; }
interface ReportParagraphV1 { readonly type: "paragraph"; readonly children: readonly ReportInlineV1[]; }
interface ReportListV1 { readonly type: "list"; readonly ordered: boolean; readonly items: readonly (readonly ReportBlockV1[])[]; }
interface ReportTableV1 {
  readonly type: "table";
  readonly caption: string;
  readonly columns: readonly { readonly key: string; readonly label: string; readonly align?: "start" | "end" }[];
  readonly rows: readonly Readonly<Record<string, ReportScalarV1>>[];
}
interface ReportMetricV1 { readonly type: "metric"; readonly label: string; readonly value: ReportScalarV1; readonly unit?: string; }
interface ReportStatusV1 { readonly type: "status"; readonly tone: "neutral" | "positive" | "warning" | "negative"; readonly label: string; readonly detail?: readonly ReportInlineV1[]; }
interface ReportCodeV1 { readonly type: "code-block"; readonly value: string; readonly language?: string; }
interface ReportChartV1 {
  readonly type: "chart";
  readonly chart: "bar" | "line";
  readonly title: string;
  readonly categoryLabel: string;
  readonly categories: readonly string[];
  readonly series: readonly { readonly label: string; readonly values: readonly (number | null)[] }[];
}
```

Exact Schema 之外还必须做 relational validation：

- number 全部 finite；
- string 只含 Unicode scalar values；
- table column key 非空唯一，row keys 与 columns 恰好相等；
- chart series 长度与 categories 相等；
- route / download link 必须存在于本 execution 的 closure；
- depth、node、string 与 bytes limits 在 active recursion stack 中执行；
- HTML 按 context escape，terminal 把控制字符转成可见文本；renderer 穷尽 union，未知 schema 返回 unsupported。

Web、terminal 与 static text 都从同一棵树派生。Chart 的 label、categories 与 series 足以形成 table/text；颜色、hover 与图形不能承载唯一语义。通过率等统计口径必须由 Calculation value 自己定义；host 不替作者公式猜 `observed` / `denominator`。

## 数据问题、执行问题与不可隐藏 surface

```ts
interface ReportRecordedDataProblem {
  readonly category: "recorded-data";
  readonly code:
    | "unavailable"
    | "migration-required"
    | "migration-unavailable"
    | "unsupported"
    | "invalid";
  readonly consumerId: ReportComponentId;
  readonly inputKey?: string;
  readonly slotId?: SlotId;
  readonly runId?: RunId;
}

interface ReportExecutionProblem {
  readonly category: "execution";
  readonly code:
    | "projection-callback-defect"
    | "calculation-callback-defect"
    | "page-family-instances-defect"
    | "page-family-key-defect"
    | "page-family-key-conflict"
    | "page-execution-failed"
    | "download-execution-failed"
    | "semantic-document-invalid"
    | "route-conflict";
  readonly consumerId: ReportComponentId;
  readonly summary: string;
}

type ReportProblem = ReportRecordedDataProblem | ReportExecutionProblem;

type ReportProblemId = number & Brand<"ReportProblemId">;

interface ReportProblemTableEntry {
  readonly id: ReportProblemId;
  readonly problem: ReportProblem;
}
```

`summary` 是固定、bounded 的错误摘要，不携带 payload、secret、Record path 或 raw system cause。Projector 问题在 unique projection cache boundary 只生成一次；logical references 只引用同一个 problem ID。Effect interruption 不编码成 `ReportProblem`。

Host 在作者 callback 之前从完整 Sample / projected results 汇总 recorded-data problems，在 callback 边界再追加 execution problems。唯一 canonical `problemTable` 去重保存问题；projection、Calculation、Page、Family 与 Download results 只保存 problem ID 引用。show、view 与 static renderer 都从这张表生成不可关闭的 built-in problems surface。作者过滤 entries、返回零 instance 或不画 problem node，都不能删除它。

Recorded-data problems 是可呈现事实，允许形成成功 static export。Projector / author defect、非法 semantic tree 或 route collision 是 execution problem。show/view 可以保留成功页面并显示问题；static export 对任一 execution problem fail closed。

problems surface 必须区分 `migration-required` 与 `migration-unavailable`：前者提示运行 `niceeval migrate`，后者只呈现 reason，不得反复提示迁移命令。

## 一次 ReportExecution

```ts
interface ReportProjectionSummary {
  readonly projectionId: ReportProjectionId;
  readonly inputKey: string;
  readonly coverage: ProjectionCoverage;
  readonly problemIds: readonly ReportProblemId[];
}

type ReportCalculationExecutionResult =
  | {
      readonly state: "available";
      readonly calculationId: ReportComponentId;
      readonly value: unknown;
      readonly inputState: ReportDataState;
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable" | "execution-failed";
      readonly calculationId: ReportComponentId;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

interface ReportPageFamilyResult {
  readonly familyId: ReportComponentId;
  readonly state: "expanded" | "data-unavailable" | "execution-failed";
  readonly instanceCount: number;
  readonly problemIds: readonly ReportProblemId[];
}

type ReportPageResult =
  | {
      readonly state: "rendered";
      readonly pageId: ReportComponentId;
      readonly route: ReportRoute;
      readonly document: ReportDocumentV1;
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable" | "execution-failed";
      readonly pageId: ReportComponentId;
      readonly route?: ReportRoute;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

type ReportDownloadResult =
  | {
      readonly state: "built";
      readonly downloadId: ReportComponentId;
      readonly files: readonly ReportDownloadFile[];
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable" | "execution-failed";
      readonly downloadId: ReportComponentId;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

interface ReportExecution {
  readonly reportId: ReportId;
  readonly sample: AnalysisSample;
  readonly projections: readonly ReportProjectionSummary[];
  readonly calculations: readonly ReportCalculationExecutionResult[];
  readonly families: readonly ReportPageFamilyResult[];
  readonly pages: readonly ReportPageResult[];
  readonly downloads: readonly ReportDownloadResult[];
  readonly problemTable: readonly ReportProblemTableEntry[];
}
```

Execution 不含 reader、root、path、Scope、Stream、callback 或 projector token。Calculation value 以原值保存在同一进程的 execution 中；host 不重新编码、不引入 wire 形状。页面与 download renderer 按 component ID 取回 typed result。

`ReportProjectionId` 与 `ReportProblemId` 都是 bounded uint32、从 0 开始连续。Projection IDs 按 canonical declaration traversal 分配；problem IDs 按 stable execution traversal 第一次发现问题的顺序分配。同一 unique projection cache problem 只分配一次。`projections`、`calculations`、`families`、`pages`、`downloads` 分别按 canonical ID / route / path 排序，不能用 object iteration 猜顺序。

每个 declared projection、Calculation、PageFamily、page instance 与 Download 在一个 execution 中最多执行一次。Author graph 的内部 intermediate values 不持久化，也不进入 Record。

## Effect-native execution

```ts
declare const executeReport: (input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly report: Report;
}) => Effect.Effect<ReportExecution, ReportExecutionError, never>;
```

`executeReport` 只能在创建 `AnalysisSampleHandle` 的原 reader Scope 仍存活时调用。capability 已在 handle 的 package-private WeakMap binding 内，不额外写一个 `Scope.Scope` R；R 是 `never`。Pure `AnalysisSample` 不能传入这个入口。reader 关闭、伪造 handle 或另一 reader 的 handle 返回 typed `RecordReadError`；WeakMap 内部错配是 defect。

Library 不调用 `Effect.runPromise`，也不建立私有 runtime。CLI / application main provide Layers 后只在外层调用一次 `Effect.runPromiseExit`；内部不存在 nested `runPromise`。

```ts
const execution = yield* executeReport({ sampleHandle, report });

yield* showReport({ execution });
yield* exportStaticReport({ execution, out });
```

## show

```ts
declare const showReport: (input: {
  readonly execution: ReportExecution;
  readonly format?: "text" | "json";
  readonly page?: ReportRoute;
}) => Effect.Effect<void, ReportShowError, ReportConsole>;
```

Text 与 JSON 都从同一 semantic tree、problems 与 execution 派生。`showReport` 不要求 filesystem、server 或 watcher，也不 watch。

`--json` 输出一个固定 schema：reportId、pageSelection、sample 摘要、projections、calculations、families、pages 与 problemTable。Download 部分只含 path / mediaType / byteLength / SHA-256 metadata。它不内联 Download bytes，也不输出第二条 projection 路径。

没有 `--page` 时 pages 按 route 输出全部；有 `--page` 时只输出 exact 选中的一页。sample / projections / calculations / family summaries / download metadata 与 problemTable 仍完整。arrays 按 canonical order，object keys 按 UTF-8 bytes 排序，stdout 是 UTF-8 canonical JSON。

Host 只显示每个 input 的 complete/partial 与 problem IDs，不替作者公式猜 `observed` / `denominator`。Broken pipe 是正常 CLI 退出，其它 console failure 是 typed error，interruption 保持 Cause。

## Node 热重载 host

热重载只在 `niceeval/report/host/node`。它是独立 scoped host service；loader 与 watcher 的具体实现属于该 host，本契约只声明行为。

```ts
interface ReportViewState {
  readonly current: ReportViewRevision;
  readonly lastProblem?: { readonly summary: string };
}

interface ReportViewSession {
  readonly url: string;
  readonly snapshot: Effect.Effect<ReportViewState, ReportViewSessionClosed>;
  readonly refresh: Effect.Effect<void, ReportViewSessionClosed>;
}

class NodeReportViewHost extends Context.Tag(
  "@niceeval/report/NodeReportViewHost",
)<NodeReportViewHost, { readonly open: (
  request: ReportViewRequest,
) => Effect.Effect<ReportViewSession, ReportViewOpenError, Scope.Scope> }>() {}

declare const openNodeReportView: (
  request: ReportViewRequest,
) => Effect.Effect<
  ReportViewSession,
  ReportViewOpenError,
  Scope.Scope | NodeReportViewHost
>;
```

热重载行为：

- 每次 rebuild 产生一份新的 fixed `ReportExecution`；
- 完整成功后才替换 current revision，并清除 lastProblem；
- 失败保留 last-good execution，替换 bounded lastProblem；
- 每个 revision 仍是固定的一次 `ReportExecution`。热重载因为变化会创建下一份 execution，而不是让同一份 execution 偷偷重读；
- watch 的输入闭集是 Record root、Report / Theme module 及其静态 import、`niceeval.config.ts`。

`NodeReportViewHost` 是可替换的高层 service。官方 Live Layer 内部组合 watcher、server 与 module loader；父调用者不提供或传入 Worker 的 Record service object。Current-process `executeReport` 仍支持调用方自己的 Record Layers。Node ESM module cache 与 watcher 细节由 host 决定，本契约不指定 Worker、bundler 或 wire 形状。

## Static export

```ts
declare const exportStaticReport: (input: {
  readonly execution: ReportExecution;
  readonly out: AbsoluteDirectoryPath;
}) => Effect.Effect<
  ReportStaticExportReceipt,
  ReportExportError,
  ReportFileSystem
>;
```

Static exporter 只消费一个已完成 execution：

1. preflight execution problems、semantic tree、route、download、limits 与 closure；任一 execution problem 整体不发布；
2. 向 `out` 写出 HTML、host-data、downloads、manifest 与 built-in runtime，host files 落在保留 namespace `_niceeval`；
3. 全部文件写出后，最后写入零字节 `complete` marker；
4. sync 目录后返回 receipt。

Recorded-data problems 可以导出，并由所有页面不可关闭的 built-in problems surface 显示。目标已存在返回 `target-exists`，不删除或替换既有内容。

中断或失败可能留下没有 `complete` marker 的目录。host 以缺失的 marker 识别 incomplete output，提示用户删除后重试。本契约不承诺原子目录发布，也不依赖原生 rename 原语。

```ts
interface ReportFileSystemService {
  readonly writeFile: (input: {
    readonly out: AbsoluteDirectoryPath;
    readonly path: ReportHostOutputPath;
    readonly bytes: Uint8Array;
  }) => Effect.Effect<void, ReportFileSystemError>;
  readonly writeCompleteMarker: (
    out: AbsoluteDirectoryPath,
  ) => Effect.Effect<void, ReportFileSystemError>;
  readonly syncDirectory: (
    out: AbsoluteDirectoryPath,
  ) => Effect.Effect<void, ReportFileSystemError>;
}

class ReportFileSystem extends Context.Tag(
  "@niceeval/report/ReportFileSystem",
)<ReportFileSystem, ReportFileSystemService>() {}
```

`ReportHostOutputPath` 是 `niceeval/report/host` 平台边界类型，不从 author package 导出 constructor。host 用同一 codec 把 route HTML、Download、host-data 与 runtime 变成 canonical segments；Author `ReportDownloadPath` 只是其中一种输入。

## Limits

| 常量 | maximum | 计数范围 |
|---|---:|---|
| `REPORT_PAGES_MAX` | 20,000 | fixed + family-expanded pages |
| `REPORT_DOCUMENT_NODES_MAX` | 20,000 | 每份 semantic document |
| `REPORT_DOCUMENT_DEPTH_MAX` | 32 | 每份 semantic document |
| `REPORT_DOWNLOAD_FILES_MAX` | 1,000 | 全部 downloads |
| `REPORT_DOWNLOAD_FILE_BYTES_MAX` | 33,554,432 | 单一 normalized file buffer |

Logical entries 上限 250,000 由 Projection Library 拥有，Report 不复述。Host 在分配 fixed collection 前检查已知 count，在 Iterable 与 semantic traversal 中累计其余 limits。降低任一 maximum 是 breaking contract，必须发布新 profile；实现不能散落匿名 magic numbers。

```ts
interface ReportLimitExceeded {
  readonly code: "report-limit-exceeded";
  readonly limit: "pages" | "document-nodes" | "document-depth" | "download-files" | "download-file-bytes";
  readonly maximum: number;
  readonly observedAtLeast: number;
}
```

## Typed errors

```ts
type ReportExecutionError =
  | RecordReadError
  | ProjectionLimitError
  | ReportLimitExceeded
  | { readonly code: "report-definition-invalid"; readonly issues: readonly string[] };

type ReportShowError =
  | ReportConsoleError
  | { readonly code: "report-show-render-failed"; readonly operation: string };

type ReportViewOpenError =
  | ReportExecutionError
  | { readonly code: "report-view-open-failed"; readonly reason: string };

type ReportExportError =
  | ReportLimitExceeded
  | { readonly code: "report-export-execution-problem"; readonly problems: readonly ReportExecutionProblem[] }
  | { readonly code: "report-export-target-exists" }
  | { readonly code: "report-export-write-failed"; readonly operation: string };
```

Typed failure、defect 与 interruption 始终分开。公开错误不泄露 payload、secret、任意 filesystem path 或 raw system cause；diagnostic log 可以在显式 debug policy 下写出安全 redaction 后的内部 cause。

## 冻结验收

本契约不能只用 Markdown lint 验收。实现前必须用仓库锁定的 TypeScript 与 `effect@3.22.1` 编译 `fixture/compile.ts`，至少证明：

- 普通 named interface 可以成为 Attachment projector view 与 Calculation value，不需要 index signature、显式 generic 或 `as`；
- wrong owner、projected Value 或 access kind 不能赋值；private TypeId / variance 真实参与 generic structure；
- `reportInputs` 的 key 形状精确推导出 `ProjectedSample<Access, Value>`，不引入第三个 generic 参数；
- 四态 completeness（allow-partial / require-complete）与 data-unavailable / execution-failed 可以区分；
- PageFamily 的 `Instance` 由 `instances` 回调推断，key / route / render 可以消费它；
- `executeReport` 的 R 是 `never`，`showReport` 只要求 `ReportConsole`，`exportStaticReport` 只要求 `ReportFileSystem`；
- `Effect.gen` 组合上述入口、`Either.getOrThrow` 处理 branded constructor 均可编译。

## 相关阅读

- [Reports README](README.md)：用户心智与功能边界。
- [Architecture](architecture.md)：Record → Analysis → Projection → Report → host 的层次。
- [Calculations](calculations.md)：通过率、score 与 completeness。
- [Projection Library](../projection/library.md)：`RecordProjection`、`ProjectedSample` 与 coverage。
- [Sample Library](../sample/library.md)：Sample、slot 状态与 live handle。
- [Record Library](../record/library.md)：Attachment family 与读取状态。
