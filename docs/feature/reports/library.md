# Reports Library

本页是 Reports 公开类型的唯一 owner。Record 拥有文件与 `ChannelRead`，Sample 拥有 core-only `AnalysisSample` 和分母。只有本页的 composition adapter 同时接收 `RecordReader`、`AnalysisSample` 与 `ReportPlan`；Report 定义、计算、页面、本机 runtime 和静态 runtime 都不能接收 reader 或路径。

## 唯一调用顺序

```ts
const input = yield* Effect.scoped(
  Effect.gen(function* () {
    const reader = yield* openRecordReader({ root });
    const sample = yield* projectExplicitRuns(reader, { runIds });
    const plan = definition.plan(createReportScope(sample));
    return yield* buildReportInput({ reader, sample, plan });
  }),
);

// reader Scope 已关闭；以下操作不再访问 Record。
const execution = executeReport({ definition, input });
await viewReport({ execution });
await exportStaticReport({ execution, out });
```

analysis projector 不读取业务通道。`plan()` 不读取 facts。`buildReportInput()` 只读取 plan 已声明的 facts。三步共用同一个 lock-free reader 与 frozen selection；`executeReport()` 只消费内存输入并执行一次用户 parser、计算和 render，view 与 export 只消费同一份自包含 `ReportExecution`。

## ReportScope 与 ReportInput

```ts
interface ReportScope {
  readonly provenance: AnalysisProjectionProvenance;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
}

function createReportScope(sample: AnalysisSample): ReportScope;

declare const reportFactsBrand: unique symbol;

interface ReportFactMatrix {
  readonly kind: "internal-report-fact-matrix";
}

interface ReportInput {
  readonly scope: ReportScope;
  readonly sample: AnalysisSample;
  readonly [reportFactsBrand]: ReportFactMatrix;
}

declare const reportSampleBrand: unique symbol;

interface ReportSample {
  readonly [reportSampleBrand]: true;
  readonly provenance: AnalysisProjectionProvenance;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
  readonly included: readonly IncludedAnalysisSlot[];
  readonly notRecorded: readonly NotRecordedAnalysisSlot[];
  readonly invalid: readonly InvalidAnalysisSlot[];
  readonly excluded: readonly ExcludedAnalysisSlot[];
}

interface ReportContext {
  readonly scope: ReportScope;
  readonly sample: ReportSample;
}
```

`scope.runs` 穷尽已选 Run，`scope.slots` 保留 core-only `AnalysisSample` 的完整状态与顺序，因此 plan 可以穷尽 Run、slot 和 Attempt detail route，但看不到业务值。fact matrix 由未导出的 symbol 隔离，Report 作者无法直接索引它。

consumer 只收到 `ReportContext` 和宿主提供的受控读取方法。宿主逐字段建立带 private brand 的精确 `ReportSample`，不把原 `AnalysisSample` 对象传入回调。这个 projection 不含 Record root；Calculation、Page 与 Download 的公开字段都无法取得 reader、Record root 或其它磁盘路径。

## ReportDefinition 与 ReportPlan

```ts
interface ReportDefinition {
  readonly id: string;
  plan(scope: ReportScope): ReportPlan;
}

interface ReportPlan {
  readonly calculations: readonly Calculation<unknown>[];
  readonly pages: readonly ReportPage[];
  readonly downloads: readonly ReportDownload[];
}

function defineReport(definition: ReportDefinition): ReportDefinition;
```

`plan()` 是纯函数，只读取 `ReportScope`。同一 plan 内所有 consumer id、route 和 download path 各自唯一；参数化页面必须以具体参数成为独立 `ReportPage`。plan 没有顶层 facts 或 resources，requirements 只在三个 consumer 的 `inputs` 中声明。

CLI 或宿主在调用本页 API 前，把内建名字或用户 module 求值成一个 `ReportDefinition`。模块 URL、NiceEval 版本和 runtime identity 不进入 Report 类型，也不形成闭合的 resolution 联合。Library 扩展面是 `defineReport()`、具名内建 FactRequirement 与 `defineJsonFact()`；静态浏览器 runtime 仍只执行 exporter 内建闭包。

