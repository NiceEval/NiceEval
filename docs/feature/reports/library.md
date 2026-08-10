# Reports Library

本页是 Reports 公开类型的唯一 owner。Record 拥有文件与 `ChannelRead`，Sample 拥有 core-only 选择和分母。只有本页的 composition adapter 同时接收 `RecordReader`、`Sample` 与 `ReportPlan`；Report 定义、计算、页面、本机 runtime 和静态 runtime 都不能接收 reader 或路径。

## 唯一调用顺序

```ts
let sample: Sample;
let plan: ReportPlan;
let input: ReportInput;
{
  await using record = await openRecordReader({ root });
  sample = await selectSample(record, selection);
  const scope = createReportScope(sample);
  plan = definition.plan(scope);
  input = await buildReportInput({ record, sample, plan });
}

// reader lease 已释放；以下操作不再访问 Record。
const execution = executeReport({ definition, plan, input });
await viewReport({ execution });
await exportStaticReport({ execution, out });
```

`selectSample()` 不读取业务通道。`plan()` 不读取 facts。`buildReportInput()` 只读取 plan 已声明的 facts。CLI 从打开 reader 到 `buildReportInput()` 返回一直持有 root lease，随后立即释放。`executeReport()` 只消费内存输入并执行一次用户 parser、计算和 render；view 与 export 只消费同一份自包含 `ReportExecution`。

## ReportScope 与 ReportInput

```ts
interface ReportScope {
  readonly selection: RunSelection;
  readonly runs: readonly SampleRun[];
  readonly slots: readonly SampleSlot[];
}

function createReportScope(sample: Sample): ReportScope;

declare const reportFactsBrand: unique symbol;

interface ReportFactMatrix {
  readonly kind: "internal-report-fact-matrix";
}

interface ReportInput {
  readonly scope: ReportScope;
  readonly sample: Sample;
  readonly [reportFactsBrand]: ReportFactMatrix;
}

declare const reportSampleBrand: unique symbol;

interface ReportSample {
  readonly [reportSampleBrand]: true;
  readonly selection: RunSelection;
  readonly runs: readonly SampleRun[];
  readonly slots: readonly SampleSlot[];
  readonly included: readonly IncludedSampleSlot[];
  readonly notRecorded: readonly NotRecordedSampleSlot[];
  readonly invalid: readonly InvalidSampleSlot[];
  readonly excluded: readonly ExcludedSampleSlot[];
}

interface ReportContext {
  readonly scope: ReportScope;
  readonly sample: ReportSample;
}
```

`scope.runs` 穷尽已选 Run，`scope.slots` 保留 core-only Sample 的完整状态与顺序，因此 plan 可以穷尽 Run、slot 和 Attempt detail route，但看不到业务值。fact matrix 由未导出的 symbol 隔离，Report 作者无法直接索引它。

consumer 只收到 <code>ReportContext</code> 和宿主提供的受控读取方法。宿主逐字段建立带 private brand 的精确 <code>ReportSample</code>，不把原 <code>Sample</code> 对象传入回调。这个 projection 不含 <code>recordRoot</code>；Calculation、Page 与 Download 的公开字段都无法取得 reader、Record root 或其它磁盘路径。

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

requirement id 在整个 plan 唯一标识一个 requirement 对象。同一个对象可以被多个 consumer 重复引用；不同对象使用相同 id 时是 <code>report-plan-invalid</code>。builder 在任何 Record 通道读取前，跨 Calculation、Page 和 Download 穷尽验证这条规则。

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

