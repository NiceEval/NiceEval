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

Report 作者只理解两件事：需要哪些 `RecordProjection`，以及怎样把 projected values / derived values 包装成页面或下载。作者 callback 看不到 `RecordReader`、root、Scope、Effect、path、physical owner、compiled plan、I/O closure 或 Worker lifecycle。

## 最小作者调用面

```ts
const verdicts = attemptSlotProjection(verdictProjector);
const evaluations = selectedRunProjection(evaluationsProjector);
const passInputs = Either.getOrThrow(reportInputs({ verdicts, evaluations }));

const passRate = defineCalculation({
  id: Either.getOrThrow(reportComponentId("pass-rate")),
  inputs: passInputs,
  completeness: "allow-partial",
  output: passRateCodec,
  calculate: ({ sample, inputs }) =>
    calculatePassRate(sample, inputs.verdicts, inputs.evaluations),
});

const overviewRoute = Either.getOrThrow(reportRoute("/"));

const overview = definePage({
  id: Either.getOrThrow(reportComponentId("overview")),
  route: overviewRoute,
  calculations: { passRate },
  render: ({ calculations }) => {
    const result = calculations.passRate;
    return reportDocument({
      title: "Summary",
      children: [
        reportMetric({
          label: "Pass rate",
          value: result.state === "available" ? result.value.rate : null,
          evidence: result.state === "available"
            ? {
                observed: result.value.observed,
                denominator: result.value.denominator,
              }
            : undefined,
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

公开领域对象只叫 `Report`。`ReportDefinition` 不存在于 public API；`ReportPlan`、binding、matrix、prepare、materialize 与 route expansion receipt 都是 host 编译机械，不进入作者签名、教程或 Concepts。

## 数据计划

Report 直接复用 [Projection Library](../projection/library.md) 的声明与穷尽结果：

```ts
type AnyRecordProjection = RecordProjection<any, any>;
declare const ReportDataPlanTypeId: unique symbol;

interface ReportDataPlan<
  out Shape extends Readonly<Record<string, AnyRecordProjection>> = Readonly<
    Record<string, AnyRecordProjection>
  >,
> {
  readonly [ReportDataPlanTypeId]: { readonly _Shape: () => Shape };
}

declare const reportInputs: <
  const Shape extends Readonly<Record<string, AnyRecordProjection>>,
>(shape: Shape) => Either.Either<
  ReportDataPlan<Shape>,
  ReportDataPlanIssue
>;

type ReportDataShape<Plan extends ReportDataPlan> =
  Plan extends ReportDataPlan<infer Shape> ? Shape : never;

type ReportProjectedValues<Plan extends ReportDataPlan> = {
  readonly [Key in keyof ReportDataShape<Plan>]:
    ReportDataShape<Plan>[Key] extends RecordProjection<infer Access, infer Value>
      ? ProjectedSample<Access, Value, ReportProblemId>
      : never;
};
```

`any`只用于package declaration内部表达existential`RecordProjection`；作者callback的每个key仍精确推导`Access`与`Value`。普通named interface不需要index signature、显式generic或`as`。

`reportInputs`是输入key的唯一constructor。Key必须满足`[a-z][a-z0-9_-]*`且UTF-8最多64 bytes；constructor exact拒绝symbol、accessor、non-plain object与非法key，再按key UTF-8 bytes保存canonical traversal。

返回plan由package-private WeakMap持有projection objects，不能靠复制brand伪造。Author-local property name不作为持久projector identity；host从canonical plan生成bounded numeric`ReportProjectionId`。

三个 factory 的基数是：

- `attemptSlotProjection(projector)`：`sample.slots` 每项一条；
- `attemptOriginRunProjection(projector)`：仍是每个 slot 一条，只沿精确 Attempt 引用把 included slot 的 owner 定位为该 Attempt 的 origin Run；
- `selectedRunProjection(projector)`：`sample.runs` 每项一条。

excluded、not-recorded 与 core-invalid 不会从 projected sample 消失。十个 slot 指向同一 origin Run 时仍有十条公开 logical entries；物理去重只属于 host telemetry。

每个 `RecordChannelProjector` 是其 exact `PortableValueCodec<Value>` 的唯一 owner；`RecordProjection` 与 projected result 不复制或公开 codec。Record payload decode 失败是 `ChannelProjectionResult.invalid`。

Projector callback 返回 `Value` 后必须立刻 canonical encode → decode，consumer只读round-tripped value。codec failure在unique owner+projector cache boundary记一次`projection-output-codec-failed`，logical entries引用同一个problem ID。它绝不能改名为Record invalid，interruption也永远传播。

## Report、Calculation 与组件

```ts
declare const ReportTypeId: unique symbol;

