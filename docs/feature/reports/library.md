# 报告作者 API —— Library

本页是 Reports 的公开类型 owner。它定义 plan、request、Calculation、数据、页面树与 artifact 的完整形状；主题和 shell 的专属类型只在本 Feature 的[主题](library/theme.md)与[外壳](library/shell.md)定义。

阶段与 Store 边界见 [Architecture](architecture.md)，固定输入的完整形状见 [Sample Library](../sample/library.md)。

## 外部类型 owner

Reports 不复制以下 Record 或 Sample 类型：

- [Record 的 Attempt、Contribution 与 Projector 类型](../record/library.md#runcontribution-与-attempt-handle)；
- [Record 的 EvidenceValue、EvidenceRef、UnavailableCause 与 Verification](../record/library.md#evidencevaluevalue-与-verification-两轴)；
- [Record 的 ProjectionIdentityV1](../record/library.md#projection-identity-与-memo)；
- [Record 的 RecordSourceSet 与 Projector error](../record/library.md#打开-record)；
- [Record 的统一 evidence proof index](../record/architecture.md#完整镜像与选择性证明)；
- [Sample 的 SampleSelector、SampleRef 与 SampleSources](../sample/library.md#选择器source-集合与-sampleref)；
- [Sample 的 SampleMembership 与 SampleMembershipAddressV1](../sample/library.md#成员address-与-member-identity)；
- [Sample 的 MaterializedSample](../sample/library.md#materializedsample-与构造入口)。

```ts
import type {
  AttemptProjector,
  AttemptRef,
  EvidenceRef,
  EvidenceValue,
  NonEmptyArray,
  ProjectionIdentityV1,
  ProjectorExecutionError,
  ProjectorId,
  ProjectorInputError,
  ProjectorReadError,
  ProjectorRegistrationError,
  RecordReadError,
  RecordEvidenceProofFailure,
  RecordEvidenceProofIndexRefV1,
  RecordGraphRef,
  RecordSourceFailure,
  RecordSourceSet,
  UnavailableCause,
  Verification,
} from "niceeval/record";
import type {
  MaterializedSample,
  SampleMembership,
  SampleMembershipAddressV1,
  SampleMembershipSlotV1,
  SampleRef,
  SampleSelector,
  SampleSources,
  SampleValidationError,
} from "niceeval/sample";
```

`ThemeDefinition` 的唯一形状见[主题 Library](library/theme.md#公开形状)；`DimensionPins` 的唯一形状见[外壳 Library](library/shell.md#dimensionpins)。它们都在同一 Reports Feature 中，不能由报告作者另造相近接口。

## 通用值、文本与参数

```ts
type ReportJsonPrimitive = null | boolean | number | string;
type ReportJsonValue =
  | ReportJsonPrimitive
  | readonly ReportJsonValue[]
  | { readonly [key: string]: ReportJsonValue };
type ReportJsonObject = {
  readonly [key: string]: ReportJsonValue;
};

type ReportLocale = string;

type LocalizedText =
  | string
  | {
      readonly default: string;
      readonly translations?: Readonly<Record<ReportLocale, string>>;
    };

function resolveLocalizedText(
  value: LocalizedText,
  locale: ReportLocale,
): string;

type ReportParameterField =
  | {
      readonly kind: "string";
      readonly default?: string;
      readonly enum?: readonly string[];
    }
  | { readonly kind: "boolean"; readonly default?: boolean }
  | {
      readonly kind: "number";
      readonly default?: number;
      readonly minimum?: number;
      readonly maximum?: number;
    };

type ReportParameterSpec = Readonly<
  Record<string, ReportParameterField>
>;

type ReportParameterValue<Field extends ReportParameterField> =
  Field extends { readonly kind: "string" }
    ? string
    : Field extends { readonly kind: "boolean" }
      ? boolean
      : number;

type ReportParametersOf<Spec extends ReportParameterSpec> = {
  readonly [Key in keyof Spec]: ReportParameterValue<Spec[Key]>;
};

interface ReportParameterSchema<Parameters extends ReportJsonObject> {
  readonly schema: string;
  normalize(input?: ReportJsonObject): Parameters;
}

function reportParameters<Spec extends ReportParameterSpec>(
  schema: string,
  fields: Spec,
): ReportParameterSchema<ReportParametersOf<Spec>>;
```

`LocalizedText` 的 string 形态不随 locale 改变；对象形态先取完全匹配的 translation，再回退到 `default`。`ReportLocale` 是 BCP 47 tag，未知 tag 也必须走 default，而不是抛出或读取新数据。

`ReportParameterSchema.normalize()` 是纯函数。它拒绝未知字段、填满 default，并返回可以 JCS 编码的对象。schema 或 normalizer 语义变化必须改变报告定义版本或 module graph；参数原值与 normal value 都不允许在 render 时读取。

## 静态定义、route 与页面树

```ts
interface HeadTitleTag {
  readonly kind: "title";
  readonly text: LocalizedText;
}

interface HeadMetaNameTag {
  readonly kind: "meta-name";
  readonly name: string;
  readonly content: string;
}

interface HeadMetaPropertyTag {
  readonly kind: "meta-property";
  readonly property: string;
  readonly content: string;
}

interface HeadLinkTag {
  readonly kind: "link";
  readonly rel: string;
  readonly href: string;
  readonly media?: string;
}

type HeadTag =
  | HeadTitleTag
  | HeadMetaNameTag
  | HeadMetaPropertyTag
  | HeadLinkTag;

interface ReportRoute {
  readonly pathname: string;
  readonly parameters: Readonly<Record<string, string>>;
}

interface ReportTarget {
  readonly pageId: string;
  readonly instanceId: string;
}

type ReportNodeValue = ReportJsonValue;

interface ReportTextNode {
  readonly kind: "text";
  readonly text: LocalizedText;
}

interface ReportElementNode {
  readonly kind: "element";
  readonly component: string;
  readonly props: Readonly<Record<string, ReportNodeValue>>;
  readonly children: readonly ReportNode[];
}

interface ReportFragmentNode {
  readonly kind: "fragment";
  readonly children: readonly ReportNode[];
}

interface RendererAssets {
  readonly styles?: readonly string[];
  readonly scripts?: readonly string[];
}

interface RendererContext {
  readonly locale: ReportLocale;
  readonly target: ReportTarget;
}

interface RendererDefinition<
  Value extends ReportNodeValue,
  Options extends ReportNodeValue = ReportNodeValue,
> {
  readonly id: string;
  readonly assets?: RendererAssets;
  text(value: Value, options: Options, context: RendererContext): ReportNode;
  web(value: Value, options: Options, context: RendererContext): ReportNode;
}

interface ReportRendererNode {
  readonly kind: "renderer";
  readonly renderer: RendererDefinition<ReportNodeValue>;
  readonly value: ReportNodeValue;
  readonly options: ReportNodeValue;
}

type ReportNode =
  | ReportTextNode
  | ReportElementNode
  | ReportFragmentNode
  | ReportRendererNode;

function defineRenderer<
  Value extends ReportNodeValue,
  Options extends ReportNodeValue = ReportNodeValue,
>(
  definition: RendererDefinition<Value, Options>,
  moduleUrl?: string | URL,
): RendererDefinition<Value, Options>;
```

`ReportRoute.pathname` 是以 `/` 开头的静态路径；`parameters` 只来自 plan 已枚举的 instance。`ReportTarget` 由 page id 与 instance id 唯一定位这份 plan 中的一页，不能表示“任意 locator”。

`ReportNode` 是本次执行期间冻结的双面结果树。JSX 和官方组件先形成这四种节点，再分别交给
text 与 web renderer。Renderer 的 `text` 和 `web` 都是纯函数，不能读 Sample、Record、Store、
网络、时钟或新 request。assets 只增强已经形成的树。

`RendererAssets.styles` 与 `scripts` 的 string 是 source asset path，不是 inline content 或输出路径。
只要任一数组非空，`defineRenderer()` 的 `moduleUrl` 就必填，且必须等于 frozen module graph 中定义
该 renderer 的 canonical module URL。source path 使用 relative POSIX syntax；移除唯一可选的 `./`
后必须非空，并拒绝 absolute path、URL scheme、backslash、NUL、query、fragment，以及空、`.` 或
`..` segment。styles 只接受 `.css`，scripts 只接受 `.js` 或 `.mjs`。

loader 以 renderer module 的目录 URL 对 source path 做 URL resolution，并再次确认结果仍在该目录
subtree 内。
style media type 固定为 `text/css; charset=utf-8`；script 分别使用
`text/javascript; charset=utf-8` 或 `text/javascript+module; charset=utf-8`。只有实际出现在所选 target
生成树中的 renderer 才收集资产；读取失败或同一 canonical source URL 得到不同 bytes 使用
`report-module-graph-invalid` 的 asset issue。

输出 path 由 raw bytes 的 SHA-256 与 canonical extension 生成：
`assets/<64-lowercase-hex>.<css|js|mjs>`。相同 path 只有在 raw bytes、mediaType 与 byteLength 全部相同
时才能 dedupe；否则是 `asset-conflict`。页面按首次 renderer occurrence 保留 stylesheet 与 script
引用顺序，artifact 的资产表则按输出 path 的 UTF-8 bytes 升序且唯一。调用方提供的 path 从不直接
传给 Artifact Store。

`ReportRendererNode.renderer` 含函数，因此 `ReportNode` 不能进入 artifact payload。executor 在内存
里把同一棵树分别消费成最终 text 与 HTML 后即释放它；持久化边界只保存本页[导出报告](#导出报告)
定义的纯 JSON page payload 与资产 bytes。

## `ReportDefinition`、request 与 `ReportData`

```ts
interface ReportDefinitionInput<Parameters extends ReportJsonObject> {
  readonly parameters?: ReportParameterSchema<Parameters>;
  readonly title?: LocalizedText;
  readonly theme?: ThemeDefinition;
  readonly dimensionPins?: DimensionPins;
  readonly head?: readonly HeadTag[];
  plan(input: ReportPlanInput<Parameters>): ReportPlan;
}

declare const reportDefinitionBrand: unique symbol;

interface ReportDefinition<Parameters extends ReportJsonObject>
  extends ReportDefinitionInput<Parameters> {
  readonly [reportDefinitionBrand]: "niceeval.report-definition/1";
}

interface ReportPlanInput<Parameters extends ReportJsonObject> {
  readonly sample: MaterializedSample;
  readonly parameters: Parameters;
}

function defineReport<Parameters extends ReportJsonObject>(
  definition: ReportDefinitionInput<Parameters>,
): ReportDefinition<Parameters>;

declare const frozenReportDefinitionBrand: unique symbol;

interface FrozenReportDefinition<Parameters extends ReportJsonObject> {
  readonly [frozenReportDefinitionBrand]: "niceeval.frozen-report-definition/1";
  readonly definition: ReportDefinition<Parameters>;
  readonly identity: ReportDefinitionIdentity;
}

function loadReportDefinition<Parameters extends ReportJsonObject = ReportJsonObject>(
  entryModule: string | URL,
): Promise<FrozenReportDefinition<Parameters>>;

interface ReportConstant<Value extends ReportJsonValue> {
  readonly kind: "constant";
  readonly value: Value;
}

function constant<Value extends ReportJsonValue>(
  value: Value,
): ReportConstant<Value>;

type AnyAttemptProjector = AttemptProjector<
  ReportJsonObject,
  ReportJsonObject,
  ReportJsonValue
>;

type ProjectorInput<Projector extends AnyAttemptProjector> =
  Projector extends AttemptProjector<
    infer Input extends ReportJsonObject,
    ReportJsonObject,
    ReportJsonValue
  >
    ? Input
    : never;

type ProjectorValue<Projector extends AnyAttemptProjector> =
  Projector extends AttemptProjector<
    ReportJsonObject,
    ReportJsonObject,
    infer Value extends ReportJsonValue
  >
    ? Value
    : never;

interface ProjectorRequest<
  Projector extends AnyAttemptProjector = AnyAttemptProjector,
  RequestId extends string = string,
> {
  readonly kind: "projector";
  readonly requestId: RequestId;
  readonly projector: Projector;
  readonly input?: ProjectorInput<Projector>;
}

function projectorRequest<
  Projector extends AnyAttemptProjector,
  RequestId extends string,
>(input: {
  readonly requestId: RequestId;
  readonly projector: Projector;
  readonly input?: ProjectorInput<Projector>;
}): ProjectorRequest<Projector, RequestId>;

interface ReportProjectorFailureRequest {
  readonly address: ReportProjectorRequestAddressV1;
  readonly projector: ProjectorId;
}

type AnyProjectorRequest = ProjectorRequest<AnyAttemptProjector>;

type ProjectorRequestValue<Request extends AnyProjectorRequest> =
  ProjectorValue<Request["projector"]>;

interface CalculationIdentity {
  readonly schema: "niceeval.calculation/1";
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
}

interface ReportCalculationRequestAddressV1 {
  readonly schema: "niceeval.report-calculation-request-address/1";
  readonly page: ReportTarget;
  readonly dataKey: string;
  readonly requestId: string;
  readonly scope:
    | {
        readonly kind: "member";
        readonly membership: SampleMembershipAddressV1;
      }
    | {
        readonly kind: "sample";
        readonly sample: SampleRef;
      };
}

type ReportCalculationDependencyInvocationV1 =
  | { readonly kind: "member-root" }
  | {
      readonly kind: "aggregate-measure";
      readonly measure: string;
    };

type ReportProjectorRequestOriginV1 =
  | {
      readonly kind: "calculation-dependency";
      readonly calculation: CalculationIdentity;
      readonly invocation: ReportCalculationDependencyInvocationV1;
      readonly requestId: string;
    }
  | {
      readonly kind: "aggregate-group";
      readonly groupIndex: number;
      readonly groupId: string;
      readonly projector: ProjectorId;
    };

interface ReportProjectorRequestAddressV1 {
  readonly schema: "niceeval.report-projector-request-address/1";
  readonly calculation: ReportCalculationRequestAddressV1;
  readonly membership: SampleMembershipAddressV1;
  readonly origin: ReportProjectorRequestOriginV1;
}

interface NormalizedProjectorRequest {
  readonly address: ReportProjectorRequestAddressV1;
  readonly projection: ProjectionIdentityV1;
}

interface CalculationInput<
  Requests extends readonly AnyProjectorRequest[],
> {
  readonly member: SampleMembership;
  get<Request extends Requests[number]>(
    request: Request,
  ): EvidenceValue<ProjectorRequestValue<Request>>;
}

interface Calculation<
  Output extends ReportJsonValue,
  Requests extends readonly AnyProjectorRequest[] = readonly AnyProjectorRequest[],
> {
  readonly identity: CalculationIdentity;
  readonly configuration: ReportJsonObject;
  readonly requests: Requests;
  evaluate(input: CalculationInput<Requests>): EvidenceValue<Output>;
}

function defineCalculation<
  Output extends ReportJsonValue,
  Requests extends readonly AnyProjectorRequest[],
>(input: {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly requests: Requests;
  evaluate(input: CalculationInput<Requests>): EvidenceValue<Output>;
}): Calculation<Output, Requests>;

interface CalculationRequest<Output extends ReportJsonValue> {
  readonly kind: "calculation";
  readonly requestId: string;
  readonly member: SampleMembership;
  readonly calculation: Calculation<Output>;
}

function calculationRequest<Output extends ReportJsonValue>(input: {
  readonly requestId: string;
  readonly member: SampleMembership;
  readonly calculation: Calculation<Output>;
}): CalculationRequest<Output>;

interface AggregateRequest<
  Groups extends readonly GroupKey[],
  Measures extends Record<string, Calculation<number>>,
> {
  readonly kind: "aggregate";
  readonly requestId: string;
  readonly sample: MaterializedSample;
  readonly by: Groups;
  readonly measures: Measures;
  readonly unavailable: UnavailablePolicy;
}

interface AggregateMeasureConfigurationV1 {
  readonly calculation: CalculationIdentity;
  readonly configuration: ReportJsonObject;
}

type AggregateGroupConfigurationV1 =
  | { readonly kind: "built-in"; readonly key: BuiltInGroupKey }
  | { readonly kind: "custom"; readonly id: string };

interface AggregateCalculationConfigurationV1 {
  readonly id: string;
  readonly by: readonly AggregateGroupConfigurationV1[];
  readonly measures: Readonly<
    Record<string, AggregateMeasureConfigurationV1>
  >;
  readonly unavailable: UnavailablePolicy;
}

type AnyAggregateRequest = AggregateRequest<
  readonly GroupKey[],
  Record<string, Calculation<number>>
>;

type ReportDataLeaf =
  | ReportConstant<ReportJsonValue>
  | CalculationRequest<ReportJsonValue>
  | AnyAggregateRequest;

type ReportDataRequest = Readonly<Record<string, ReportDataLeaf>>;

type ReportDataValueForLeaf<Leaf extends ReportDataLeaf> =
  Leaf extends ReportConstant<infer Value extends ReportJsonValue>
    ? Value
    : Leaf extends CalculationRequest<infer Value extends ReportJsonValue>
      ? EvidenceValue<Value>
      : Leaf extends AggregateRequest<
            infer Groups extends readonly GroupKey[],
            infer Measures extends Record<string, Calculation<number>>
          >
        ? AggregateData<Groups, Measures>
        : never;

type ReportData<Request extends ReportDataRequest = ReportDataRequest> = {
  readonly [Key in keyof Request]: ReportDataValueForLeaf<Request[Key]>;
};

interface ReportPageBody<Request extends ReportDataRequest = ReportDataRequest> {
  readonly id: string;
  readonly title: LocalizedText;
  readonly navigation?: boolean;
  readonly data: Request;
  render(data: ReportData<Request>): ReportNode;
}

type ReportPageInput<Request extends ReportDataRequest = ReportDataRequest> =
  ReportPageBody<Request> &
    (
      | {
          readonly instanceId?: never;
          readonly route?: never;
        }
      | {
          readonly instanceId: string;
          readonly route: ReportRoute;
        }
    );

interface PlannedPage<Request extends ReportDataRequest = ReportDataRequest> {
  readonly id: string;
  readonly instanceId: string;
  readonly route: ReportRoute;
  readonly title: LocalizedText;
  readonly navigation: boolean;
  readonly data: Request;
  render(data: ReportData<Request>): ReportNode;
}

interface ReportPlan {
  readonly pages: readonly [ReportPageInput, ...ReportPageInput[]];
}
```

`defineReport()` 只构造 runtime-branded author definition；它没有模块图 identity，不能直接进入
`exportReport()`。CLI、show、view 与 Library 使用者都通过 `loadReportDefinition(entryModule)` 加载
报告入口。

loader 使用 NiceEval 的同一 ESM module loader 评估入口并捕获完整静态 module graph。它验证默认
导出是 branded `ReportDefinition`，再返回 canonical-copy、deep-freeze 的
`FrozenReportDefinition`。普通 import 后拿到的 definition、结构相同的对象或调用方手写的 identity
都不能伪造这项 capability。

string 入口以调用进程的 canonical cwd 为基准做路径 resolution；URL 入口必须是 local `file:` URL。
路径规范化完成后，identity 只保存 absolute module URL，不保存 cwd。dynamic import、网络 URL、
query、fragment、NUL、无法读取的模块或 loader registry 未声明的 scheme 都使加载失败。

每个 import target 都必须成为同形 `ReportModuleEntry`。本地源码的 entry 描述原始 source bytes；
NiceEval runtime 使用 `niceeval:` virtual URL，其 entry 描述带 package version 与公开 module id 的
versioned JCS manifest bytes。未来 loader 可以注册新的 immutable URL scheme 与 media type；graph
schema 不增加 runtime-specific union，decoder 也按完整 entry 保留未知 media type。

`plan()` 只读取 MaterializedSample 的 identity、sources、membership、coverage 与 provenance。它不能
读取 Projection value、Store、网络、时钟或随机数。`ReportDataRequest` 的每个顶层值只能是
`constant()`、带显式 member 的 `CalculationRequest`，或 sample-wide `AggregateRequest`。输出对象
可以是复杂 JSON 值，但不能作为第二层 request 树。`ProjectorRequest` 只属于 Calculation 的静态
dependency，不是 page data leaf。

Projector、Calculation、`mapEvidence()` 与最终 `ReportArtifactPageV1.data` 的值都必须属于
`ReportJsonValue`。

定义和执行结果边界都拒绝非有限数字、非 plain object、未知 prototype、`undefined`、函数、symbol、循环引用与其它不能 JCS 的值。通过校验后，值 encode/decode 成 canonical plain JSON，再 deep-freeze。

定义无效、request 无效与执行结果无效分别进入 definition、request 与 execution failure。任意 JavaScript object 不能留到 renderer 或 artifact serializer 再猜。

`ProjectorRequest.requestId` 只在声明它的单个 Calculation `requests` 数组内唯一。构造 Calculation 时，
相同 id 的重复或不同 Projector/input 冲突先被拒绝；membership 尚未展开，也不会参与这项冲突判断。
request id 只用于类型安全取值，绝不参与 Record Projector 的 id。

每个展开后的 calculation dependency 还必须保存 invocation。显式 member `CalculationRequest` 使用
`{ kind: "member-root" }`。Aggregate 的每个具名 measure 使用
`{ kind: "aggregate-measure", measure }`。其中 measure 是 options.measures 的完整 property key。

因此 `{ a: calc, b: calc }` 即使复用同一个 Calculation object 与同一个 local requestId，也形成两个
不同 `ReportProjectorRequestAddressV1` consumer。

measure 不能为空 string。构造时按 property name 的 JCS UTF-8 bytes 规范化，不能按对象插入顺序或
Calculation identity 折叠。

executor 对每项 `input` 调用 Record projector 的 normalizer，随后以 Record-owned
`ProjectionIdentityV1` 规范化和 memoize。该 identity 含完整 Graph、Attempt、adopted node、Projector
id、parameter schema 与 normalized input，不能由对象键或 `String(projector.id)` 代替。

`ProjectorRequest.input` 可省略；runtime 以空对象进入 Projector 的同一个 normalizer。

`ReportPageInput` 是 `plan()` 唯一的作者侧页面形状。普通页面可以同时省略 `instanceId` 与
`route`；executor 立即把它规范化为字段完整的 `PlannedPage`：`instanceId = id`、pathname 为
`"/" + id`、route parameters 为空对象、`navigation = true`。这种缩写只接受匹配
`^[a-z0-9]+(?:[._-][a-z0-9]+)*$` 的 `id`，因此默认 pathname 不需要猜测转义。

显式提供 `instanceId` 或 `route` 时必须两者同时提供；参数化页面一律走这一支。executor 在执行
任何 request 前检查 id 与 instanceId 非空、pathname 以 `/` 开头且不含 query / fragment、
parameters 是 string map，并拒绝重复 `(id, instanceId)` 与重复 route。失败进入
`report-plan-invalid`，不会用 URL、locator 或 Sample 字段补猜。校验后 executor canonical-copy、
deep-freeze `PlannedPage`；artifact 再从它机械生成字段同样完整、但不含 data 与函数的
`ReportPlannedPage`。

Projector definition 的 `parameters.defaults` 是完整规范化 Params，`dependencies` 是实际
`AttemptProjector` object 数组而不是 id 数组；省略 dependencies 时规范化为空数组。

runtime 对 defaults、dependency 数组、normalized Params 与 raw `projectNormalized()` result 做
canonical copy / deep-freeze。Report executor 接收 raw `T` 后才依据 tracked read 构造
`EvidenceValue<T>`；Projector 作者不能返回 available/unavailable decision 或伪造 cause、issue、
verification 与 basedOn。

嵌套 `ctx.project()` 只允许调用同一 definition 已声明的 object dependency。定义期检查无效
dependency object 与完整依赖图 cycle。registration 只检查同一完整 ID 的不同 object。
执行期传入未声明 dependency 则保留 `ProjectorExecutionError / projector-undeclared-dependency`。
Reports 不能把相同 `ProjectorId` 的另一个 object 当作已声明依赖。

`CalculationInput.get(request)` 只接受声明在同一 Calculation `requests` 数组中的 object。它返回该 request 的 `EvidenceValue`，不会把 Projector id 隐式转成 `[object Object]`，也不会让 Calculation 看见未声明的输入。

`calculationRequest({ member, ... })` 只执行该显式 member。member 必须逐字属于已验证 Sample；它同时
进入 `ReportCalculationRequestAddressV1.scope`，因此单成员详情页不会靠 route、数组位置或 locator
选择 Attempt。`aggregate(sample, ...)` 是另一种 sample-wide root request；它按 Sample owner 的有序
members 与 coverage 执行，不能省略、替换或动态增加成员。

两种 root 都只能引用当前 `plan({ sample })` 的输入。member 必须与该 Sample 中唯一 member identity
逐字相等；Aggregate 的完整 SampleRef 必须相等。其它 Sample、同 logical address 的不同 revision、
普通 structural object 或未在 denominator 中的 member 都是 `report-request-invalid / invalid-data-leaf`。

每个 Calculation 都有 canonical JSON `configuration`。`defineCalculation()` 产生 `{}`。
`rollup()` 写入两个 reducer、unavailable policy 与显示 metadata。`aggregate()` 写入 id、有序 group
descriptor、按名称关联的完整 measure descriptor 与 unavailable policy，所得对象必须恰为
`AggregateCalculationConfigurationV1`。

每个 measure descriptor 必须恰为
`AggregateMeasureConfigurationV1 { calculation: measure.identity, configuration:
measure.configuration }`。configuration 先按普通 ReportJsonObject 边界 canonical-copy/deep-freeze。

Aggregate 至少有一个 measure。identity、closure 或 runtime object reference 都不能替代完整 descriptor。

executor 把该对象写进 `CalculationExecutionIdentity`。这些构造参数不能只依赖内存中的 closure 或
module object identity。

```ts
const workspaceDiffRequest = projectorRequest({
  requestId: "workspace-diff",
  projector: workspaceDiff,
  input: { includeGenerated: false },
});

const changedLines = defineCalculation({
  namespace: "acme.checkout",
  name: "changed-lines",
  version: "1",
  requests: [workspaceDiffRequest],
  evaluate(input) {
    return mapEvidence(input.get(workspaceDiffRequest), (diff) =>
      countChangedLines(diff, input.member.attempt),
    );
  },
});
```

同一完整 Projection identity 可由 executor memoize 一次。两个不同 local requestId 即使指向同一个
Projector，也在各自 Calculation 中保留声明位置。同一 Calculation 内相同 requestId 的重复或
Projector/input 冲突会得到本页[导出报告](#导出报告)定义的 `report-request-invalid` failure。

## 分组函数与计算函数

```ts
type UnavailablePolicy = "exclude" | "propagate";

type GroupScalar = string | number | boolean;
type BuiltInGroupKey = "agent" | "experiment" | "eval" | "mode";

interface CustomGroupKey {
  readonly kind: "custom";
  readonly id: string;
  select(member: SampleMembership): GroupScalar;
}

type GroupKey = BuiltInGroupKey | CustomGroupKey;

function group(
  id: string,
  select: (member: SampleMembership) => GroupScalar,
): CustomGroupKey;

type GroupValues<Groups extends readonly GroupKey[]> = Readonly<
  Record<string, GroupScalar>
>;

interface MetricIncludedMember {
  readonly address: SampleMembershipAddressV1;
  readonly slot: SampleMembershipSlotV1;
  readonly membership: SampleMembership;
  readonly state: "included";
}

interface MetricExcludedMember {
  readonly address: SampleMembershipAddressV1;
  readonly slot: SampleMembershipSlotV1;
  readonly membership?: SampleMembership;
  readonly state: "excluded";
  readonly selectors: readonly [SampleSelector, ...SampleSelector[]];
}

interface MetricUnavailableMember {
  readonly address: SampleMembershipAddressV1;
  readonly slot: SampleMembershipSlotV1;
  readonly membership?: SampleMembership;
  readonly state: "unavailable";
  readonly causes: NonEmptyArray<UnavailableCause>;
  readonly basedOn: readonly EvidenceRef[];
}

type CoverageMember =
  | MetricIncludedMember
  | MetricExcludedMember
  | MetricUnavailableMember;

interface MetricCoverage {
  readonly total: readonly CoverageMember[];
  readonly included: readonly MetricIncludedMember[];
  readonly excluded: readonly MetricExcludedMember[];
  readonly unavailable: readonly MetricUnavailableMember[];
}

type MetricFormat = "number" | "integer" | "percent" | "currency" | "duration";

interface MeasureCell<T extends ReportJsonValue> {
  readonly attempt: AttemptRef;
  readonly result: EvidenceValue<T>;
}

type MetricValue =
  | {
      readonly state: "available";
      readonly value: number;
      readonly coverage: MetricCoverage;
      readonly basedOn: readonly EvidenceRef[];
      readonly refs: readonly AttemptRef[];
      readonly verification: Verification;
      readonly unit?: string;
      readonly format?: MetricFormat;
      readonly better?: "higher" | "lower";
    }
  | {
      readonly state: "unavailable";
      readonly causes: NonEmptyArray<UnavailableCause>;
      readonly coverage: MetricCoverage;
      readonly basedOn: readonly EvidenceRef[];
      readonly refs: readonly AttemptRef[];
      readonly unit?: string;
      readonly format?: MetricFormat;
      readonly better?: "higher" | "lower";
    };

type EvidenceRow = ReportJsonObject & {
  readonly refs: readonly AttemptRef[];
  readonly basedOn: readonly EvidenceRef[];
};

type AggregateRow<
  Groups extends readonly GroupKey[],
  Measures extends Record<string, Calculation<number>>,
> = EvidenceRow & {
  readonly group: GroupValues<Groups>;
  readonly metrics: {
    readonly [Name in keyof Measures]: MetricValue;
  };
};

type AggregateResult<
  Groups extends readonly GroupKey[],
  Measures extends Record<string, Calculation<number>>,
> = ReportJsonObject & {
  readonly rows: readonly AggregateRow<Groups, Measures>[];
  readonly coverage: MetricCoverage;
};

type AggregateData<
  Groups extends readonly GroupKey[],
  Measures extends Record<string, Calculation<number>>,
> = EvidenceValue<AggregateResult<Groups, Measures>>;

interface RollupOptions {
  readonly withinEval: Reducer;
  readonly acrossEvals: Reducer;
  readonly unavailable: UnavailablePolicy;
  readonly unit?: string;
  readonly format?: MetricFormat;
  readonly better?: "higher" | "lower";
}

interface Reducer {
  readonly kind: "mean" | "sum" | "min" | "max" | "percentile";
  readonly percentile?: number;
}

const mean: Reducer;
const sum: Reducer;
const min: Reducer;
const max: Reducer;
function percentile(value: number): Reducer;

function rollup(
  calculation: Calculation<number>,
  options: RollupOptions,
): Calculation<number>;

function aggregate<
  Groups extends readonly GroupKey[],
  Measures extends Record<string, Calculation<number>>,
>(
  sample: MaterializedSample,
  options: {
    readonly id: string;
    readonly by: Groups;
    readonly measures: Measures;
    readonly unavailable: UnavailablePolicy;
  },
): AggregateRequest<Groups, Measures>;

function mapEvidence<
  Input extends ReportJsonValue,
  Output extends ReportJsonValue,
>(
  value: EvidenceValue<Input>,
  map: (value: Input) => Output,
): EvidenceValue<Output>;

function metricValue(input: {
  readonly result: EvidenceValue<number>;
  readonly coverage: MetricCoverage;
  readonly refs: readonly AttemptRef[];
  readonly unit?: string;
  readonly format?: MetricFormat;
  readonly better?: "higher" | "lower";
}): MetricValue;

function evidenceRow<Fields extends ReportJsonObject>(
  fields: Fields & EvidenceRow,
): Readonly<Fields & EvidenceRow>;
```

`UnavailablePolicy` 必填。`exclude` 把 unavailable membership 留在 coverage 的 unavailable 列表而不纳入 numeric reducer。
`propagate` 在任一输入 unavailable 时产生 unavailable MetricValue。

`MetricCoverage.total` 与 included、excluded、unavailable 三组是同一有序集合的互斥完整划分。
excluded 保留完整 selectors 集合；unavailable 保留 address、slot、可取得的 membership、全部 causes 与
basedOn。两种 policy 都不丢这些理由。零 included 一定生成 unavailable。

`aggregate()` 是 plan 中的 `AggregateRequest<Groups, Measures>`。它按 Sample 的有序
sources 与 membership 工作，不选择单数 Graph。request 本身不是 rows；executor 放进
`ReportData` 后的值始终是 `AggregateData`，也就是
`EvidenceValue<AggregateResult<...>>`。`AggregateResult.rows` 保存已取得 group 值的行，顶层
`coverage` 保存整个 Sample 到这些行的分配结果。

内建 group 的取值与依赖固定如下：

| key | 值 owner | Projector dependency |
| --- | --- | --- |
| `eval` | `member.contribution.evalId` | 无；完整 Contribution 与 membership proof 已在 Sample identity 中 |
| `mode` | `member.contribution.mode` | 无；完整 Contribution 与 membership proof 已在 Sample identity 中 |
| `agent` | Record 中与该 Contribution / Attempt 绑定的 agent provenance | `{ namespace: "niceeval", name: "report-group-agent", version: "1" }` |
| `experiment` | Record 中认证的 Run / Contribution experiment evidence | `{ namespace: "niceeval", name: "report-group-experiment", version: "1" }` |

两个具名 group Projector 都接收 executor 从 membership 构造的规范化 input。该 input 包含完整
contribution node、runId、contributionId、revision 与 membershipSlot。Projector 重新通过
`ProjectionReadContext` 认证 Record evidence。它们不信任 Sample 上不存在的 agent / experiment
字段，也不从 id 字符串提取值。

`aggregate()` 把这些 request 静态加入自身 execution graph。每个 normalized instance 都以完整
`ReportProjectorRequestAddressV1` 进入 `ReportExportPlan.projectors`，其 input 进入 Record-owned
`ProjectionIdentityV1`。

Graph、adopted Attempt、Contribution revision 或 group Projector version 任一变化都不能复用 memo。

同一 ProjectionIdentity 被多个 measure、page 或 membership 消费时，Record projection memo 仍只以
ProjectionIdentity 命中一次。prepared plan 必须保留每个不同 consumer address。memo key 绝不纳入
measure name；plan consumer 也不能按 memo 去重。

有序 `by` descriptor（built-in key，或 custom group id）写入 aggregate 的 canonical
`configuration`，并随 `CalculationExecutionIdentity` 进入 plan digest。`eval` / `mode` 虽不增加
Projector request，也不能跨 Sample digest 或不同 group configuration 共享 Calculation 结果。

group Projector unavailable 时不生成 `"unknown"`、空字符串或猜测分组。该 membership 进入
`AggregateResult.coverage.unavailable`，保留 membership、全部 causes 与 basedOn，并且不进入任一
row。Sample 原有 excluded / unavailable 同样机械进入顶层 coverage。

只有全部 group key 可用的 membership 才进入 `coverage.included` 并分配到一行。行内每个
MetricValue 的 coverage 只描述该 group 内该 measure 的 reducer 输入。即使 rows 为空，顶层
coverage 仍完整解释分母，不能把 group evidence 缺失静默表示为空结果。

自定义 group 只读已经生成的 `SampleMembership`；例如
`group("mode", (member) => member.contribution.mode)`。它不能读 event、Store、网络或 renderer
context。

`MetricValue` 与 Record-owned `EvidenceValue` 使用相同的分支边界。available 分支的
`Verification` 取纳入 available evidence 的最差等级并合并全部 issues；unavailable 分支只保存
非空 causes、coverage、basedOn 与 refs，不包含也不合成 `verification`。

零 included 或输入 EvidenceValue unavailable 时，`metricValue()` 机械保留该 unavailable 的
causes / basedOn。`mapEvidence()` 与 `metricValue()` 都不能把 unavailable 压成 `null`、零或空数组。

`EvidenceRow` 是图表等组件的最小证据输入形状；其唯一 owner 就是本节。
`evidenceRow()` 的 `Fields` 必须是 `ReportJsonObject`；输入通过与其它 ReportData 相同的 canonical
JSON 校验、copy 与 deep-freeze。Date、Map、class instance、函数、`undefined` 或仅仅
`extends object` 的任意值不能借 `evidenceRow()` 穿过 artifact 边界。

`AggregateData` 不由作者 unwrap。`Table`、`Scatter` 与官方 aggregate 组合组件接收整个
EvidenceValue。available 时消费 `value.rows`，并显示 `value.coverage`。unavailable 时显示原始
causes 与 basedOn，不调用 renderer 私有转换函数把它换成 `null` 或 `[]`。

artifact 的 data snapshot 保存同一 discriminated JSON。去掉 Record private symbol 后，available
形态是 `{ state: "available", value: { rows, coverage }, basedOn, verification }`。unavailable 形态是
`{ state: "unavailable", causes, basedOn }`。不存在只保存未包装 rows 的第三种形态。

## `ReportData`、组件与参数化页

每个 page 的 `render()` 只运行一次，接收 executor 按 `ReportDataRequest` 映射出的 `ReportData`。text 和 web 共享同一 ReportNode；组件没有读取权限。

```tsx
export default defineReport({
  parameters: reportParameters("acme.security-report/1", {
    locale: { kind: "string", default: "zh-CN" },
  }),
  plan({ sample, parameters }) {
    const performance = aggregate(sample, {
      id: "performance",
      by: ["agent"],
      measures: { passRate, costUSD },
      unavailable: "exclude",
    });

    return {
      pages: [
        {
          id: "overview",
          title: "Overview",
          data: { performance, locale: constant(parameters.locale) },
          render({ performance, locale }) {
            return <Table rows={performance} locale={locale} />;
          },
        },
      ],
    };
  },
});
```

`Table`、图表、摘要格、Attempt 与 Experiment 详情、主题与自定义双面 renderer 继续使用各自的具名 props。它们只接收上述已求值 data。`ReportNode` 不读取 raw event schema，也不由 UI 字段反推 Record。

参数化页在 plan 中从 `sample.members` 枚举。每页都有稳定的 `id`、`instanceId`、route 与 data request；URL 只能选中已有 `ReportTarget`，不能制造新 Projector 或 Calculation。

## 导出报告

```ts
declare const reportDigestBrand: unique symbol;

type ReportDigest = string & {
  readonly [reportDigestBrand]: "sha256-lowercase-64";
};

function parseReportDigest(value: string): ReportDigest;

interface ReportPlanRef {
  readonly schema: "niceeval.report-plan-ref/1";
  readonly digest: ReportDigest;
}

interface ReportDefinitionIdentity {
  readonly schema: "niceeval.report-definition-identity/1";
  readonly entryModuleUrl: string;
  readonly moduleGraph: ReportDigest;
  readonly moduleEntries: readonly ReportModuleEntry[];
}

interface ReportModuleImport {
  readonly specifier: string;
  readonly moduleUrl: string;
}

interface ReportModuleEntry {
  readonly moduleUrl: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly digest: ReportDigest;
  readonly imports: readonly ReportModuleImport[];
}

interface ReportModuleGraphDigestPreimageV1 {
  readonly schema: "niceeval.report-module-graph-digest-preimage/1";
  readonly entryModuleUrl: string;
  readonly entries: readonly ReportModuleEntry[];
}

interface NiceEvalReportRuntimeModuleManifestV1 {
  readonly schema: "niceeval.report-runtime-module/1";
  readonly moduleId: string;
  readonly niceevalVersion: string;
}

interface CalculationExecutionIdentity {
  readonly address: ReportCalculationRequestAddressV1;
  readonly calculation: CalculationIdentity;
  readonly configuration: ReportJsonObject;
  readonly sample: SampleRef;
  readonly requests: readonly NormalizedProjectorRequest[];
}

interface ReportPlannedPage {
  readonly target: ReportTarget;
  readonly route: ReportRoute;
  readonly title: LocalizedText;
  readonly navigation: boolean;
  readonly dataKeys: readonly string[];
}

interface ReportPreparedPlan {
  readonly niceevalVersion: string;
  readonly definition: ReportDefinitionIdentity;
  readonly sample: SampleRef;
  readonly sources: SampleSources;
  readonly parameters: ReportJsonObject;
  readonly targets: readonly [ReportTarget, ...ReportTarget[]];
  readonly pages: readonly [ReportPlannedPage, ...ReportPlannedPage[]];
  readonly projectors: readonly NormalizedProjectorRequest[];
  readonly calculations: readonly CalculationExecutionIdentity[];
}

interface ReportPageEvidenceV1 {
  readonly target: ReportTarget;
  readonly evidence: readonly EvidenceRef[];
}

interface ReportExportPlanBodyV1 extends ReportPreparedPlan {
  readonly schema: "niceeval.report-export-plan/1";
  readonly pageEvidence: readonly [ReportPageEvidenceV1, ...ReportPageEvidenceV1[]];
  readonly evidence: readonly EvidenceRef[];
}

interface ReportPlanDigestPreimageV1 {
  readonly schema: "niceeval.report-plan-digest-preimage/1";
  readonly plan: ReportExportPlanBodyV1;
}

interface ReportExportPlan extends ReportExportPlanBodyV1 {
  readonly ref: ReportPlanRef;
}

type ReportArtifactStoreOperation =
  | "create"
  | "open"
  | "close"
  | "export"
  | "read";

type ReportArtifactStoreRootIssue =
  | "empty"
  | "not-absolute"
  | "malformed-url"
  | "file-url-host"
  | "query-or-fragment";

interface ReportJsonIssue {
  readonly path: readonly (string | number)[];
  readonly code:
    | "non-finite-number"
    | "unsafe-integer"
    | "undefined"
    | "non-plain-object"
    | "unsupported-value"
    | "cycle";
  readonly actualKind: string;
}

interface ReportParameterIssue {
  readonly code:
    | "unknown-field"
    | "missing-required-field"
    | "invalid-kind"
    | "not-in-enum"
    | "below-minimum"
    | "above-maximum"
    | "not-jcs-value";
  readonly path: readonly string[];
  readonly expected: string;
  readonly actual?: ReportJsonValue;
}

interface ReportParameterFailure {
  readonly code: "report-parameters-invalid";
  readonly schema: string;
  readonly issues: NonEmptyArray<ReportParameterIssue>;
}

interface ReportPlanFailure {
  readonly code: "report-plan-invalid";
  readonly issue:
    | "empty-pages"
    | "duplicate-page-instance"
    | "duplicate-route"
    | "invalid-route"
    | "invalid-page"
    | "forbidden-read"
    | "nondeterministic-order";
  readonly page?: ReportTarget;
}

interface ReportRequestDefinitionFailure {
  readonly code: "report-request-invalid";
  readonly issue:
    | "duplicate-request-id"
    | "request-id-conflict"
    | "undeclared-calculation-dependency"
    | "invalid-calculation"
    | "invalid-data-leaf";
  readonly requestId?: string;
  readonly page?: ReportTarget;
  readonly calculation?: CalculationIdentity;
}

interface ReportDefinitionFailure {
  readonly code: "report-definition-invalid";
  readonly issue:
    | "missing-plan"
    | "invalid-parameter-schema"
    | "invalid-module-entry"
    | "missing-default-export"
    | "invalid-default-export"
    | "invalid-frozen-definition";
  readonly field?: string;
}

type ReportAuthoringFailure =
  | ReportParameterFailure
  | ReportPlanFailure
  | ReportRequestDefinitionFailure
  | ReportDefinitionFailure;

interface ReportSampleFailure {
  readonly code: "report-sample-invalid";
  readonly cause: SampleValidationError;
}

type ReportProjectionFailure =
  | {
      readonly code: "report-projection-failed";
      readonly phase: "input";
      readonly request: ReportProjectorFailureRequest;
      readonly cause: ProjectorInputError;
    }
  | {
      readonly code: "report-projection-failed";
      readonly phase: "registration";
      readonly request: ReportProjectorFailureRequest;
      readonly cause: ProjectorRegistrationError;
    }
  | {
      readonly code: "report-projection-failed";
      readonly phase: "record-read";
      readonly request: ReportProjectorFailureRequest;
      readonly membership: SampleMembershipAddressV1;
      readonly cause: RecordReadError;
    }
  | {
      readonly code: "report-projection-failed";
      readonly phase: "read";
      readonly request: ReportProjectorFailureRequest;
      readonly membership: SampleMembershipAddressV1;
      readonly cause: ProjectorReadError;
    }
  | {
      readonly code: "report-projection-failed";
      readonly phase: "execution";
      readonly request: ReportProjectorFailureRequest;
      readonly membership: SampleMembershipAddressV1;
      readonly cause: ProjectorExecutionError;
    };

type ReportCalculationFailureCause =
  | {
      readonly code: "calculation-threw";
      readonly message: string;
    }
  | {
      readonly code: "calculation-output-invalid";
      readonly issues: NonEmptyArray<ReportJsonIssue>;
    };

type ReportExportExecutionFailure =
  | ReportSampleFailure
  | ReportProjectionFailure
  | {
      readonly code: "report-evidence-closure-failed";
      readonly phase: "source";
      readonly source: RecordGraphRef;
      readonly cause: RecordSourceFailure;
    }
  | {
      readonly code: "report-target-invalid";
      readonly issue: "empty-targets";
    }
  | {
      readonly code: "report-target-invalid";
      readonly target: ReportTarget;
      readonly issue: "not-planned" | "duplicate-target";
    }
  | {
      readonly code: "report-module-graph-invalid";
      readonly issue:
        | "unresolvable-module"
        | "non-canonical-module"
        | "dynamic-import"
        | "module-digest"
        | "module-graph-digest"
        | "asset-path"
        | "asset-read"
        | "asset-conflict";
      readonly specifier?: string;
      readonly moduleUrl?: string;
      readonly assetPath?: string;
    }
  | {
      readonly code: "report-calculation-failed";
      readonly address: ReportCalculationRequestAddressV1;
      readonly calculation: CalculationIdentity;
      readonly membership: SampleMembershipAddressV1;
      readonly cause: ReportCalculationFailureCause;
    }
  | {
      readonly code: "report-render-failed";
      readonly page: ReportTarget;
      readonly message: string;
    }
  | {
      readonly code: "report-evidence-closure-failed";
      readonly phase: "proof";
      readonly cause: RecordEvidenceProofFailure;
    };

type ReportArtifactStoreFailure =
  | {
      readonly code: "report-artifact-store-invalid-root";
      readonly operation: "create" | "open";
      readonly root: string | URL;
      readonly issue: ReportArtifactStoreRootIssue;
    }
  | {
      readonly code: "report-artifact-store-url-scheme-unsupported";
      readonly operation: "create" | "open";
      readonly root: URL;
      readonly scheme: string;
    }
  | {
      readonly code: "report-artifact-store-already-exists";
      readonly operation: "create";
      readonly root: string;
    }
  | {
      readonly code: "report-artifact-store-missing";
      readonly operation: "open";
      readonly root: string;
    }
  | {
      readonly code: "report-artifact-store-invalid-format";
      readonly operation: "open";
      readonly root: string;
      readonly declared?: string;
    }
  | {
      readonly code: "report-artifact-store-closed";
      readonly operation: "export" | "read";
    }
  | {
      readonly code: "report-artifact-store-invalid-handle";
      readonly operation: "export" | "read";
    }
  | {
      readonly code: "report-artifact-missing";
      readonly operation: "read";
      readonly ref: ReportArtifactRef;
    }
  | {
      readonly code: "report-artifact-invalid-ref";
      readonly operation: "read";
      readonly value: string;
    }
  | {
      readonly code: "report-artifact-corrupt";
      readonly operation: "open" | "export" | "read";
      readonly ref?: ReportArtifactRef;
      readonly issue:
        | "store-index"
        | "artifact-payload"
        | "digest-mismatch"
        | "ref-collision"
        | "plan-digest"
        | "plan-ref-collision"
        | "asset-digest"
        | "evidence-proof";
    }
  | {
      readonly code: "permission-denied";
      readonly operation: ReportArtifactStoreOperation;
    }
  | {
      readonly code: "store-unavailable" | "store-io-failure";
      readonly operation: ReportArtifactStoreOperation;
      readonly retryable: boolean;
      readonly message: string;
    };

type ReportArtifactFailure =
  | ReportAuthoringFailure
  | ReportExportExecutionFailure
  | ReportArtifactStoreFailure;

class ReportArtifactError extends Error {
  readonly failure: ReportArtifactFailure;
  constructor(failure: ReportArtifactFailure);
}

declare const reportArtifactStoreBrand: unique symbol;

interface ReportArtifactStore extends AsyncDisposable {
  readonly [reportArtifactStoreBrand]: "niceeval.report-artifact-store/1";
  readonly format: "niceeval.report-artifact-store/1";
  close(): Promise<void>;
}

interface ReportArtifactRef {
  readonly schema: "niceeval.report-artifact-ref/1";
  readonly digest: ReportDigest;
}

interface ReportArtifactPageV1 {
  readonly schema: "niceeval.report-artifact-page/1";
  readonly target: ReportTarget;
  readonly data: ReportJsonObject;
  readonly text: string;
  readonly html: string;
}

interface ReportArtifactAssetV1 {
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly digest: ReportDigest;
}

interface ReportArtifactPayloadV1 {
  readonly schema: "niceeval.report-artifact/1";
  readonly plan: ReportExportPlan;
  readonly pages: readonly [ReportArtifactPageV1, ...ReportArtifactPageV1[]];
  readonly evidenceProofs: RecordEvidenceProofIndexRefV1;
  readonly assets: readonly ReportArtifactAssetV1[];
}

interface ReportArtifactDigestPreimageV1 {
  readonly schema: "niceeval.report-artifact-digest-preimage/1";
  readonly artifact: ReportArtifactPayloadV1;
}

interface ReportArtifact extends ReportArtifactPayloadV1 {
  readonly ref: ReportArtifactRef;
}

interface ReportExportTarget {
  readonly store: ReportArtifactStore;
  readonly pages: "all" | readonly [ReportTarget, ...ReportTarget[]];
}

function createReportArtifactStore(
  root: string | URL,
): Promise<ReportArtifactStore>;

function openReportArtifactStore(
  root: string | URL,
): Promise<ReportArtifactStore>;

function exportReport<Parameters extends ReportJsonObject>(
  definition: FrozenReportDefinition<Parameters>,
  input: {
    readonly sample: MaterializedSample;
    readonly sources: RecordSourceSet;
    readonly parameters: Parameters;
    readonly target: ReportExportTarget;
  },
): Promise<ReportArtifactRef>;

function openReportArtifact(
  source: ReportArtifactStore,
  ref: ReportArtifactRef,
): Promise<ReportArtifact>;
```

`ReportArtifactFailure` 是这一节失败的穷尽 union。下列异步入口与 Store close 失败时只 reject
`ReportArtifactError`，调用方通过 `error.failure.code` 判别。

`reportParameters()`、`defineReport()`、`projectorRequest()`、`defineCalculation()` 与
`calculationRequest()` 在声明本身无效时 throw 同一个 error class。它们只会给出
`ReportAuthoringFailure`。

作者错误不能包装成普通 `Error`，也不能在 export 时改写成 Store、unavailable 或空 artifact。

| 入口 | 会 reject 的 `ReportArtifactError.failure` |
| --- | --- |
| `createReportArtifactStore()` | 操作为 `create` 的 `report-artifact-store-invalid-root`、`report-artifact-store-url-scheme-unsupported`、`report-artifact-store-already-exists`、`permission-denied`、`store-unavailable` 或 `store-io-failure` |
| `openReportArtifactStore()` | 操作为 `open` 的 `report-artifact-store-invalid-root`、`report-artifact-store-url-scheme-unsupported`、`report-artifact-store-missing`、`report-artifact-store-invalid-format`、`report-artifact-corrupt`、`permission-denied`、`store-unavailable` 或 `store-io-failure` |
| `loadReportDefinition()` | `report-definition-invalid` 或 `report-module-graph-invalid`；默认导出、module URL、specifier、digest 与完整 graph closure 保留各自 issue |
| `ReportArtifactStore.close()` / async dispose | 操作为 `close` 的 `permission-denied`、`store-unavailable` 或 `store-io-failure`；重复调用复用首次 settled result，不产生 closed failure |
| `exportReport()` | 所有 `ReportAuthoringFailure`、所有 `ReportExportExecutionFailure`（Sample validator 包装为 `report-sample-invalid`；Record source 或 proof owner failure 包装为 `report-evidence-closure-failed`），以及操作为 `export` 的 `report-artifact-store-invalid-handle`、`report-artifact-store-closed`、`report-artifact-corrupt`、`permission-denied`、`store-unavailable` 或 `store-io-failure` |
| `openReportArtifact()` | 操作为 `read` 的 `report-artifact-store-invalid-handle`、`report-artifact-store-closed`、`report-artifact-invalid-ref`、`report-artifact-missing`、`report-artifact-corrupt`、`permission-denied`、`store-unavailable` 或 `store-io-failure` |

作者阶段的 failure 是：

- `report-parameters-invalid`：未知字段、缺失必填字段、类型、enum、上下界或 JCS 失败；逐项保留 `ReportParameterIssue`。
- `report-plan-invalid`：空页面、重复 page instance 或 route、非法页面、禁止读取或非确定顺序。
- `report-request-invalid`：同一声明作用域内重复 id、同 address 的 Projector/input 冲突、遗漏
  Calculation dependency、非法 Calculation 或 data leaf。

每个 page 的 Calculation/Aggregate root requestId 只在该 page 内唯一；每个 Projector requestId 只在
声明它的 Calculation 内唯一。这两类检查都发生在 membership 展开前。相同 local id 指向不同定义时，
executor reject `report-request-invalid / request-id-conflict`；完全重复则是 `duplicate-request-id`。
不同 page、不同 Calculation 或不同 membership 不共享 local-id 冲突域。

`defineAttemptProjector()` 自身的定义错误仍由 Record 的 `ProjectorDefinitionError` 直接拒绝；
Report 不接管这个 owner。这样 definition family 在 Projector 构造点保持独立。

executor 规范化 request input 时若 Record normalizer 拒绝输入，失败是 `report-projection-failed`。
其 `cause` 是完整 `ProjectorInputError`，原样保留 Projector id、
schema 与稳定排序、非空的 `issues { code, path, expected? }`。

它不能降成
`report-request-invalid`、message 或 `unknown`。此时尚无 normalized parameters，因此 wrapper 的
`phase` 是 `input`；`request` 保存完整 request address 与 Projector id。该分支不伪造
`NormalizedProjectorRequest` 或 membership。

进入执行 session 后的 duplicate Projector id、Record capability read、backend read 与 author
execution 失败同样是 `report-projection-failed`。它们的 `phase` 分别是 `registration`、
`record-read`、`read` 与 `execution`。后三者保存实际 membership address。

`record-read` 的 cause 是完整 `RecordReadError` object。它的 `failure.operation`、code、retryable 与
原始 `failure.cause` 原样保留。这包括 capability 被撤销、operation denied 与 auth session expired。
`read` 的 cause 才是 `ProjectorReadError`，只允许 Record owner 定义的 backend unavailable / IO 两种
code，并保留 retryable 与底层 cause。二者不能互相映射，认证失败也不能伪装成瞬时 backend 故障。

definition、input、registration、record-read、read 与 execution 六个 family 因而仍按原 owner 阶段
互斥；Report wrapper 只统一 artifact failure surface，不重新分类它们。

已经认证的 evidence ACL 拒绝仍是普通 unavailable
`EvidenceValue / permission-denied`，不进入这个基础设施错误通道。

`exportReport()` 的第一项 caller-input phase 是
`validateMaterializedSample(input.sample)`。它发生在读取 target Store / `input.sources`、检查 frozen
definition capability、读取任一 Sample 字段、运行 plan 或构造 aggregate 之前。失败只形成
`ReportSampleFailure { code: "report-sample-invalid", cause }`。`cause` 是 Sample owner 抛出的完整
`SampleValidationError` object。其 `failure.code` 与稳定非空 `failure.issues` 不改写。

Reports 不重跑字段级 validator，也不从 issue 选择主因。普通对象、伪造 brand、invalid brand、
非 canonical structure / order、membership / coverage / provenance invariant 破坏与 digest mismatch
都走这一分支。它们不能被当成空 Sample、零 coverage、unavailable evidence、target Store failure 或
Record source failure。validator 成功返回原 canonical frozen value 后，后续 phase 才能读取它。

`exportReport()` 校验 `FrozenReportDefinition` 与参数。它运行一次 plan、规范化 request、执行
Calculation、每页只调用一次 render，并在内存中把结果树分别消费成最终 text 与 HTML。target
Store 只接收自动生成的 `ReportExportPlan`、纯 JSON page payload、proof index 与资产 bytes。

每次调用创建一个隔离的、跨 `input.sources` reader 的 Projection session。registry 与 memo 在
调用结束时释放，不污染并发或后续的 Report export；dependency cycle 已由 Projector definition
的 branded object graph preflight 拒绝。

SourceSet 可以含额外 reader，但 executor 只读取 `sample.sources` 中完整匹配的 GraphRef。
source 缺失、closed、invalid handle 或读取失败，以及后续 proof closure 失败，都进入
`report-evidence-closure-failed`。`phase: "source"` 的 `cause` 完整保存 `RecordSourceFailure`；
`phase: "proof"` 的 `cause` 完整保存 `RecordEvidenceProofFailure`。Report 不把两类 owner failure
压成 message、`unknown` 或自己的第二套 proof code。

SourceSet runtime brand、lifecycle 与 source membership 只由 Record owner 判定。
伪造值或其它 capability kind 产生 operation 为 `read-source`、code 为
`record-source-invalid-handle` 的 `RecordSourceFailure`。
真实 closed SourceSet 产生 `record-source-closed`。
缺少 Sample 要求的完整 GraphRef 产生 `record-source-missing`。
Reports 对三者都只加 `phase: "source"` 与正在请求的 source Graph，不另造 Record code。

冻结模块失败、未计划 target、Projector、Calculation、render 或 evidence closure 故障分别
使用 `ReportExportExecutionFailure` 的对应 code。作者不能传入或手写 ExportPlan。

`loadReportDefinition()` 先把 entry 规范化为 canonical module URL，再使用同一 loader registry 加载
全部静态 import。`file:` URL 对实际文件做 realpath、移除 dot segment，并拒绝 host、query 与
fragment；其它 scheme 必须由具名 loader 注册，且 parse 后重新 serialize 必须逐字相等。网络 scheme
不进入 registry。

`ReportModuleImport.specifier` 是 ECMAScript parser 得到的字符串值，不做 Unicode 或大小写改写。
转义写法和原始拼写已经由 source bytes 绑定；同一值必须由 module URL lookup 得到唯一 canonical
`moduleUrl`。imports 先按 specifier、再按 moduleUrl 的 UTF-8 bytes 升序，完全相同的 pair 不得重复。
不同 specifier 指向同一 moduleUrl 合法，并保留为两条 edge。

每个 import target 在 `moduleEntries` 中恰有一个 entry，且所有 entry 都必须从 entryModuleUrl 可达；
缺 target、重复 URL 与不可达额外 entry 都无效。entries 按 moduleUrl 的 UTF-8 bytes 升序。
`mediaType` 来自具名 loader 的版本化 registry entry；`byteLength` 与 `digest` 对 loader 在任何转换前
返回的 exact immutable bytes 计算。相同 URL 在一次 snapshot 中返回不同 bytes 是 collision。

NiceEval runtime 也遵守同一形状。它使用 canonical `niceeval:` URL，raw bytes 是
`NiceEvalReportRuntimeModuleManifestV1` 的 RFC 8785 JCS 无 BOM UTF-8 编码。
media type 固定为
`application/vnd.niceeval.report-runtime-module+json;v=1`。

增加其它 virtual runtime 时只注册新的 scheme、media type 与 immutable bytes，不改变 module graph
schema。

`ReportDefinitionIdentity.moduleGraph` 的唯一 preimage 是
`ReportModuleGraphDigestPreimageV1 { schema, entryModuleUrl, entries }`。loader 对规范化结构执行 RFC
8785 JCS、无 BOM UTF-8 与 SHA-256，再写成 `sha256:` 加 64 个小写十六进制字符。

identity 的 entryModuleUrl 与 moduleEntries 必须逐项等于 preimage。artifact decoder 必须重算
moduleGraph，不能相信持久值自报的 digest。Frozen capability 还持有经过验证的 executable module
objects；函数、loader object、cwd、cache 与转换输出不进入 preimage。

`ReportDigest` 的合法字节形态是 `sha256:` 加 64 个小写十六进制字符。`parseReportDigest()`
与 artifact decoder 拒绝其它算法、长度、大写字符和非十六进制字符；branded string 不能
替代运行时校验。无效的外来 artifact ref 返回 `report-artifact-invalid-ref`；语法正确但不存在的
artifact ref 返回 `report-artifact-missing`。

作者 `ReportPlan` 通过页面、route、request 与 target 校验后，executor 形成 immutable
`ReportPreparedPlan`。它没有 schema、ref、pageEvidence 或 evidence，也不进入 Artifact Store。

`target.pages: "all"` 按作者 plan 的页面顺序展开全部 target；显式非空 tuple 保留调用方给出的顺序。
重复或未计划 target 直接失败。JavaScript、反序列化或伪造 TypeScript 值仍可能传入空数组；executor
在读取 source、规范化 request 或运行 renderer 前以 `report-target-invalid / empty-targets` 拒绝。

executor 只执行 `targets` 中的页面。`ReportPreparedPlan.pages` 必须恰好是这些 selected page，和
`targets` 等长同序且 target 逐项相等。未选页面不进入 prepared/finalized plan，也不运行 request、
Calculation 或 renderer。

selected request graph 从这些 page 的 `data` 叶开始：

- `CalculationRequest` 只展开其显式 member、Calculation identity 与该 Calculation 声明的每个
  `ProjectorRequest`；
- `AggregateRequest` 按所带 Sample 的完整有序 membership 展开全部 measure Calculation dependency
  与具名 group Projector；
- constant 没有后继。

Projector definition 内允许的 nested `ctx.project()` object dependency 属于冻结 module graph 与
Record execution trace。它不伪装成另一个带 report requestId 的 `NormalizedProjectorRequest`。

每个非 constant page data leaf 先形成唯一 `ReportCalculationRequestAddressV1`。address 固定 page
target、dataKey、page-local requestId 与 scope。member Calculation 的 scope 保存该 membership address；
Aggregate 的 scope 保存完整 SampleRef。相同 address 不得出现两次。

每次 Projector dependency 对每个实际 member 的展开都形成一个
`ReportProjectorRequestAddressV1`。它保存 owner calculation address 与 membership address。
calculation dependency 另存 Calculation identity、invocation 与 local requestId；aggregate group 另存
index/id。

相同 Projector 在两个 page、measure 或 membership 被消费时保留两个不同 address。executor 可以按
相同 `ProjectionIdentityV1` 共享 memo，但不能从 plan 删除任一 consumer。

`ReportPreparedPlan.projectors` 必须恰好包含上述每个 address 的一个
`NormalizedProjectorRequest`。address 与 projection 共同进入完整项；相同 address 的重复项或不同
projection 都是 invalid plan。

`calculations` 必须恰好为每个非 constant root address 保存一个 `CalculationExecutionIdentity`。
member request 使用作者 Calculation identity。Aggregate 使用
`{ schema: "niceeval.calculation/1", namespace: "niceeval", name: "aggregate", version: "1" }`。

它的 configuration 保存 group、每个具名 measure 的完整 `{ calculation, configuration }` 与 unavailable
policy；measure map 按名称 JCS bytes 排序。每项 `requests` 恰好是 calculation address 相等的
projector entries，其中每个 measure dependency origin 必须携带对应 measure name。

projectors 与 calculations 分别按完整项的 JCS UTF-8 bytes 升序，不按执行调度顺序排列，也不按相同
Projection memo 或 Calculation definition 去重。它们不能包含未选页面、未执行分支或“可能有用”的
identity。

每个所选 target 在执行后形成唯一 `ReportPageEvidenceV1`。它收集该页每个 Projector 与 Calculation
实际 tracked read 的 direct `EvidenceRef`。集合包括 available basedOn、unavailable basedOn、每个
UnavailableCause 上存在的 evidence、grouping evidence 与 renderer 收到的全部 ReportData dependency。

constant 不产生 evidence，renderer 也不能新增。每页集合按完整 EvidenceRef 的 JCS UTF-8 bytes 升序
并去重。

finalized `ReportExportPlan.pageEvidence` 与 `targets` 等长、同序且 target 逐项相等。
顶层 `evidence` 必须恰好是全部 pageEvidence 集合的 union，按同一 JCS bytes 规则升序且唯一；不能
遗漏实际消费项，也不能加入未选页面、未执行分支或“可能有用”的额外项。executor 完成这两层 trace
后才构造 `ReportExportPlanBodyV1` 与 ref。

`ReportArtifact.evidenceProofs` 必须恰好索引 `plan.evidence` 的 Record proof closure。closure 先含
每个 direct EvidenceRef；遇到 Claim proof 时，按 source-local basedOn 递归加入全部 EvidenceRef，
直到 event、object、absence 或无新增 Claim 为止。同一 EvidenceRef 只保留一次，cycle 由 Record owner
拒绝。proof index 不得缺项或带 closure 外 entry；它的 proofCount 必须等于该 closure 的 cardinality。

`ReportPlanRef` 的唯一 digest preimage 是
`ReportPlanDigestPreimageV1 { schema, plan }`。`plan` 是显式构造的
`ReportExportPlanBodyV1`；`ReportExportPlan.ref`、函数、对象原型、runtime brand、memo、Store root
与 target Store identity 都明确排除。物理写到哪里不改变计划身份。

plan 的 canonical order 固定如下：

- `sources` 使用 Sample owner 的 GraphRef JCS 顺序；
- `targets` 保留显式选择顺序；`pages` 与 targets 等长同序，只保存逐项匹配的 selected page；
- `pageEvidence` 与 targets 同序，每项 evidence 按 EvidenceRef JCS bytes 升序；
- 每页 `dataKeys` 按 UTF-8 bytes 升序；
- `moduleEntries` 与 imports 使用 module graph 规则；`projectors`、`calculations` 与顶层 `evidence`
  分别按各项 JCS bytes 升序；
- 每个 Calculation 的 `requests` 按各项 JCS bytes 升序；
- `parameters` 与其余对象 key 由 JCS 排序。

重复或未规范化输入在形成 ref 前失败。

实现对完整 `ReportPlanDigestPreimageV1` 执行 RFC 8785 JCS，以无 BOM UTF-8 编码得到唯一 bytes，
再计算 SHA-256。`ReportPlanRef.digest` 是 `sha256:` 与 32-byte digest 的 64 位小写十六进制表示
拼接而成。plan 持久化时保存的 canonical bytes 必须逐字节等于这份 preimage；decoder 重建 body
并重新计算 ref，不能相信 payload 自报的 digest。

Artifact Store 以 `ReportPlanRef` 对 plan preimage bytes 做内容寻址。相同 ref 与完全相同 bytes
可以复用；相同 ref 与不同 canonical bytes 是
`report-artifact-corrupt / plan-ref-collision`。这包括两个不同 plan byte sequence 都通过同一
SHA-256 的情形；实现不得替换已经保存的 plan。

`ReportArtifactRef` 的唯一 digest preimage 是
`ReportArtifactDigestPreimageV1 { schema, artifact }`。artifact 是
`ReportArtifactPayloadV1`。顶层 `ReportArtifact.ref`、执行期 `ReportNode` 与 ReportDefinition
明确排除。renderer 函数、module object、runtime brand、Store index 与物理路径也不进入 preimage。
payload 内的 `plan.ref`、`evidenceProofs` 与 asset digest 是内容寻址 ref，因而传递绑定各自指向的
bytes。

artifact payload bytes 必须恰好是这份 preimage 的 RFC 8785 JCS 无 BOM UTF-8 bytes；
`ReportArtifactRef.digest` 对这些 bytes 使用同一 SHA-256 与字符串编码。pages 按
`plan.targets` 顺序，assets 按 path 的 UTF-8 bytes 升序；重复 target、重复 asset path、非 canonical
data 或不安全整数在计算 digest 前失败。asset digest 单独对原始 asset bytes 计算 SHA-256，
`byteLength` 是这些原始 bytes 的长度。

`ReportArtifactAssetV1.path` 必须匹配
`^assets/[0-9a-f]{64}\.(?:css|js|mjs)$`，且 digest 中去掉 `sha256:` 的部分必须与 path 中的 hex
逐字相同。decoder 在任何 path join 或文件访问前检查这项规则；absolute path、backslash、重复
separator、`.` / `..`、NUL、query 与 fragment 都不能进入 Store。layout 只用已验证的 canonical
path，因而没有另一套 path normalization 或文件替换规则。

`ReportArtifactStore` 是 runtime-branded、`AsyncDisposable` 的独立 capability。它没有 Record
Graph、writer 或 current-member API。只有 `createReportArtifactStore()` 与
`openReportArtifactStore()` 能构造合法 capability；公开 `format` 字段不让 structural object
或其它 Store kind 通过运行时品牌检查。

两个 bundled local factory 都在触碰文件系统或 backend 前先验证并规范化 root。string root 必须是
非空的绝对本地 path。`URL` root 必须是没有 host、query 或 fragment 的 `file:` URL；合法 URL 先
转换成规范化的绝对本地 path。此后所有拥有 `root: string` 的 create/open failure 都报告这个
normalized root，而 root validation failure 保留 caller 传入的 `string | URL`。

空值、相对 path、畸形 URL、带 host 的 file URL 与 query/fragment 分别落入封闭的
`ReportArtifactStoreRootIssue`。其它 URL scheme 只会是
`report-artifact-store-url-scheme-unsupported`，其中 `root` 保留 URL、`scheme` 保存实际 scheme。

两类 root failure 都带实际 `create` 或 `open` operation；它们绝不降格为 missing、permission、
unavailable 或 IO。bundled local factory 不接受任意远端 URL；远端 backend 必须由自己的 integration
产生 runtime-branded `ReportArtifactStore` capability。

`createReportArtifactStore()` 只接受不存在的 root。root 已有任意文件系统项，包括另一个有效
Store，都是 operation 为 `create`、root 为规范化绝对 path 的
`report-artifact-store-already-exists`。create 不领养、清空或补全已有目录。

`openReportArtifactStore()` 只接受存在、声明正确 Store format 且 layout 可校验的 root。根不存在
是 operation 为 `open` 的 `report-artifact-store-missing`。普通目录、普通 file、无 marker 或声明错误
format 是 `report-artifact-store-invalid-format`，并在可取得时保留 `declared`。声明正确但 index、
digest 或 payload 不一致是 operation 为 `open` 的 `report-artifact-corrupt`。这些 failure 中的 root
都是规范化绝对 path；open 不会初始化、修复或把普通目录转换成 Store。

`exportReport()` 与 `openReportArtifact()` 只接受 create 或 open 成功返回、且尚未 close 的 Store
capability。伪造或来自其它 Store kind 的值是 `report-artifact-store-invalid-handle`。

`report-artifact-store-invalid-handle` 与 `report-artifact-store-closed` 互斥。入口先检查 runtime
brand，再检查 lifecycle：伪造值或其它 Store kind 即使自报 closed 也只能是 invalid handle；
只有 create/open 返回后进入 closed lifecycle 的真实 capability 才是 closed。

`close()` 只释放这个 wrapper 的 local retain。它对 lifecycle 幂等，并复用首次 settled result；
重复调用不会再次释放。close 不读取、写入、删除或改变已保存的 artifact。
close 开始后不再创建新的 export/read child retain；已经通过入口校验并取得
retain 的 operation 可以独立完成，最后一个 retain 释放后才关闭 backend。已经返回的
`ReportArtifact` 是完整 immutable value，不依赖 Store 继续存活。

一个 Store 可保存多个 immutable artifact。`exportReport()` 可以写入已打开的非空 Store。

相同 `ReportArtifactRef` 对应完全相同的 canonical artifact payload bytes 时，export 幂等成功。
同一 ref 对应不同 bytes，包括两个不同 byte sequence 都通过同一 SHA-256 的情形，是
`report-artifact-corrupt / ref-collision`。实现不得覆写、任选一份或用对象深比较替代 byte 比较。

`ReportArtifactRef` 只由成功 export 返回。`openReportArtifact()` 只读取 Store 内已经写好的
artifact，不装载报告模块，也不重新执行 plan、Sample selection、Projector、Calculation、renderer
或 Record 读取。

`ReportArtifactPageV1` 是纯 JSON 交付 IR。`data` 是 execution-time `ReportData` 去除 private symbol
brand 后的 canonical JSON snapshot，只用于审计与无权限增强脚本；它不是新的 branded
`ReportData`，不能重新传回 Calculation 或 renderer。`text` 与 `html` 是 export 时已经生成的最终
输出。`ReportNode` 只存在于同一次 export 的内存执行阶段，不在 artifact layout 或公开打开结果中。

Store 持久化 canonical artifact payload、plan bytes、asset 原始 bytes 与 proof archive。
`openReportArtifactStore()` 先校验 layout 与 index。`openReportArtifact()` 再逐项校验：

- artifact JCS bytes 与 artifact ref；
- plan preimage 与 plan ref；
- asset byteLength 与 raw-byte digest；
- proof index 与传递内容哈希。

payload hash 不符是 `digest-mismatch`，plan 不符是 `plan-digest`。
asset 不符是 `asset-digest`，proof 不符是 `evidence-proof`。
全部校验只依赖 Artifact Store 自身。
完成后返回 canonical-copy、deep-freeze 的 `ReportArtifact`。

artifact 与 SampleBundle、源 Record 各用独立 Store。跨 Store 的 event、object、Claim 与
authenticated absence 依据都以 Record-owned `RecordEvidenceProofV1` 写成 inert archive。
`ReportArtifact.evidenceProofs` 的分页 index 引用这些 proof。

源 Claim、stream GraphNode 或其它源对象不能作为目标活动节点。Claim 的 basedOn 必须递归
闭合并去重。

源中已有的依据无法读取、校验、闭合或复制时，export 以带 typed cause 的
`report-evidence-closure-failed` reject，不能伪装成 `not-recorded`。source 阶段保存完整
`RecordSourceFailure`，proof 阶段保存完整 `RecordEvidenceProofFailure`；两者都包在
`ReportArtifactError` 中而不直接传播 Record error class。

## 相关阅读

- [Architecture](architecture.md) —— plan、executor、memo 与 evidence closure。
- [Calculations](calculations.md) —— 公共计算边界。
- [组件目录](components/README.md) —— 双面显示形状。
- [完整示例](library/examples.md) —— request、常量与 page 装配。