可供用户 Report 声明的内建 requirement 由 NiceEval 导出，private brand 阻止用户伪造内建 decoder。`defineJsonFact()` 是自定义事实的唯一入口；name 必须是反向域 namespace，且不能以 `niceeval.` 开头。其 transport、单值 cardinality 和错误规则由 [Record Architecture](../record/architecture.md#通道语义与兼容性) 定义。

标准 Attempt detail definition 私有持有永久 Assertions requirement；它不新增给 Report 作者的公开导出：

| 属性 | 固定值 |
|---|---|
| requirement id | <code>niceeval.assertions</code> |
| owner | <code>attempt</code> |
| channel | <code>niceeval.assertions</code> |
| media type | <code>application/json</code> |
| decoded type | [<code>AssertionsDocument</code>](../assertions/architecture.md#稳定落盘投影) |
| source | private built-in decoder |

这项私有 requirement 绑定冻结的业务 fact，不绑定 producer 的 assertion API、matcher 或运行时类型。每个标准 Attempt detail page 都声明它；未来标准 Report 不能通过换用新通道，让旧 assertions 虽然可解码却没有展示入口。

完整永久链是：Attempt → <code>niceeval.assertions</code> → 内建 decoder → 此 FactRequirement → 标准 Attempt detail presentation。它不进入 Sample、planner 或 Record 核心。

局部 parser 只接收已经验证的 `CustomFactDocument`，绝不接收原始 bytes、descriptor、路径或 blob locator。它必须同步返回 <code>ReportJsonValue</code>，不能返回 Promise。

<code>buildReportInput()</code> 只读取并验证 custom transport，不调用 parser。<code>executeReport()</code> 在执行 consumer 前，对每个 <code>(owner identity, requirement object)</code> 恰好调用一次 parser。throw 或非法 JSON 返回形成该 requirement 的 <code>fact-parse-invalid</code>；声明它的 consumer 为 input-invalid，但同名 transport 的其它 requirement 不受影响。

## Record→Reports composition adapter

```ts
function buildReportInput(input: {
  readonly record: RecordReader;
  readonly sample: Sample;
  readonly plan: ReportPlan;
}): Promise<ReportInput>;
```

adapter 先验证 plan 是由该 Sample 的 scope 形成，再合并每个 Page、Calculation 和 Download 的 `inputs`。它只为唯一 owner identity 与 requirement id 组合调用单通道 reader。

每个 Run-owned requirement 对 <code>scope.runs</code> 的每个 Run 建立 transport read，包括零 expected slot 或全部 slot 为 not-recorded、invalid、excluded 的 Run。每个 Attempt-owned requirement 只对 included slot 引用的唯一 Attempt 建立 transport read。两者不推断、不 fallback。

单个 <code>ChannelRead.invalid</code> 保存在内部 matrix；它不让 builder 丢弃其它 read。只有 root/权限/I/O 或 plan、scope、sample 不一致使 builder 整体失败。

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
    slot: IncludedSampleSlot,
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

两个读取方法只能接收该 Calculation 的 <code>inputs</code>，并要求 requirement owner 与方法相符。

- <code>readRun()</code> 只接受 <code>scope.runs</code> 中的 runId。
- <code>readAttempt()</code> 只接受 included slot。
- 越界、owner 不符或未声明读取是 plan invalid，不会临时访问 Record。
- <code>requireComplete</code> 只有在 durable collection 与 decoding 都 complete 时成立。
- <code>allowPartial</code> 保留完整 Sample 分母、observed 数与 partial 标记。

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
    slot: IncludedSampleSlot,
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

route pathname 只接受 canonical ASCII。根路径 <code>/</code> 可用；其它路径以 <code>/</code> 开头，完整 pathname 最多 240 bytes。

每段长 1–80 bytes，首尾必须是 ASCII 字母或数字。中间只允许 <code>A-Z</code>、<code>a-z</code>、<code>0-9</code>、<code>.</code>、<code>_</code>、<code>-</code>。

比较 key 固定为对每个 ASCII byte 执行 <code>A-Z</code> → <code>a-z</code>。同一 plan 的 pathname 在 exact bytes 与该 key 上都必须唯一。

<code>defineReportDownloadPath()</code> 只接受以 <code>downloads/</code> 开头且服从同一段规则的静态输出路径。不合法时立即拒绝，builder 仍会对整个 plan 再验证一次。

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

<code>ReportExecution.calculations</code> 与 <code>plan.calculations</code> 一一对应、顺序相同；每项 result 还携带原 Calculation 引用。Calculation id 在 plan 内唯一，页面和下载只能请求 plan 中同一对象。

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

exporter 按 <code>plan.pages</code> 的零基顺序分配 <code>pages/&lt;index&gt;.html</code> 与 <code>host-data/&lt;index&gt;.json</code>，不从 route 或 page id 推导文件名。内建脚本、样式、字体和其它运行文件只位于 <code>runtime/</code>。用户只能通过 Download 写 <code>downloads/</code>。

每个输出 path 都必须是 canonical ASCII POSIX 相对路径。完整 path 最多 240 bytes，每段长 1–80 bytes、首尾为 ASCII 字母或数字；中间允许的字符与 route 相同。

空值、空段、点段、反斜线、NUL、绝对前缀、冒号、query 和 fragment 都不能出现。规范比较 key 固定为逐 byte 把 <code>A-Z</code> 转成 <code>a-z</code>；完整输出集合的 exact bytes 与 key 都必须唯一。

一个 key 等于另一个 key，或以另一个 key 加 <code>/</code> 开头，就是相等/目录前缀冲突。

namespace owner 固定如下。其它 kind 或用户 path 进入这些保留位置即为冲突。

| owner | 唯一位置 |
|---|---|
| manifest | <code>manifest.json</code> |
| 页面 | <code>pages/</code> |
| 宿主数据 | <code>host-data/</code> |
| 内建资源 | <code>runtime/</code> |
| Download | <code>downloads/</code> |

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