requirement id 在整个 plan 唯一标识一个 requirement 对象。同一个对象可以被多个 consumer 重复引用；不同对象使用相同 id 时是 `report-plan-invalid`。builder 在任何 Record 通道读取前，跨 Calculation、Page 和 Download 穷尽验证这条规则。

## FactRequirement

```ts
type FactOwner = "run" | "attempt";

declare const builtInFactBrand: unique symbol;

interface BuiltInFactSource {
  readonly kind: "built-in";
  readonly [builtInFactBrand]: true;
}

interface CustomJsonFactSource<Value extends ReportJsonValue> {
  readonly kind: "custom-json";
  parse(document: CustomFactDocument): Value;
}

interface FactRequirement<Value extends ReportJsonValue> {
  readonly id: string;
  readonly owner: FactOwner;
  readonly name: string;
  readonly source: BuiltInFactSource | CustomJsonFactSource<Value>;
}

function defineJsonFact<Value extends ReportJsonValue>(input: {
  readonly id: string;
  readonly owner: FactOwner;
  readonly name: string;
  parse(document: CustomFactDocument): Value;
}): FactRequirement<Value>;
```

可供用户 Report 声明的内建 requirement 由 NiceEval 导出，private brand 阻止用户伪造内建 decoder。`defineJsonFact()` 是自定义事实的唯一入口；name 必须是反向域 namespace，且不能以 `niceeval.` 开头。其 transport、单值 cardinality 和错误规则由 [Record Architecture](../record/architecture.md#channel-identity-与局部演进) 定义。

标准 Attempt detail definition 私有持有永久 Assertions requirement；它不新增给 Report 作者的公开导出：

| 属性 | 固定值 |
|---|---|
| requirement id | `niceeval.assertions` |
| owner | `attempt` |
| channel | `niceeval.assertions` |
| schema ID | `niceeval.assertions/v1` |
| media type | `application/json` |
| decoded type | [`AssertionsDocument`](../assertions/architecture.md#稳定落盘投影) |
| source | private built-in decoder |

这项私有 requirement 绑定冻结的业务 fact，不绑定 producer 的 assertion API、matcher 或运行时类型。每个标准 Attempt detail page 都声明它；未来标准 Report 不能通过换用新通道，让旧 assertions 虽然可解码却没有展示入口。

完整永久链是：Attempt → `niceeval.assertions/v1` → 内建 decoder → 此 FactRequirement → 标准 Attempt detail presentation。它不进入 `AnalysisSample`、execution projector、planner 或 Record 核心。

### 内建业务 requirements

下表是标准 Report 必须持续交付的内建消费链。每个 requirement 都有 private built-in brand；用户不能用同名 custom parser 替换 decoder。精确 payload 与 coverage 由所属 Feature 定义，Report 只接收 decoder 的结构化值。

| export | owner / channel | 标准 presentation |
|---|---|---|
| `verdictFact` | Attempt / `niceeval.verdict/v1` | overview 与 Attempt terminal state |
| 私有 `assertionsFact` | Attempt / `niceeval.assertions/v1` | Attempt checks、score 与证据摘要 |
| `usageFact` | Attempt / `niceeval.usage/v1` | token、请求、provider observed cost 与派生 cost |
| `conversationFact` | Attempt / `niceeval.conversation/v1` | message、tool call 与 tool result timeline |
| `commandsFact` | Attempt / `niceeval.commands/v1` | command manifest、退出状态与 evidence |
| `diffFact` | Attempt / `niceeval.diff/v1` | 文件变更 summary 与按需 detail |
| `timingFact` | Attempt / `niceeval.timing/v1` | phase duration 与 normalized waterfall |
| `attemptDiagnosticsFact` | Attempt / `niceeval.diagnostics/v1` | Attempt diagnostic list |
| `runDiagnosticsFact` | Run / `niceeval.diagnostics/v1` | Run setup、teardown 与 dispatch diagnostics |
| `actionsFact` | Run / `niceeval.actions/v1` | 每个 target slot 当时的 reuse/gap、policy、comparison 与最终 outcome |
| `sourcesFact` | Run / `niceeval.sources/v1` | origin source viewer 与 Assertion source link |
| `runProvenanceFact` | Run / `niceeval.run-provenance/v1` | Invocation detail |

标准 definition 对相应页面声明这些 requirements。source viewer 必须对 included slot 调用 ReportInput 的 `readOriginRun(slot, sourcesFact)`。composition adapter 已经用 frozen selection 与 `reader.inspectFact()`，把对应 origin Run fact 写入自包含 matrix。

source viewer 不能读取采用 Run 的 sources，也不能回到当前 worktree。被请求的 unavailable、unsupported、partial 或 invalid 必须使用统一状态组件呈现；不能因为某项 decoder 仍存在，却没有标准页面而让能力实质退役。

标准 Attempt detail 同时声明 assertions 与 sources。Assertion 没有 source 时不显示链接；sources unavailable 或 partial 时，链接显示相同状态。sources 已读但找不到同一 `(path, digest)` 时，标准页面显示 `assertion-source-reference-invalid`，仍呈现不依赖该链接的 Assertion 字段，且绝不读取当前 worktree 补猜内容。

`sourcesFact` 的 decoder 输出是普通 JSON 值，不暴露 blob ref：

```ts
type SourcesFact = {
  files: readonly {
    path: string;
    digest: string;
    content: string;
  }[];
  limitations: readonly {
    kind: "truncated" | "redacted" | "omitted";
    path: string;
    reason: string;
  }[];
};

declare const sourcesFact: FactRequirement<SourcesFact>;
```

decoder 在 composition 阶段验证 manifest、UTF-8、byte length 与 SHA-256，再把 content 复制进内存 ReportInput。静态 export 只写入已计划页面和下载实际消费的这份结构化值，不复制整个 Run 目录。

局部 parser 只接收已经验证的 `CustomFactDocument`，绝不接收原始 bytes、descriptor、路径或 blob locator。它必须同步返回 `ReportJsonValue`，不能返回 Promise。

`buildReportInput()` 只读取并验证 custom transport，不调用 parser。`executeReport()` 在执行 consumer 前，对每个 `(owner identity, requirement object)` 恰好调用一次 parser。throw 或非法 JSON 返回形成该 requirement 的 `fact-parse-invalid`；声明它的 consumer 为 input-invalid，但同名 transport 的其它 requirement 不受影响。

## Record→Reports composition adapter

```ts
function buildReportInput(input: {
  readonly reader: RecordReader;
  readonly sample: AnalysisSample;
  readonly plan: ReportPlan;
}): Effect.Effect<
  ReportInput,
  ReportInputError | RecordReadError
>;
```

adapter 先验证 plan 是由该 `AnalysisSample` 的 scope 形成，再合并每个 Page、Calculation 和 Download 的 `inputs`。它只为唯一 owner identity 与 requirement id 组合调用单通道 reader。

每个 Run-owned requirement 对 `scope.runs` 的每个 Run 建立 transport read，包括零 expected slot 或全部 slot 为 not-recorded、invalid、excluded 的 Run。builder 还读取 included Attempt 的 origin Run 与已声明 Run requirement 的组合。

origin Run 只进入内部 fact matrix，不进入 `scope.runs`、`AnalysisSample` 分母或用户可枚举的路径。每个 Attempt-owned requirement 只对 included slot 引用的唯一 Attempt 建立 transport read。所有读取都使用 core 中已经验证的 identity，不推断、不 fallback。

单个 `ChannelRead.invalid` 保存在内部 matrix；它不让 builder 丢弃其它 read。只有 root/权限/I/O 或 plan、scope、sample 不一致使 builder 整体失败。

## Calculation

```ts
type CompletenessPolicy = "allowPartial" | "requireComplete";

interface Calculation<Value> {
  readonly id: string;
  readonly inputs: readonly FactRequirement<ReportJsonValue>[];
  readonly completeness: CompletenessPolicy;
  evaluate(input: CalculationInput): CalculationValue<Value>;
}

interface CalculationInput {
  readonly report: ReportContext;
  readRun<Value extends ReportJsonValue>(
    runId: string,
    fact: FactRequirement<Value>,
  ): ChannelRead<Value>;
  readAttempt<Value extends ReportJsonValue>(
    slot: IncludedAnalysisSlot,
    fact: FactRequirement<Value>,
  ): ChannelRead<Value>;
  readOriginRun<Value extends ReportJsonValue>(
    slot: IncludedAnalysisSlot,
    fact: FactRequirement<Value>,
  ): ChannelRead<Value>;
}

type CalculationValue<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
      readonly completeness: MetricCompleteness;
    }
  | {
      readonly state: "unavailable";
      readonly reasons: readonly CalculationReason[];
      readonly completeness: MetricCompleteness;
    };

interface MetricCompleteness {
  readonly state: "complete" | "partial";
  readonly observed: number;
  readonly denominator: number;
  readonly issues: readonly ChannelIssue[];
}

type CalculationReason =
  | { readonly kind: "not-recorded"; readonly slotId: string }
  | { readonly kind: "invalid-slot"; readonly slotId: string }
  | { readonly kind: "unavailable"; readonly fact: string }
  | { readonly kind: "unsupported"; readonly fact: string }
  | { readonly kind: "incomplete"; readonly fact: string };
```

两个读取方法只能接收该 Calculation 的 `inputs`，并要求 requirement owner 与方法相符。

- `readRun()` 只接受 `scope.runs` 中的 runId。
- `readAttempt()` 只接受 included slot。
- `readOriginRun()` 只接受 included slot 与 Run-owned requirement，并查找该 slot 的 `attemptCore.origin.runId`。carried 与 accepted 因而读取源 Run 的当前 fact，不复制到采用 Run。
- 越界、owner 不符或未声明读取是 plan invalid，不会临时访问 Record。
- `requireComplete` 只有在 durable collection 与 decoding 都 complete 时成立。
- `allowPartial` 保留完整 `AnalysisSample` 分母、observed 数与 partial 标记。

## 页面与下载

```ts
interface ReportRoute {
  readonly pathname: string;
  readonly parameters: Readonly<Record<string, string>>;
}

declare const reportDownloadPathBrand: unique symbol;
type ReportDownloadPath = string & { readonly [reportDownloadPathBrand]: true };

function defineReportDownloadPath(path: string): ReportDownloadPath;

interface ReportPage {
  readonly id: string;
  readonly route: ReportRoute;
  readonly title: string;
  readonly inputs: readonly FactRequirement<ReportJsonValue>[];
  readonly calculations: readonly Calculation<unknown>[];
  render(input: ReportPageInput): ReportPageModel;
}

interface ReportPageInput {
  readonly report: ReportContext;
  readRun<Value extends ReportJsonValue>(
    runId: string,
    fact: FactRequirement<Value>,
  ): ChannelRead<Value>;
  readAttempt<Value extends ReportJsonValue>(
    slot: IncludedAnalysisSlot,
    fact: FactRequirement<Value>,
  ): ChannelRead<Value>;
  readOriginRun<Value extends ReportJsonValue>(
    slot: IncludedAnalysisSlot,
    fact: FactRequirement<Value>,
  ): ChannelRead<Value>;
  calculation<Value>(calculation: Calculation<Value>): CalculationResult<Value>;
}

interface ReportPageModel {
  readonly title: string;
  readonly body: ReportJsonValue;
  readonly textAlternative: string;
}

interface ReportDownload {
  readonly id: string;
  readonly path: ReportDownloadPath;
  readonly mediaType: string;
  readonly inputs: readonly FactRequirement<ReportJsonValue>[];
  readonly calculations: readonly Calculation<unknown>[];
  build(input: ReportDownloadInput): Uint8Array;
}

interface ReportDownloadInput extends ReportPageInput {}
```

页面与下载只能读取自己声明且 owner 匹配的 fact 和 Calculation。Run 读取只接受已选 runId；Attempt 读取只接受 included slot。Report body 是结构化 JSON，不携带浏览器代码、CSS、网络 URL 或文件路径语义。下载 bytes 在内存执行阶段完整形成。

route pathname 只接受 canonical ASCII。根路径 `/` 可用；其它路径以 `/` 开头，完整 pathname 最多 240 bytes。

每段长 1–80 bytes，首尾必须是 ASCII 字母或数字。中间只允许 `A-Z`、`a-z`、`0-9`、`.`、`_`、`-`。

比较 key 固定为对每个 ASCII byte 执行 `A-Z` → `a-z`。同一 plan 的 pathname 在 exact bytes 与该 key 上都必须唯一。

`defineReportDownloadPath()` 只接受以 `downloads/` 开头且服从同一段规则的静态输出路径。不合法时立即拒绝，builder 仍会对整个 plan 再验证一次。

## 一次执行

```ts
interface ConsumerIssue {
  readonly code: string;
  readonly message: string;
  readonly requirementId?: string;
  readonly channelName?: string;
}

type CalculationResult<Value> =
  | { readonly state: "calculated"; readonly calculation: Calculation<Value>; readonly value: CalculationValue<Value> }
  | { readonly state: "input-invalid"; readonly calculation: Calculation<Value>; readonly issues: readonly ConsumerIssue[] }
  | { readonly state: "execution-failed"; readonly calculation: Calculation<Value>; readonly issues: readonly ConsumerIssue[] };

type PageResult =
  | { readonly state: "rendered"; readonly page: ReportPage; readonly model: ReportPageModel }
  | { readonly state: "input-invalid"; readonly page: ReportPage; readonly issues: readonly ConsumerIssue[] }
  | { readonly state: "execution-failed"; readonly page: ReportPage; readonly issues: readonly ConsumerIssue[] };

type DownloadResult =
  | { readonly state: "built"; readonly download: ReportDownload; readonly bytes: Uint8Array }
  | { readonly state: "input-invalid"; readonly download: ReportDownload; readonly issues: readonly ConsumerIssue[] }
  | { readonly state: "execution-failed"; readonly download: ReportDownload; readonly issues: readonly ConsumerIssue[] };

interface ReportExecution {
  readonly plan: ReportPlan;
  readonly input: ReportInput;
  readonly calculations: readonly CalculationResult<unknown>[];
  readonly pages: readonly PageResult[];
  readonly downloads: readonly DownloadResult[];
}

function executeReport(input: {
  readonly definition: ReportDefinition;
  readonly plan: ReportPlan;
  readonly input: ReportInput;
}): ReportExecution;
```

输入含 invalid 时，宿主不调用该 consumer 的用户函数，形成 `input-invalid`。Page 或 Download 声明的 Calculation 若为 `input-invalid`，它也形成 `input-invalid`；Calculation 为 `execution-failed` 时，它形成 `execution-failed`。只有全部声明依赖可交付时才调用用户函数。

用户函数 throw、返回非穷尽值或产生非法 JSON/bytes 时形成 `execution-failed`，不能冒充输入错误。unavailable 与 unsupported 仍作为 `ChannelRead` 交给 consumer 明确呈现。

execute 先完成全部唯一 custom parser，再按 plan 顺序运行 Calculation、Page 和 Download。每个 parser 与 consumer 最多执行一次。之后 view 与 export 不再执行用户代码、计算或 parser。

`ReportExecution.calculations` 与 `plan.calculations` 一一对应、顺序相同；每项 result 还携带原 Calculation 引用。Calculation id 在 plan 内唯一，页面和下载只能请求 plan 中同一对象。

## 本机 view

```ts
function viewReport(input: {
  readonly execution: ReportExecution;
}): Promise<void>;
```

本机宿主显示所有 route。`rendered` 使用 PageModel；`input-invalid` 与 `execution-failed` 使用内建具名错误页。一个页面失败不阻止其它页面，也不触发新的 Record 读取。

## 静态 export

```ts
type StaticAssetKind =
  | "page"
  | "host-data"
  | "runtime"
  | "style"
  | "font"
  | "download";

declare const staticOutputPathBrand: unique symbol;
type StaticOutputPath = string & { readonly [staticOutputPathBrand]: true };

interface StaticAsset {
  readonly path: StaticOutputPath;
  readonly kind: StaticAssetKind;
  readonly mediaType: string;
  readonly byteLength: number;
}

interface StaticRouteEntry {
  readonly route: ReportRoute;
  readonly pagePath: StaticOutputPath;
  readonly hostDataPath: StaticOutputPath;
}

interface StaticAssetManifest {
  readonly routes: readonly StaticRouteEntry[];
  readonly entries: readonly StaticAsset[];
}

interface StaticReport {
  readonly manifest: StaticAssetManifest;
}

function exportStaticReport(input: {
  readonly execution: ReportExecution;
  readonly out: string | URL;
}): Promise<StaticReport>;
```

export 先对同一 execution 的全部结果做 preflight。任一 `input-invalid` 或 `execution-failed` 都在创建正式目标前失败。通过后，exporter 只写 PageModel、host-data、download bytes 与当前 NiceEval 编译闭包中的精确 runtime、基础样式和字体；没有用户 resource provider，也不读取 Record、网络或任意用户路径。

exporter 按 `plan.pages` 的零基顺序分配 `pages/<index>.html` 与 `host-data/<index>.json`，不从 route 或 page id 推导文件名。内建脚本、样式、字体和其它运行文件只位于 `runtime/`。用户只能通过 Download 写 `downloads/`。

每个输出 path 都必须是 canonical ASCII POSIX 相对路径。完整 path 最多 240 bytes，每段长 1–80 bytes、首尾为 ASCII 字母或数字；中间允许的字符与 route 相同。

空值、空段、点段、反斜线、NUL、绝对前缀、冒号、query 和 fragment 都不能出现。规范比较 key 固定为逐 byte 把 `A-Z` 转成 `a-z`；完整输出集合的 exact bytes 与 key 都必须唯一。

一个 key 等于另一个 key，或以另一个 key 加 `/` 开头，就是相等/目录前缀冲突。

namespace owner 固定如下。其它 kind 或用户 path 进入这些保留位置即为冲突。

| owner | 唯一位置 |
|---|---|
| manifest | `manifest.json` |
| 页面 | `pages/` |
| 宿主数据 | `host-data/` |
| 内建资源 | `runtime/` |
| Download | `downloads/` |

exporter 在创建任何临时目录前，一次构造并验证全部 route、页面路径、host-data 路径、download 路径、内建 runtime 闭包与 manifest 路径。只有这份集合有效，才允许进行目标存在性检查和写入。

`out` 必须不存在，存在时返回 `report-export-target-exists`，不替换或删除。临时目录位于 out 同级，以 out basename、`.niceeval-tmp-` 和本次随机 128-bit owner ID 唯一命名并 exclusive create。成功时以同一文件系统的一次目录 rename 让完整目标出现；可处理失败只删除本 owner 的临时目录。崩溃 orphan 不被后续调用领养或自动删除。

manifest 固定写为 `manifest.json`。它是目录中唯一不列入 `entries` 的文件，避免自身 byteLength 递归；除此之外每个普通文件与 entry 一一对应。`routes` 穷尽全部 planned page，并让 pagePath、hostDataPath 各指向唯一 entry。断网 runtime 只读取 manifest 与其列出的文件，不依赖调用进程、源 Record或未来 NiceEval。

## 错误边界

```ts
class ReportInputError extends Error {
  readonly code:
    | "report-input-invalid"
    | "report-plan-invalid"
    | "report-input-permission-denied"
    | "report-input-io-failure";
}

class ReportExportError extends Error {
  readonly code:
    | "report-export-input-invalid"
    | "report-export-execution-failed"
    | "report-export-target-exists"
    | "report-export-manifest-invalid"
    | "report-export-write-failed";
}
```

fact/channel/parser 问题保留在对应 matrix 和 consumer result。builder 的 I/O 不伪装成 channel invalid；export 的目标与写入错误也不伪装成 Report 输入状态。

## JSON 值

```ts
type ReportJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ReportJsonValue[]
  | { readonly [key: string]: ReportJsonValue };
```