interface Report {
  readonly id: ReportId;
  readonly [ReportTypeId]: true;
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

- `require-complete`：required projected input 中出现 not-recorded、core-invalid、unavailable、unsupported、invalid 或任一 partial 时，不调用作者 callback。此时形成 `data-unavailable` result；
- `allow-partial`：调用 callback，并交付穷尽 `ProjectedSample`、coverage 与 issues，作者可以使用成功 entries；host-owned problems surface 仍保留全部问题；
- projection callback/output-codec failure 不是 partial data。Calculation、fixed Page 与 Download 不执行。`allow-partial` PageFamily 在 show/view 中仍可收到穷尽 entries，只从成功的 `channel-result` 展开实例，但 family/execution problem不可隐藏，零实例也必须可见。static export 对任一 execution problem preflight fail closed；
- 只消费 `ReportCalculationResult` 的组件总是收到 result union，可以呈现 unavailable，不把它改名为 execution failure。

### Calculation

Calculation 只从静态声明的 projections 派生一个值，不依赖另一个 Calculation。复用公式使用普通纯函数。

```ts
declare const ReportCalculationTypeId: unique symbol;

interface ReportCalculation<
  Inputs extends ReportDataPlan,
  in out Value,
> {
  readonly id: ReportComponentId;
  readonly output: PortableValueCodec<Value, "data-only">;
  readonly [ReportCalculationTypeId]: {
    readonly _Inputs: Inputs;
    readonly _Value: (value: Value) => Value;
  };
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
  readonly inputs: keyof ReportDataShape<Inputs> extends never ? never : Inputs;
  readonly completeness: ReportCompleteness;
  readonly output: PortableValueCodec<Value, "data-only">;
  readonly calculate: (context: {
    readonly sample: AnalysisSample;
    readonly inputs: ReportProjectedValues<Inputs>;
  }) => Value;
}) => ReportCalculation<Inputs, Value>;
```

Calculation 复用 Projection 的唯一 `PortableValueCodec` 协议，profile 固定为 `data-only`，不另造 `ReportDataCodec` 或第二套 canonical wire。普通 named interface 可以直接由 Effect Schema 推导；binary必须通过Download交付。Callback返回后立即encode→decode，后续Page只读round-tripped value。

Callback throw形成`calculation-callback-defect`。encode或round-trip decode形成`calculation-output-codec-failed`。两者都不是unavailable、partial或Record invalid；interruption保持Cause。

```ts
interface CalculationInputCompleteness {
  readonly state: "complete" | "partial";
  readonly inputs: readonly {
    readonly key: string;
    readonly coverage: ProjectionCoverage;
    readonly dataProblemIds: readonly ReportProblemId[];
  }[];
  readonly dataProblemIds: readonly ReportProblemId[];
}

type ReportCalculationResult<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
      readonly completeness: CalculationInputCompleteness;
    }
  | {
      readonly state: "data-unavailable";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
      readonly completeness: CalculationInputCompleteness;
    }
  | {
      readonly state: "execution-failed";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };
```

### Fixed Page

```ts
declare const ReportPageTypeId: unique symbol;

interface ReportPage {
  readonly id: ReportComponentId;
  readonly [ReportPageTypeId]: true;
}

declare const definePage: {
  <Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly route: ReportRoute;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly render: (context: {
      readonly sample: AnalysisSample;
      readonly inputs: {};
      readonly calculations: ReportCalculationResults<Calculations>;
    }) => ReportDocumentV1;
  }): ReportPage;

  <Inputs extends ReportDataPlan, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly route: ReportRoute;
    readonly inputs: keyof ReportDataShape<Inputs> extends never ? never : Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly render: (context: {
      readonly sample: AnalysisSample;
      readonly inputs: ReportProjectedValues<Inputs>;
      readonly calculations: ReportCalculationResults<Calculations>;
    }) => ReportDocumentV1;
  }): ReportPage;
};
```

Fixed Page 的 route 在任何 I/O 前已知。若 `inputs` 非空，TypeScript overload 要求 `completeness`；只消费 Calculation 时不要求虚假的 completeness。

### PageFamily

PageFamily 可以用它静态声明的 projected values 和已注册 Calculation results 纯内存展开动态 route，但不能请求新 I/O。

```ts
declare const ReportPageFamilyTypeId: unique symbol;

interface ReportPageFamily {
  readonly id: ReportComponentId;
  readonly [ReportPageFamilyTypeId]: true;
}

declare const definePageFamily: {
  <Instance, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly instances: (context: {
      readonly sample: AnalysisSample;
      readonly inputs: {};
      readonly calculations: ReportCalculationResults<Calculations>;
    }) => Iterable<Instance>;
    readonly key: (instance: Instance) => ReportInstanceKey;
    readonly route: (instance: Instance) => ReportRoute;
    readonly render: (context: {
      readonly sample: AnalysisSample;
      readonly instance: Instance;
      readonly inputs: {};
      readonly calculations: ReportCalculationResults<Calculations>;
    }) => ReportDocumentV1;
  }): ReportPageFamily;

  <Inputs extends ReportDataPlan, Instance, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs: keyof ReportDataShape<Inputs> extends never ? never : Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly instances: (context: {
      readonly sample: AnalysisSample;
      readonly inputs: ReportProjectedValues<Inputs>;
      readonly calculations: ReportCalculationResults<Calculations>;
    }) => Iterable<Instance>;
    readonly key: (instance: Instance) => ReportInstanceKey;
    readonly route: (instance: Instance) => ReportRoute;
    readonly render: (context: {
      readonly sample: AnalysisSample;
      readonly instance: Instance;
      readonly inputs: ReportProjectedValues<Inputs>;
      readonly calculations: ReportCalculationResults<Calculations>;
    }) => ReportDocumentV1;
  }): ReportPageFamily;
};
```

标准用法包括：每个 Assertion 一页、每个 conversation turn / tool call 一页，以及先由 Calculation 聚合 diagnostics category、再由 PageFamily 展开分类页。若坏 payload 无法提供 durable item key，host 只能保留列表页与问题，不能用数组下标伪造稳定 detail route。

`Instance` 是进程内私有值，不要求 `{ key }`、codec 或 portability；`key(instance)` 单独提供稳定 identity。`key`/`route` callback throw与duplicate key都形成具名execution problem。family即使产生零个instance，也必须在`ReportExecution.families`留一条result；作者不能靠`flatMap`或空family让坏输入从内建problems surface消失。

### Download

```ts
interface ReportDownloadFile {
  readonly path: ReportDownloadPath;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

declare const ReportDownloadTypeId: unique symbol;

interface ReportDownload {
  readonly id: ReportComponentId;
  readonly [ReportDownloadTypeId]: true;
}

declare const defineDownload: {
  <Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly build: (context: {
      readonly sample: AnalysisSample;
      readonly inputs: {};
      readonly calculations: ReportCalculationResults<Calculations>;
    }) => Iterable<ReportDownloadFile>;
  }): ReportDownload;

  <Inputs extends ReportDataPlan, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs: keyof ReportDataShape<Inputs> extends never ? never : Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly build: (context: {
      readonly sample: AnalysisSample;
      readonly inputs: ReportProjectedValues<Inputs>;
      readonly calculations: ReportCalculationResults<Calculations>;
    }) => Iterable<ReportDownloadFile>;
  }): ReportDownload;
};
```

Download bytes 在 execution 中自包含。Host 按 view 的 `byteOffset` / `byteLength` 取得稳定快照，不把共享 slab 或 view 外 bytes 带进 Worker / export closure。

## 路由、实例 key 与静态路径

```ts
declare const ReportIdTypeId: unique symbol;
declare const ReportComponentIdTypeId: unique symbol;
declare const ReportRouteTypeId: unique symbol;
declare const ReportInstanceKeyTypeId: unique symbol;
declare const ReportDownloadPathTypeId: unique symbol;

type ReportId = string & { readonly [ReportIdTypeId]: true };
type ReportComponentId = string & {
  readonly [ReportComponentIdTypeId]: true;
};
type ReportRoute = string & { readonly [ReportRouteTypeId]: true };
type ReportInstanceKey = string & { readonly [ReportInstanceKeyTypeId]: true };
type ReportDownloadPath = string & {
  readonly [ReportDownloadPathTypeId]: true;
};

type ReportPathIssue = {
  readonly code: "report-path-invalid";
  readonly kind:
    | "report-id"
    | "component-id"
    | "route"
    | "instance-key"
    | "download";
  readonly reason: string;
};

declare const reportId: (
  input: string,
) => Either.Either<ReportId, ReportPathIssue>;

declare const reportComponentId: (
  input: string,
) => Either.Either<ReportComponentId, ReportPathIssue>;

declare const reportRoute: (
  input: string,
) => Either.Either<ReportRoute, ReportPathIssue>;

declare const reportInstanceKey: (
  input: string,
) => Either.Either<ReportInstanceKey, ReportPathIssue>;

declare const reportDownloadPath: (
  input: string,
) => Either.Either<ReportDownloadPath, ReportPathIssue>;

type RecordIdentityForReportPath =
  | { readonly kind: "run"; readonly value: RunId }
  | { readonly kind: "attempt"; readonly value: AttemptId }
  | { readonly kind: "slot"; readonly value: SlotId };

declare const reportInstanceKeyFromRecordId: (
  input: RecordIdentityForReportPath,
) => ReportInstanceKey;

declare const reportInstanceKeyFromIdentity: (input: {
  readonly domain: "experiment" | "eval";
  readonly value: string;
}) => Either.Either<ReportInstanceKey, ReportPathIssue>;

declare const reportRouteFromKeys: (
  keys: readonly [ReportInstanceKey, ...ReportInstanceKey[]],
) => Either.Either<ReportRoute, ReportPathIssue>;
```

Route 是 `/`，或 `/` 加 1–32 个 lowercase ASCII segments。Download 是 1–32 个相同语法的 relative segments。Segment 满足 `[a-z0-9][a-z0-9._~-]*`，最多 128 bytes，整条最多 1,024 bytes。它拒绝 percent、query、fragment、backslash、空 segment、`.`、`..`、尾随 `/`、尾点/空格，以及 basename 为 `con | prn | aux | nul | com1..com9 | lpt1..lpt9` 的 Windows device name。

Report / component ID 与 Instance key 满足 `[a-z0-9][a-z0-9_-]*`，最多 128 bytes；纯十进制 ordinal 非法，不能用数组下标冒充 durable identity。所有 definition arrays 和 wire tables 按 branded ID 的 UTF-8 bytes 排序；同 ID 冲突在任何作者 callback 前返回 definition invalid，不能依赖 JavaScript object iteration order。

Record 的 `RunId` / `AttemptId` / `SlotId` 仍是 26 位 uppercase canonical Crockford，不能直接拼入 lowercase route。`reportInstanceKeyFromRecordId` 使用 `run-` / `attempt-` / `slot-` domain tag 加可逆 lowercase Crockford，三个domain之间也不会碰撞；decode/display仍恢复并显示原Record ID。

`reportInstanceKeyFromIdentity` 对Experiment/Eval任意ID先验证Unicode scalar与固定input byte limit。之后用domain-tagged lowercase Crockford编码；超出128-byte output返回issue。调用方不得散落`toLowerCase()`或直接插值。`reportRouteFromKeys`是唯一把这些key组成route的public adapter。

Static mapping 唯一且跨平台：

```text
/           → index.html
/a/b        → a/b/index.html
download x  → downloads/x
```

Route outputs、downloads、portable host-data、built-in runtime 与 manifest 进入同一个 collision set。Host 拒绝 exact collision、ASCII case-fold collision、file/directory prefix collision、Windows device / trailing-dot-space collision与长度超限。

Static link 不直接写 semantic `/a/b`。Codec 从当前 page output 的 POSIX dirname 到 target output file 计算 relative path，separator 固定 `/`，结果不以 `..` 开头时补 `./`，并始终显式包含 `index.html`。Grammar 没有 percent escape，因此不做二次 URL encode。Web host 可以用 origin-relative href，static host 用 relative href；两者指向同一个 branded semantic route。

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

interface ReportSectionV1 {
  readonly type: "section";
  readonly heading: string;
  readonly children: readonly ReportBlockV1[];
}

interface ReportParagraphV1 {
  readonly type: "paragraph";
  readonly children: readonly ReportInlineV1[];
}

interface ReportListV1 {
  readonly type: "list";
  readonly ordered: boolean;
  readonly items: readonly (readonly ReportBlockV1[])[];
}

interface ReportTableV1 {
  readonly type: "table";
  readonly caption: string;
  readonly columns: readonly {
    readonly key: string;
    readonly label: string;
    readonly align?: "start" | "end";
  }[];
  readonly rows: readonly Readonly<Record<string, ReportScalarV1>>[];
}

interface ReportMetricV1 {
  readonly type: "metric";
  readonly label: string;
  readonly value: ReportScalarV1;
  readonly unit?: string;
  readonly evidence?: {
    readonly observed: number;
    readonly denominator: number;
  };
}

interface ReportStatusV1 {
  readonly type: "status";
  readonly tone: "neutral" | "positive" | "warning" | "negative";
  readonly label: string;
  readonly detail?: readonly ReportInlineV1[];
}

interface ReportCodeV1 {
  readonly type: "code-block";
  readonly value: string;
  readonly language?: string;
}

interface ReportChartV1 {
  readonly type: "chart";
  readonly chart: "bar" | "line";
  readonly title: string;
  readonly categoryLabel: string;
  readonly categories: readonly string[];
  readonly series: readonly {
    readonly label: string;
    readonly values: readonly (number | null)[];
  }[];
  readonly evidence?: {
    readonly observed: number;
    readonly denominator: number;
  };
}
```

Exact Schema 之外还必须做 relational validation：

- 所有 number finite，拒绝 `NaN`、`Infinity` 与 `-0`；
- string 只含 Unicode scalar values，拒绝 NUL 与 unpaired surrogate；
- table column key 非空且唯一，每个 row 的 keys 与 columns 恰好相等；
- chart 每条 series 的 values 长度与 categories 相等；
- metric/chart evidence 的 `observed` 与 `denominator` 都是 nonnegative safe integer；`observed <= denominator`，且 denominator 为0时 observed也必须为0。Weighted score、ratio或fraction属于metric value，不冒充count evidence；
- route/download link 必须存在于本 execution 的 closure；
- semantic document 同样按 value tree 处理 shared alias：每处重复遍历并计入 limits；active recursion stack 只拒绝真正 cycle，同时执行 depth、node、string 与 bytes limits；
- HTML renderer 按 text/attribute context escape，绝不拼 raw HTML；terminal renderer 把控制字符转成可见文本；
- renderer 穷尽 union，未知 document schema 返回 unsupported，不静默丢 node。

Web、terminal 与 static text 都从同一棵树派生。Chart 的 label、categories、series 与作者提供的 metric evidence 足以形成 table/text；颜色、hover 与图形不能承载唯一语义。Host 只提供每个 projection input 的 coverage 与 data problem IDs，不替作者公式猜 `observed` / `denominator`；通过率等统计口径必须由 Calculation value 自己定义并经 codec 验证。

## 数据问题、执行问题与不可隐藏 surface

```ts
interface ReportRecordedDataProblem {
  readonly category: "recorded-data";
  readonly code:
    | "excluded"
    | "not-recorded"
    | "core-invalid"
    | "channel-unavailable"
    | "channel-unsupported"
    | "channel-invalid"
    | "channel-partial";
  readonly consumerId: ReportComponentId;
  readonly inputKey?: string;
  readonly sampleRunId?: RunId;
  readonly slotId?: SlotId;
}

interface ReportExecutionProblem {
  readonly category: "execution";
  readonly code:
    | "projection-callback-defect"
    | "projection-output-codec-failed"
    | "calculation-callback-defect"
    | "calculation-output-codec-failed"
    | "page-family-instances-defect"
    | "page-family-key-defect"
    | "page-family-key-conflict"
    | "page-execution-failed"
    | "download-execution-failed"
    | "semantic-document-invalid"
    | "route-conflict"
    | "output-closure-invalid";
  readonly consumerId: ReportComponentId;
  readonly projectionId?: ReportProjectionId;
  readonly phase?: "encode" | "round-trip-decode" | "callback" | "validate";
  readonly cause?: ReportSafeCause;
}

type ReportProblem = ReportRecordedDataProblem | ReportExecutionProblem;

type ReportProblemId = number & Brand<"ReportProblemId">;
type ReportProjectionId = number & Brand<"ReportProjectionId">;

interface ReportProblemTableEntry {
  readonly id: ReportProblemId;
  readonly problem: ReportProblem;
}

interface ReportSafeCause {
  readonly classification:
    | "extension-defect"
    | "contract-violation"
    | "host-failure";
  readonly code: string;
  readonly summary:
    | "Extension callback failed"
    | "Extension output violated its declared codec"
    | "Host validation failed";
}
```

`ReportSafeCause` 只保留闭合 classification/code 与固定、bounded generic summary。任意 `Error.message`、stack、Record path、payload、secret 或 raw system cause 默认都不安全，不进 wire；显式 redactor 形成的 debug event 属 observability，不属于 `ReportExecution`。Projector问题在unique projection cache boundary只生成一次；logical entries只引用同一个problem ID。Effect interruption不编码成`ReportProblem`。

Host 在作者 callback 之前从完整 Sample / projected results 汇总 data problems，在 callback 边界再追加 execution problems。唯一 canonical `problemTable` 去重保存问题；projection、Calculation、Page、Family 与Download results只保存problem ID引用。show、view与static renderer都从这张表生成不可关闭的built-in problems surface。作者过滤entries、返回零instance或不画problem node，都不能删除它。

Recorded data problems 是可呈现事实，允许形成成功 static export。Projector/author defect、非法 semantic tree、route collision 或无法闭合 output 是 execution problem。show/view 可以保留成功页面并显示问题；static export 对任一 execution problem fail closed。

## 一次 ReportExecution

```ts
type ReportPageSource =
  | {
      readonly kind: "fixed";
      readonly pageId: ReportComponentId;
    }
  | {
      readonly kind: "family";
      readonly familyId: ReportComponentId;
      readonly candidateIndex: number;
      readonly instanceKey?: ReportInstanceKey;
    };

type ReportPageResult =
  | {
      readonly state: "rendered";
      readonly source:
        | { readonly kind: "fixed"; readonly pageId: ReportComponentId }
        | {
            readonly kind: "family";
            readonly familyId: ReportComponentId;
            readonly candidateIndex: number;
            readonly instanceKey: ReportInstanceKey;
          };
      readonly route: ReportRoute;
      readonly document: ReportDocumentV1;
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable" | "execution-failed";
      readonly source: ReportPageSource;
      readonly route?: ReportRoute;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

interface ReportPageFamilyCandidateResult {
  /** 只是在本次Iterable中的诊断坐标，不是route identity。 */
  readonly candidateIndex: number;
  readonly instanceKey?: ReportInstanceKey;
  readonly state: "rendered" | "data-unavailable" | "execution-failed";
  readonly problemIds: readonly ReportProblemId[];
}

interface ReportPageFamilyResult {
  readonly familyId: ReportComponentId;
  readonly state: "expanded" | "data-unavailable" | "execution-failed";
  readonly instanceCount: number;
  readonly candidates: readonly ReportPageFamilyCandidateResult[];
  readonly problemIds: readonly ReportProblemId[];
}

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

type ReportCalculationExecutionResult =
  | {
      readonly state: "available";
      readonly calculationId: ReportComponentId;
      readonly value: EncodedPortableEnvelopeV1;
      readonly completeness: CalculationInputCompleteness;
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable" | "execution-failed";
      readonly calculationId: ReportComponentId;
      readonly completeness?: CalculationInputCompleteness;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

interface ReportProjectionExecutionSummary {
  readonly projectionId: ReportProjectionId;
  readonly coverage: ProjectionCoverage;
  readonly problemIds: readonly ReportProblemId[];
}

interface ReportExecution {
  readonly schema: "niceeval.report-execution/v1";
  readonly reportId: ReportId;
  readonly sample: AnalysisSample;
  readonly projections: readonly ReportProjectionExecutionSummary[];
  readonly calculations: readonly ReportCalculationExecutionResult[];
  readonly families: readonly ReportPageFamilyResult[];
  readonly pages: readonly ReportPageResult[];
  readonly downloads: readonly ReportDownloadResult[];
  readonly problemTable: readonly ReportProblemTableEntry[];
}
```

Execution 不含 reader、root、path、Scope、Stream、callback、module、private projector token 或 physical-read telemetry。作者专属的 Calculation `Value` 只在 callback 所在进程中存在；形成 execution 时由作者 codec canonical round-trip并擦除为generic data-only envelope。父进程没有、也不会运行作者 codec，因此绝不声称从wire恢复作者的brand、class或transform result。

`ReportProjectionId` 与 `ReportProblemId` 都是 bounded uint32、从0开始连续。Projection IDs 先按 component ID 与 input-key UTF-8 bytes 构造canonical declaration traversal并为object-identical declaration去重。problem IDs再按stable execution traversal第一次发现问题的顺序分配。同一unique projection cache problem只分配一次。

所有results只保存ID引用，decode exact拒绝negative/fraction、duplicate/missing/out-of-range ID与额外table项。`candidateIndex`只是一次execution内定位key callback失败项的nonnegative uint32，不可用于route。成功family page必须有`familyId + instanceKey`。`projections`、`calculations`、`families`、`pages`、`downloads`分别按canonical ID/route/path排序，不能用object iteration猜wire identity。

Package-private host codec 只能把自己拥有 schema 的 route、Sample、document、problem 与 execution wrapper 在 decode 后重新验证并 rebrand；structured clone 本身不构成验证。当前进程 `executeReport` 与 Worker 入口返回相同的 host-owned execution 形状，不维护“本地有 typed A、远端只有 unknown”的双重公共语义。

每个 declared projection、Calculation、PageFamily、page instance 与 Download 在一个 execution 中最多执行一次。Author graph 的内部 intermediate values 不持久化，也不进入 Record。

## Effect-native execution

```ts
declare const executeReport: (input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly report: Report;
}) => Effect.Effect<ReportExecution, ReportExecutionError, never>;

declare const executeReportFromRecord: (input: {
  readonly root: RecordRoot;
  readonly selection: AnalysisSelectionRequest;
  readonly report: Report;
}) => Effect.Effect<
  ReportExecution,
  ReportExecutionError,
  RecordPlatform
>;
```

`executeReport` 只能在创建 `AnalysisSampleHandle` 的原 reader Scope 仍存活时调用。capability已在handle的package-private WeakMap binding内，不额外写一个无法证明“同一 Scope identity”的`Scope.Scope` R。Pure `AnalysisSample`不能传入这个入口。reader关闭后返回typed`RecordReadError`；WeakMap缺项或sample/capability内部错配是defect。

`executeReportFromRecord` 是高层 Effect orchestration：内部以 `Effect.scoped` 打开 reader、形成 bound selection、执行并在返回 pure execution 前关闭 reader。它不运行 Effect runtime。CLI / application main provide Node Layers 后只在最外层调用一次 `Effect.runPromiseExit`；内部不存在 nested `runPromise`。

```ts
const execution = yield* executeReport({ sampleHandle, report });

yield* showReport({ execution });
yield* exportStaticReport({ execution, out });
```

## 精确 platform Tags

`niceeval/report/host` 不提供聚合 `ReportHostPlatform`。每个入口只要求实际能力。

```ts
interface ReportConsoleService {
  readonly write: (
    text: string,
  ) => Effect.Effect<void, ReportConsoleError>;
}

class ReportConsole extends Context.Tag(
  "@niceeval/report/ReportConsole",
)<ReportConsole, ReportConsoleService>() {}

interface ReportStagingDirectory {
  readonly _brand: unique symbol;
}

interface ReportStaticTarget {
  /** package-private opened target-parent handle + canonical leaf binding */
  readonly _brand: unique symbol;
}

interface ReportHostOutputPath {
  /** 已验证的canonical relative segments；可表示author与reserved host files。 */
  readonly segments: readonly [string, ...string[]];
  readonly _brand: unique symbol;
}

interface ReportFileSystemService {
  readonly openStaticTargetNoFollow: (
    target: AbsoluteDirectoryPath,
  ) => Effect.Effect<ReportStaticTarget, ReportFileSystemError>;
  readonly createSiblingStagingDirectory: (
    target: ReportStaticTarget,
  ) => Effect.Effect<ReportStagingDirectory, ReportFileSystemError>;
  readonly writeFileNoFollow: (input: {
    readonly staging: ReportStagingDirectory;
    readonly path: ReportHostOutputPath;
    readonly bytes: Uint8Array;
  }) => Effect.Effect<void, ReportFileSystemError>;
  readonly syncFile: (input: {
    readonly staging: ReportStagingDirectory;
    readonly path: ReportHostOutputPath;
  }) => Effect.Effect<void, ReportFileSystemError>;
  readonly syncStagingDirectory: (
    staging: ReportStagingDirectory,
  ) => Effect.Effect<void, ReportFileSystemError>;
  readonly atomicPublishDirectoryNoReplace: (input: {
    readonly staging: ReportStagingDirectory;
    readonly target: ReportStaticTarget;
  }) => Effect.Effect<void, ReportAtomicPublishError>;
  readonly syncParentDirectory: (
    target: ReportStaticTarget,
  ) => Effect.Effect<void, ReportFileSystemError>;
  readonly removeOwnedStagingDirectory: (
    staging: ReportStagingDirectory,
  ) => Effect.Effect<void, ReportFileSystemError>;
}

class ReportFileSystem extends Context.Tag(
  "@niceeval/report/ReportFileSystem",
)<ReportFileSystem, ReportFileSystemService>() {}
```

File service 使用已打开的 target-parent + canonical leaf capability与owner-relative staging handle，不接受任意拼接path。`ReportHostOutputPath`是`niceeval/report/host`平台边界类型，不从author package导出constructor。

host用同一codec把route HTML、Download、host-data、runtime与reserved`_niceeval`files变成canonical segments。Author `ReportDownloadPath`只是其中一种输入，不是filesystem service的通用path。

`ReportStaticTarget`在open时pin target parent与leaf；create、write、sync、publish和parent sync都复用该capability，不能在publish时按`AbsoluteDirectoryPath`重开。`lstat → path write`不是no-follow实现。Threat model允许同一用户在operation外修改root，但平台必须防止一次operation内跟随symlink/junction/reparse point；无法提供handle-relative primitive时返回capability unsupported。

Atomic no-replace 不是 `exists + rename`。Node layer 必须使用并验收平台原语：Linux `renameat2(RENAME_NOREPLACE)`、macOS `renameatx_np/renamex_np(RENAME_EXCL)`。Windows 使用不带 replace flag 且能证明同 volume、destination-exists failure 与 directory atomicity 的 native move。平台、文件系统或 directory durability 语义无法证明时返回 unsupported；Effect Scope 只保证 cleanup，不创造 OS 原语。

## show

```ts
declare const showReport: (input: {
  readonly execution: ReportExecution;
  readonly format?: "text" | "json";
  readonly page?: ReportRoute;
}) => Effect.Effect<void, ReportShowError, ReportConsole>;
```

Text 与 JSON 都从同一 semantic tree、problems 和 execution codec 派生。`showReport` 不要求 filesystem、server 或 watcher，也不 watch。

JSON stdout 不是 lossless `ReportExecution` transfer，也不内联 Download bytes。唯一 machine schema 是：

```ts
interface ReportShowV1 {
  readonly schema: "niceeval.report-show/v1";
  readonly reportId: ReportId;
  readonly pageSelection:
    | { readonly kind: "all" }
    | { readonly kind: "one"; readonly route: ReportRoute };
  readonly sample: {
    readonly selectedRuns: number;
    readonly totalSlots: number;
    readonly denominator: number;
    readonly included: number;
    readonly notRecorded: number;
    readonly coreInvalid: number;
    readonly excluded: number;
  };
  readonly projections: readonly ReportProjectionExecutionSummary[];
  readonly calculations: readonly {
    readonly calculationId: ReportComponentId;
    readonly state: "available" | "data-unavailable" | "execution-failed";
    /** data-only envelope 的 decoded generic tagged root；绝无 author-specific A。 */
    readonly value?: EncodedPortableValueV1;
    readonly completeness?: CalculationInputCompleteness;
    readonly problemIds: readonly ReportProblemId[];
  }[];
  readonly families: readonly ReportPageFamilyResult[];
  readonly pages: readonly ReportPageResult[];
  readonly downloads: readonly {
    readonly downloadId: ReportComponentId;
    readonly state: "built" | "data-unavailable" | "execution-failed";
    readonly files: readonly {
      readonly path: ReportDownloadPath;
      readonly mediaType: string;
      readonly byteLength: number;
      readonly sha256: string;
    }[];
    readonly problemIds: readonly ReportProblemId[];
  }[];
  readonly problemTable: readonly ReportProblemTableEntry[];
}
```

没有`--page`时pages按route输出全部；有`--page`时只输出exact选中的一页。sample/projections/calculations/family summaries/download metadata与bounded problem table仍完整，`pageSelection`显式标注筛选。所有arrays按execution canonical order，object keys按UTF-8 bytes排序，stdout是UTF-8 canonical JSON。control characters必须escape；非法Unicode scalar在形成execution时已拒绝。

`REPORT_SHOW_JSON_BYTES_MAX = 268_435_456`。Encoder streaming计数并在超过前停止；它不先构造另一份完整JSON string。下游关闭pipe（EPIPE / broken pipe）是正常CLI结束，其它console write/flush failure进入`ReportShowError`，interruption保持Cause。Host不从transport coverage编造业务observed/denominator；只有Calculation value与semantic metric evidence能提供统计口径。

## Theme 与 Config

Theme 与 Config module 是受信任 builder，但它们的输出必须 exact decode 成 data-only value，不能把任意 CSS、renderer 或 callback 带进 revision。

```ts
interface ReportThemeV1 {
  readonly schema: "niceeval.report-theme/v1";
  readonly colors: {
    readonly background: ReportHexColor;
    readonly foreground: ReportHexColor;
    readonly muted: ReportHexColor;
    readonly positive: ReportHexColor;
    readonly warning: ReportHexColor;
    readonly negative: ReportHexColor;
  };
  readonly font: "system-sans" | "system-mono";
  readonly density: "compact" | "comfortable";
  readonly radius: "none" | "small" | "medium";
}

interface ReportViewConfigV1 {
  readonly schema: "niceeval.report-view-config/v1";
  readonly root: string;
  readonly selection: AnalysisSelectionRequest;
  readonly report: ReportSource;
  readonly theme?: ReportThemeSource;
  readonly host?: string;
  readonly port?: number;
  readonly reconciliationIntervalMs?: number;
  readonly buildTimeoutMs?: number;
}
```

颜色只能是 canonical 6-digit sRGB hex。`niceeval.report-theme/v1` 固定采用 WCAG 2.x sRGB relative luminance 与 contrast-ratio 公式。它检查 background/foreground 至少 `4.5:1`，background/muted 与 background/positive、warning、negative 至少 `3:1`。不允许 URL、font bytes、CSS property、raw style、script 或 renderer。非法 Theme / Config 是 typed load/validation error，不是 page execution problem。

Config defaults 与 range 也是 v1 契约：

- host 默认且 Config 只能是 `127.0.0.1` 或 `::1`；
- port 默认 `4173`，只能是 `1..65535` 的整数，`0` 只在显式 request 中表示 ephemeral port；
- `reconciliationIntervalMs` 默认 `2,000`、范围 `250..60,000`；
- revision build timeout 默认 `30,000`、范围 `1,000..300,000`。

所有 numeric field 拒绝 fraction、`NaN`、Infinity 与造成 busy loop 的零值。显式 `openNodeReportView` request 字段优先于 Config 对应字段；其余只来自 exact Config，不读隐式配置。

## Node 热重载 host

热重载只在 `niceeval/report/host/node`。它是明确 Node-only 的 host，不假装把调用者提供的 Record tags、Scope 或 handle structured-clone 给 Worker。

```ts
interface ReportViewRevision {
  readonly revisionId: ReportViewRevisionId;
  readonly execution: ReportExecution;
  readonly theme: ReportThemeV1;
  readonly builtAt: UtcMillis;
}

type ReportViewEvent =
  | { readonly type: "revision-published"; readonly revisionId: ReportViewRevisionId }
  | {
      readonly type: "rebuild-failed";
      readonly problem: ReportViewProblemSummary;
    }
  | { readonly type: "invalidated"; readonly reason: "watch-hint" | "manual" | "reconcile" };

interface ReportViewProblemSummary {
  readonly candidateId: ReportViewCandidateId;
  readonly code:
    | "module-load-failed"
    | "module-invalid"
    | "runtime-singleton-mismatch"
    | "record-open-failed"
    | "selection-failed"
    | "build-limit-exceeded"
    | "worker-crashed"
    | "worker-timeout"
    | "transfer-invalid";
  readonly phase: "load" | "record" | "selection" | "build" | "transfer";
  readonly message: string;
}

interface ReportViewState {
  readonly commitId: ReportViewCommitId;
  readonly current: ReportViewRevision;
  readonly lastProblem?: ReportViewProblemSummary;
}

interface ReportViewSession {
  readonly url: string;
  /** 需要current+lastProblem一致pair时读取这个单一linearizable snapshot。 */
  readonly snapshot: Effect.Effect<
    ReportViewState,
    ReportViewSessionClosed
  >;
  readonly current: Effect.Effect<
    ReportViewRevision,
    ReportViewSessionClosed
  >;
  readonly lastProblem: Effect.Effect<
    ReportViewProblemSummary | undefined,
    ReportViewSessionClosed
  >;
  readonly changes: Stream.Stream<
    ReportViewEvent,
    ReportViewTerminalError
  >;
  readonly refresh: Effect.Effect<
    void,
    ReportViewSessionClosed | ReportViewTerminalError
  >;
}

interface NodeReportViewHostService {
  readonly open: (
    request: ReportViewRequest,
  ) => Effect.Effect<
    ReportViewSession,
    ReportViewOpenError,
    Scope.Scope
  >;
}

class NodeReportViewHost extends Context.Tag(
  "@niceeval/report/NodeReportViewHost",
)<NodeReportViewHost, NodeReportViewHostService>() {}

declare const openNodeReportView: (
  request: ReportViewRequest,
) => Effect.Effect<
  ReportViewSession,
  ReportViewOpenError,
  Scope.Scope | NodeReportViewHost
>;
```

`NodeReportViewHost` 是可替换的高层 service。官方 Live Layer 内部组合 `ReportWatcher`、`ReportServer`、`ReportModuleLoader` 与 `NodeRecordLive`；父调用者不提供或传入 Worker 的 Record service object。高级 `executeReport` 仍在当前进程支持调用方自己的 Record Layers。

### 每个 revision 的真实 loader 模型

1. bundler / module loader 为 Report、Theme 与 Config 形成本 revision 的精确静态 import closure；不受约束的 runtime dynamic import 使 load 失败；
2. 允许的 `niceeval/*` author API 与需要共享 Tag / Schema identity 的 `effect` 入口由 Worker bootstrap 作为 controlled externals提供，绑定到本次host唯一、版本匹配的package instance。author bundle只能包含author graph，不得打入第二份NiceEval runtime、internal deep import、绕路file URL、nested duplicate或不匹配的export condition/version。bundler metafile exact列出author closure与每个external binding；
3. 违反上述约束时在module-load阶段返回typed runtime-singleton/version error，不能拖到private token unknown；
4. 每个 revision 启动新的 Worker 与全新 author module graph。Worker 内部使用 `NodeRecordLive` 打开 frozen reader、形成 selection、project、calculate 与 render。Worker 内部 callback 可以消费 author-specific `Value`。输出前将Calculation result经其data-only codec擦除成generic portable envelope，再输出versioned exact`niceeval.report-execution/v1`与exact Theme/Config data；
5. 父进程只按host schema decode、校验与rebrand，不能信任structured clone，也不能恢复作者类型；
6. Worker bytes 先规范化为 exact-length owned buffers，再通过 transfer list交给父进程；transfer 本身不复制并 detach Worker buffers；
7. Candidate Worker 是 one-shot：成功 transfer pure execution 后立即终止，不驻留到下一 revision。成功、失败、timeout 与 interruption 每条路径都关闭本次 worker ports、temporary bundle、file handles 与 child Scope；
8. 新 revision 完整成功后，父进程才替换 current revision 与 watcher closure。

Worker 隔离解决 ESM cache 与 lifecycle，不是 JavaScript security sandbox。module 仍可 import fs、读取 env 或联网；“纯 callback”是受信任约定，不是 capability boundary。Current-process `executeReport` 不经过bundler，但同样只接受当前package instance的opaque Report/projection/calculation definitions。另一份NiceEval runtime产生的对象在definition validation阶段失败。

Node `fs.watch` 只提供 lossy/coalesced hint，不能承诺观察每次变更。Live host 在 hint、rename、overflow、periodic interval 与 manual refresh 后对入口和完整 closure 做 stat + digest reconciliation。平台 watch 不足时使用 poll fallback；连 fallback 也无法提供才返回 watch unsupported。失败 revision 保留 last-good execution，并继续 watch 上次成功 closure、entry 与父目录，直到下一次 reconciliation 成功。

唯一权威状态是单一`Ref`/`SynchronizedRef<ReportViewState>`，一次`set`/`modify`原子提交`current + lastProblem + commitId`。`session.snapshot`读取一致pair；`current`与`lastProblem`只是分别投影的便利getter，连续调用只能各自linearize，不能声称属于同一snapshot。`REPORT_VIEW_EVENTS_CAPACITY = 64`；通知使用这个固定容量的`PubSub.sliding`，只广播revisionId或含candidateId的`ReportViewProblemSummary`。

Summary的code/phase是闭合枚举，message经过UTF-8截断后最多1,024 bytes；完整issues、cause、payload与execution不进入PubSub。Sliding允许慢订阅者丢失中间通知，消费者收到任何事件后重新读authoritative snapshot，不按事件重建状态。

成功commit用单次atomic Ref update把新current与`lastProblem: undefined`一起发布；失败用单次update保留current并替换bounded lastProblem。state swap之后，短`uninterruptibleMask`只保护当前fiber完成small hint publish；它不是mutex或STM，也不阻止其它fiber读取，但任何reader都看不到torn state。丢hint不影响权威state。候选构建与encode保持可中断。

Revision success 取决于 host 能否形成 exact、bounded `ReportExecution` envelope与built-in problems surface，不取决于作者graph是否零问题：

| candidate outcome | initial open | later rebuild |
|---|---|---|
| recorded data problem | publish revision | publish revision |
| 已隔离 projector / output-codec / Calculation / Page / Family / Download problem | publish revision + built-in problems | publish replacement revision + built-in problems |
| 非法单页tree、author route/path conflict，但host仍可形成family/page result与problems surface | publish revision | publish replacement revision |
| Report/Config/Theme无法load或host-owned输出无法exact decode | typed `ReportViewOpenError` | `rebuild-failed`，保留last-good |
| Record open/migration-required、selection/read global typed E | typed `ReportViewOpenError` | `rebuild-failed`，保留last-good |
| global limit、Worker crash/timeout、wire digest/closure或execution envelope validation failure | typed `ReportViewOpenError` | `rebuild-failed`，保留last-good |
| watch/server/worker supervisor terminal failure | typed open error | `changes` typed fail并关闭session |
| interruption | Effect Cause + finalizers | Effect Cause + finalizers |

Author route/download/asset永远不能占用reserved host namespace `_niceeval`。它刻意不属于author route grammar，也不是`ReportRoute`。

Package-private `ReportHostUrl` / `ReportHostOutputPath` codec 固定把problems URL `/_niceeval/problems/`映射到static path `_niceeval/problems/index.html`。它不套用author `/a/b → a/b/index.html`算法。Problems document仍是host-owned exact `ReportDocumentV1`，经过相同semantic validation与renderer。

Host files与author outputs仍进入同一exact、ASCII-casefold、file/directory-prefix和Windows collision set。Author collision只让相关component成为execution problem，不能破坏host problems output。Server没有有效author root page时，在同一session capability下把root 302到host problems URL。static生成host-owned fallback `index.html`，用`./_niceeval/problems/index.html`链接problems。

存在author root时也保留不可关闭的problems surface/link。

每个 revision 是固定的一次 `ReportExecution`。热重载通过创建下一份 execution 保留；show 与 static export 永远不 watch。

View 默认只监听 loopback，Config 无权改成 non-loopback。若产品支持网络监听，必须同时由显式 CLI `--host <address>` 与 `--allow-network-view` 授权，不能由配置文件或 DNS 名隐式开启。

Server 校验 `Host` 与 `Origin`，默认拒绝 CORS；每个 session 使用不可预测的 capability URL。HTTP 面只提供 read-only GET，`refresh` 只由本地 CLI / session Effect 调用，不暴露普通 mutating endpoint。

若未来增加远端 refresh，必须另行定义 method、same capability、Origin 与 CSRF 契约。Host mismatch 与 DNS rebinding 一律拒绝。

## Static export

```ts
declare const exportStaticReport: (input: {
  readonly execution: ReportExecution;
  readonly theme?: ReportThemeV1;
  readonly out: AbsoluteDirectoryPath;
}) => Effect.Effect<
  ReportStaticExportReceipt,
  ReportExportError,
  ReportFileSystem
>;
```

Recorded data problems 可以导出，并由所有页面不可关闭的 built-in problems surface 显示。任一 execution problem、非法 tree/path/link、collision、limit 或 closure mismatch 在创建正式 target 前 fail closed。

Exporter 在 target 同父、同 filesystem 的 owned staging directory 写完整 closure。它包含HTML、portable host-data manifest、digest-named buffers、downloads、built-in renderer 与 asset manifest。逐文件 sync，随后 sync staging directory；使用 atomic no-replace publish 后再 sync parent directory。目标已存在返回 target-exists；unsupported 不 fallback 到 `exists + rename`、copy 或 replace。

Static runtime 不访问 Record、网络、调用进程或未来 NiceEval。真实浏览器离线、JavaScript disabled 的验收必须检查嵌套页面互链、根页面、download 与 built-in problems surface。

## Stable resource limits

所有 host 使用 `niceeval.report-limits/v1`。降低任一 maximum 是 breaking contract，必须发布新 profile；实现不能散落匿名 magic numbers。

| 常量 | maximum | 计数范围 |
|---|---:|---|
| `REPORT_PROJECTIONS_MAX` | 128 | 一个 execution 的 declarations |
| `REPORT_LOGICAL_ENTRIES_MAX` | 250,000 | 全部 projections 合计，不乘 128 |
| `REPORT_PROJECTED_VALUE_BYTES_MAX` | 134,217,728 | Worker 内 transient projected manifests + raw buffers 合计 |
| `REPORT_CALCULATIONS_MAX` | 256 | 一个 Report |
| `REPORT_PAGE_FAMILIES_MAX` | 128 | 一个 Report |
| `REPORT_PAGES_MAX` | 20,000 | fixed + expanded pages |
| `REPORT_DOCUMENT_DEPTH_MAX` | 32 | 每份 semantic document |
| `REPORT_DOCUMENT_NODES_MAX` | 20,000 | 每份 semantic document |
| `REPORT_DOCUMENT_STRING_BYTES_MAX` | 1,048,576 | 单一 string |
| `REPORT_DOCUMENT_BYTES_MAX` | 8,388,608 | 单一 canonical document |
| `REPORT_DOCUMENTS_BYTES_MAX` | 134,217,728 | 全部 documents，且是 execution manifest 子集 |
| `REPORT_EXECUTION_MANIFEST_BYTES_MAX` | 134,217,728 | calculations、pages、problems、theme 的 canonical data；不含 downloads |
| `REPORT_DOWNLOAD_FILES_MAX` | 1,000 | 全部 downloads |
| `REPORT_DOWNLOAD_FILE_BYTES_MAX` | 33,554,432 | 单一 normalized file buffer |
| `REPORT_DOWNLOAD_BYTES_MAX` | 134,217,728 | 全部 normalized download buffers |
| `REPORT_EXECUTION_WIRE_BYTES_MAX` | 268,435,456 | manifest + transferable download buffers |
| `REPORT_CONTROLLED_BUFFER_BYTES_MAX` | 536,870,912 | host-owned normalized snapshots、canonical manifests 与 transfer buffers |
| `REPORT_ASSET_ENTRIES_MAX` | 50,000 | static closure 全部 files |
| `REPORT_STATIC_ASSET_BYTES_MAX` | 1,342,177,280 | escaped HTML、host-data、downloads 与 runtime 合计 |

Projected portable budget 与 whole execution wire budget 是两件事；二者不能复用同一个 128 MiB ceiling。Execution wire 使用小型 canonical manifest + raw transferable buffers，不内联 base64。Parent exact decode/reassembly 后再次检查 manifest、downloads、wire 与 static closure budgets。

`REPORT_CONTROLLED_BUFFER_BYTES_MAX` 只约束 host 可以精确计数的 encoded/snapshot buffers，不是 process RSS 或 JavaScript heap guarantee。V8 object overhead、module graph allocation 与 trusted callback 在返回前的分配不在这项常量内；因此文档不承诺靠它消灭所有 OOM。

```ts
interface ReportLimitExceeded {
  readonly code: "report-limit-exceeded";
  readonly profile: "niceeval.report-limits/v1";
  readonly limit: ReportLimitName;
  readonly maximum: number;
  readonly observedAtLeast: number;
  readonly consumer?: {
    readonly kind: "projection" | "calculation" | "family" | "page" | "download" | "export";
    readonly id: string;
    readonly route?: ReportRoute;
    readonly path?: ReportDownloadPath;
  };
}
```

Host 在分配 fixed collection 前检查已知 count，在 owner loop、Iterable、semantic traversal 与 file stream 中累计其余 limits。必要时使用 Scope-owned spool / staging asset，不把所有 binary 再复制成 base64 string。第三方 trusted callback 在返回前自行 OOM 仍是扩展代码缺陷；不可信 Record input不能绕过 host budgets。

## Typed errors

```ts
type ReportExecutionError =
  | RecordOpenError
  | RecordReadError
  | AnalysisSelectionError
  | ProjectionLimitError
  | ReportLimitExceeded
  | { readonly code: "report-definition-invalid"; readonly issues: NonEmptyReportIssues }
  | { readonly code: "report-selection-closed" };

type ReportShowError = ReportConsoleError | {
  readonly code: "report-show-render-failed";
  readonly operation: string;
};

type ReportViewOpenError =
  | RecordOpenError
  | RecordReadError
  | AnalysisSelectionError
  | ReportExecutionError
  | ReportLimitExceeded
  | { readonly code: "report-view-module-load-failed"; readonly source: "report" | "theme" | "config" }
  | { readonly code: "report-view-module-invalid"; readonly source: "report" | "theme" | "config" }
  | { readonly code: "report-view-worker-spawn-failed" }
  | { readonly code: "report-view-worker-crashed" }
  | { readonly code: "report-view-worker-timeout" }
  | { readonly code: "report-view-listen-failed"; readonly operation: string }
  | { readonly code: "report-view-watch-unsupported"; readonly reason: string };

type ReportViewRebuildError =
  | ReportExecutionError
  | ReportLimitExceeded
  | { readonly code: "report-view-module-load-failed"; readonly source: "report" | "theme" | "config" }
  | { readonly code: "report-view-module-invalid"; readonly source: "report" | "theme" | "config" }
  | { readonly code: "report-view-worker-crashed" }
  | { readonly code: "report-view-worker-timeout" };

type ReportViewTerminalError =
  | { readonly code: "report-view-watch-failed"; readonly operation: string }
  | { readonly code: "report-view-server-failed"; readonly operation: string }
  | { readonly code: "report-view-worker-supervisor-failed"; readonly operation: string };

type ReportExportError =
  | ReportLimitExceeded
  | { readonly code: "report-export-execution-problem"; readonly problems: readonly ReportExecutionProblem[] }
  | { readonly code: "report-export-path-invalid"; readonly issues: readonly ReportPathIssue[] }
  | { readonly code: "report-export-closure-invalid"; readonly issues: NonEmptyReportIssues }
  | { readonly code: "report-export-target-exists" }
  | { readonly code: "report-export-cross-device" }
  | { readonly code: "report-export-atomic-publish-unsupported"; readonly reason: string }
  | { readonly code: "report-export-write-failed"; readonly operation: string };
```

Typed failure、defect 与 interruption 始终分开。公开错误不泄露 payload、secret、任意 filesystem path 或 raw system cause；diagnostic log 可以在显式 debug policy 下写出安全 redaction 后的内部 cause。

## 冻结验收

本契约不能只用 Markdown lint 验收。实现前必须用仓库锁定的 TypeScript 与 `effect@3.22.1` 编译公开 call-site fixture，至少证明：

- 普通 named interface 可以成为 Channel projector / Calculation value，不需要 index signature、显式 generic 或 `as`；
- wrong Record owner、projected Value 或 access kind 不能赋值；private TypeId / variance 真实参与 generic structure；
- `ReportConsole`、`ReportFileSystem`、Node view host 与 Record read Tags 的 Effect R 精确且可由 Layer 提供；
- `Either.right/left`、全部公开 Effect E unions 与 Scope lifecycle 可编译；
- per-Assertion、turn/tool-call、diagnostics category、四态/partial、direct script、Effect lifecycle 与 typed producer 七类完整调用点均能推断；
- 所有文档 snippets 无 duplicate generic、brace、invented `Result` 或 nested runtime。

## 相关阅读

- [Reports README](README.md)：用户心智与功能边界。
- [Architecture](architecture.md)：Record → Analysis → Projection → Report → host 的层次。
- [Calculations](calculations.md)：通过率、score 与 completeness。
- [Projection Library](../projection/library.md)：逻辑访问与 portable envelope。
- [Record Library](../record/library.md)：typed Channel、reader 与平台边界。
