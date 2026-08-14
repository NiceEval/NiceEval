# Report Library（报告库）

本页是 `niceeval/report` 作者 API 的唯一契约。Report 作者从这个导入面取得页面、组件和显示原语；Analysis
字段从 `niceeval/analysis` 导入。Record reader、迁移、SQL、执行器、输出目录和 module loader 都不进入作者面。

`niceeval/report/host` 是独立的公开、受支持高级 Host composition SDK。CLI、替代 CLI / Web host 或深度应用
集成用它执行、呈现、提供 view 或导出闭合 Report；它不是 Report 作者 API，也不把 reader 或 loader 交给作者。

## 导入面

```ts
import {
  aggregate,
  Bars,
  defineComponent,
  defineReport,
  Download,
  Grid,
  Line,
  Scatter,
  Stat,
  Table,
  type MetricValue,
  type PageEvidence,
} from "niceeval/report";
import { query, type Sample } from "niceeval/analysis";
```

aggregate() 和 query() 使用同一份 Analysis 口径。前者适合按维度形成 rows；后者适合高级分组和领域视图。两者只在 Page 或组件回调内接受 host 签发的 Sample。

## 闭合数据

Sample 表示固定 selection 与受限的惰性读取能力。作者不能构造它、改变它的 Record root、把它带出 callback，也不能用它重写总体或分母。

```ts
const rows = await aggregate(sample, {
  by: { model, condition },
  values: { passRate, duration, costUSD },
});

const comparison = await query(sample, comparisonRequest);
const comparisonRows = comparison.rows;
```

aggregate() 返回 ClosedRows。整组 rows 有稳定 identity 和 issues；每行有 closed key、完整分组坐标和每个度量的 MetricValue。query() 的表格结果也以同样的 rows 交给显示组件。Table、Bars、Line 和 Scatter 只接收 rows 或 points，不能接收查询结果对象本身。

普通外部数组可以进入中立组件，但没有 Analysis identity、issues 或 Evidence navigation。需要这些语义的值必须先由 aggregate() 或 query() 闭合。

闭合 DomainView 不是 `SemanticFrame` 的替代输入。Table 仍只接收 rows，Bars / Line / Scatter 仍只接收 points，
Stat 仍只接收完整 MetricValue。

要展示 Attempt 的 Evidence、Verdict、Observability 或 File Changes，复合组件把已经关闭的视图转换成 Table、Text、
Callout 等中立节点。三个 DomainView 的 entry 只能按 canonical locator 显式 Map 关联，missing 或 duplicate 都不能
退化成数组位置关联。File Changes 首先呈现按 send 区间排列的 trajectory；只有 Analysis 已关闭 reliable `net` 时，
组件才能把它作为摘要或 `DiffView` 输入。

### MetricValue

```ts
interface MetricValue {
  readonly value: number | null;
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

value 是 number 或 null。samples 是实际贡献数，total 是该分组坐标的固定分母。合法零值保持 value: 0；它不是 empty。partial 可以有 value: null，但只能表示分母内成员缺失且没有贡献值。

| state | value | 必须保留的含义 |
|---|---|---|
| available | number | 所有预期成员按该度量规则贡献。 |
| partial | number 或 null | 部分成员贡献，issues 说明缺口。 |
| empty | null | 输入完整，但领域结果合法为空。 |
| unsupported | null | 当前 host 不支持所需 Analysis 输入。 |
| failed | null | 输入读取或归并失败，issues 保留身份与引用。 |

显示组件不得只取 value。它们必须保留 state、samples、total、issues 和 refs；显示排序、limit 与 filter 只能改变可见项，不能重算 MetricValue 或缩小 total。

## 两种 defineComponent()

defineComponent() 有且只有两种作者形态。两者都只生成 NiceEval 的语义节点或其它组件，不能返回 DOM、任意 HTML、CSS、React element 或浏览器副作用。

### 复合组件

复合组件可以异步取得闭合数据，再组合已有显示原语。

```ts
interface ComposeContext {
  readonly sample: Sample;
  readonly page: PageContext;
}

declare function defineComponent<Props extends object>(
  compose: (
    props: Props,
    context: ComposeContext,
  ) => ReportNode | Promise<ReportNode>,
): ReportComponent<Props>;
```

```tsx
export const Leaderboard = defineComponent(async (_props, { sample }) => {
  const rows = await aggregate(sample, {
    by: { model },
    values: { passRate, duration },
  });

  return (
    <Grid>
      <Bars points={rows} x="model" y="passRate" />
      <Table rows={rows} />
    </Grid>
  );
});
```

同一 Page instance 内，同一复合组件实例至多执行一次。它可以根据已经闭合的 rows 决定下一段显示，或再调用 aggregate()；后一次调用仍只闭合自己的有限 Analysis 依赖。

### 双面原语

新原语必须同时定义 text face 和 web face。`resolve()` 在呈现前求值闭合数据，是唯一允许异步取数的位置；两个呈现面同步读取同一个 `Resolved` 值。

```ts
interface ComponentFaces<Props extends object, Resolved = Props> {
  resolve?(
    props: Props,
    context: ResolveContext,
  ): Resolved | Promise<Resolved>;
  dimensions?(data: Resolved, props: Props): DimensionDeclarations;
  text(data: Resolved, context: TextContext): TextFaceNode;
  web(data: Resolved, context: WebContext): WebFaceNode;
}

declare function defineComponent<Props extends object, Resolved = Props>(
  faces: ComponentFaces<Props, Resolved>,
): ReportComponent<Props>;
```

`Resolved` 是 `resolve()` 求值得到的闭合值。它不能含 Sample、reader、Promise、Stream、回调、文件路径、查询能力或任意 Record payload。Host 在 `resolve()` 返回后验证该值，再交给 text 和 web；两面不得各自重算数据。

原语是 NiceEval core 的扩展面。新增原语必须同时定义 terminal、Web、static、无 JavaScript 降级和可访问语义。普通 Report module 只能组合已有原语。

## Page 与 defineReport()

Page 直接写进 defineReport({ pages })。id 用于诊断和稳定顺序；path 是用户可访问的 base route。没有另一个 Page factory 或 family 定义面。

```ts
interface PlainPageDefinition<Input = Sample> {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  readonly navigation?: boolean;
  readonly load?: (
    sample: Sample,
    params: void,
    context: PageLoadContext,
  ) => Input | Promise<Input>;
  readonly render: (
    input: Input,
    context: PageContext,
  ) => ReportNode | Promise<ReportNode>;
}

interface PageLoadContext {
  readonly page: PageContext;
  readonly evidence: (locator: EvidenceLocator) => Promise<PageEvidence>;
}

interface ParameterizedPageDefinition<
  Params extends JsonValue,
  Input,
> {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  readonly navigation: false;
  readonly params: {
    encode(params: Params): string;
    decode(key: string): Params;
    enumerate(sample: Sample): Iterable<Params> | Promise<Iterable<Params>>;
  };
  readonly load: (
    sample: Sample,
    params: Params,
    context: PageLoadContext,
  ) => Input | Promise<Input>;
  readonly render: (
    input: Input,
    context: PageContext,
  ) => ReportNode | Promise<ReportNode>;
}

type PageDefinition =
  | PlainPageDefinition
  | ParameterizedPageDefinition<JsonValue, unknown>;

declare function defineReport(options: {
  readonly title?: LocalizedText;
  readonly pages: readonly [PageDefinition, ...PageDefinition[]];
}): Report;
```

普通 Page 可以省略 load，此时 render 的输入就是 Sample。参数化 Page 必须同时给出 params、load 和 navigation: false。它的实例 route 是 path 加上 encode(params) 生成的一个 key segment。

```tsx
const EvidenceSummary = defineComponent(
  ({ evidence }: { readonly evidence: PageEvidence }) =>
    Table({
      caption: "Evidence",
      rows: evidence.entries.map(entry => ({
        attempt: entry.attempt.locator,
        state: entry.state,
      })),
    }),
);

export default defineReport({
  title: "Experiment report",
  pages: [
    {
      id: "overview",
      path: "/",
      title: "Overview",
      render: async sample => {
        const rows = await aggregate(sample, {
          by: { model, condition },
          values: { passRate, duration },
        });

        return <Table rows={rows} />;
      },
    },
    {
      id: "attempt",
      path: "/attempt",
      title: "Attempt",
      navigation: false,
      params: attemptParams,
      load: async (_sample, params, context) => await context.evidence(params.locator),
      render: evidence => <EvidenceSummary evidence={evidence} />,
    },
  ],
});
```

PageLoadContext 只提供闭合领域帮助器，例如异步按精确 locator 取得 Evidence。它通过同一条
Analysis DomainView 请求验证 locator 属于当前 Sample，并且只读取这一项所需的事实；它不提供 Record
reader、source、root、迁移或任意路径访问。

### 路由和参数运行时验证

普通 route 是 /，或由 1 到 32 个小写 ASCII segment 组成的绝对路径。每个 segment 满足 [a-z0-9][a-z0-9._~-]*，最多 128 bytes；整条路径最多 1,024 bytes。路径拒绝 percent、query、fragment、backslash、空 segment、.、..、尾随 /、尾点、尾空格和 Windows device name。

Page id 使用 [a-z][a-z0-9_-]*，最多 128 bytes，不能是纯 ordinal。定义阶段在任何作者 callback 或事实读取之前校验：

- pages 非空，且每项是一个直接定义对象；
- id 不重复；
- 普通 Page path 不重复；
- 参数化 Page 的 path、params、load 和 navigation 形状完整；
- path 和标题是可安全显示的值。

参数化 Page 的 key 使用同一个 segment 语法。Host 对 enumerate() 的每一个值调用 encode()，随后调用 decode(key)，并要求 encode(decode(key)) 恢复完全相同的 key。重复 key、非规范 key、抛出的 encode 或 decode，以及不合法的返回值，都记为该 Page 的执行问题。

show 或 view 直达参数 route 时只 decode 被请求 key，并做相同的规范化检查。静态导出则恰好调用每个参数化 Page 一次 enumerate(sample)，并对枚举出的每一个实例执行 load 和 render。空枚举是合法结果，但 execution 仍保留该 Page 的 instanceCount: 0 摘要。

所有实例 route、下载路径、host-data、runtime、manifest 和完成标记进入同一个输出冲突集合。Host 拒绝 exact collision、ASCII case-fold collision、file/directory prefix collision、Windows 尾点或尾空格 collision、device-name collision 和长度超限。定义时可知的冲突返回 report-definition-invalid；枚举后才可知的冲突记为 route-conflict。

## ClosedReportTree

Page、复合组件和原语执行后，Host 形成 ClosedReportTree。它只保存已求值的节点、title、route、闭合 props、下载项、问题和 renderer 所需值。

```ts
interface ClosedReportTree {
  readonly pages: readonly ClosedReportPage[];
  readonly downloads: readonly ClosedDownload[];
  readonly problemTable: readonly ReportProblemTableEntry[];
}

interface ClosedReportPage {
  readonly pageId: string;
  readonly route: string;
  readonly title: LocalizedText;
  readonly node: ClosedReportNode;
  readonly problemIds: readonly number[];
}
```

ClosedReportTree 不含 Sample、Record reader、Scope、Promise、callback、Stream、query executor、模块对象或原始载荷。text、web 与 static renderer 只消费这棵树，不能重新读取事实或改变分母。

Host 在每个 callback 边界执行运行时验证：

- scalar number 必须 finite，string 只含 Unicode scalar values；
- 节点、数组和对象不能有 cycle；深度、节点数、字符串数和 bytes 受固定上限约束；
- Table 的列 key 非空且唯一；每个 row 的字段必须与列形状一致；
- 图形 channel 必须引用存在的闭合字段；同一 series 的点数、标签和状态行必须对齐；
- Analysis-backed rows 必须保留自身 identity、issues 和每格的 MetricValue；
- route 与 download link 必须指向当前 execution 的闭合目标；
- HTML 按上下文 escape，terminal 将控制字符显示为可见文本，未知节点类型按 unsupported 处理。

作者不能用另一份 text alternative、原始 HTML 或视觉位置绕过这些规则。图形、颜色、hover 和交互只能增强树中已有的文字、表格、数值、状态和链接。

## 下载与静态路径

Download 是普通语义原语。它接收已经闭合的 bytes，不在 export 时重新计算。

```tsx
<Download
  file={{
    path: "quality.csv",
    mediaType: "text/csv; charset=utf-8",
    bytes: qualityCsv,
  }}
>
  Download quality data
</Download>
```

下载 path 是相对路径，由同一 segment 语法组成。静态输出固定映射为：

```text
/              -> index.html
/a/b           -> a/b/index.html
download x     -> downloads/x
```

链接不直接写语义 route。Host 从当前页面的 POSIX dirname 到目标输出文件计算相对 href，分隔符固定为 /，并始终显式包含 index.html。Host 自己的文件使用保留 namespace _niceeval。

## 执行、问题和类型化错误

Host 在 Sample 的 Scope 仍存活时执行 Page，随后只保留闭合 execution。

`niceeval/report/host` 的唯一值导出是公开、受支持的 `reportHost`，其 key 精确为 `execute`、`show`、`serve` 与
`export`。ReportHostSDK 是它的 TypeScript contract。它不导出 loader、renderer、watcher 或 Record reader 的
可组合内部接口。

```ts
type ReportHostExecuteInput =
  | {
      readonly root: RecordRoot;
      readonly locator: AttemptLocator;
      readonly report?: Report;
      readonly target?: ReportTargetSelection;
    }
  | {
      readonly root: RecordRoot;
      readonly selection: AnalysisSelectionRequest;
      readonly report?: Report;
      readonly target?: ReportTargetSelection;
    };

reportHost.execute(input); // Effect<ReportExecution>
reportHost.show({ execution, format: "text", page: "/" });
reportHost.serve({ url, host, port, initial, rebuild });
reportHost.export({ execution, out });
```

execute 由 root 与 locator 或 Analysis selection 打开 Record 和 Sample，随后关闭它们，再交出 ReportExecution。show 只读取闭合 execution 的 text 或 JSON。serve 为每个成功 revision 持有一份 execution，export 只写传入的静态 execution。terminal、Web 和 static 从未各自拿到 Sample 或 callback。

同一 ReportExecution 内，某个 Page instance 的 load、render、复合组件和原语 `resolve()` 至多运行一次。相同 Sample identity 与相同 Analysis 字段依赖共用结果缓存。show 和 view 只执行请求页面；静态 execution 运行全部普通页面与全部参数实例。

ReportExecution 不包含 reader、root、路径、Scope、callback 或任何可再次读取数据的能力。renderer 读取 `tree`；`pages`、`downloads` 和 `problemTable` 保留执行结果与失败隔离。

```ts
interface ReportExecution {
  readonly report: ReportExecutionIdentity;
  readonly sample: ReportSampleSummary;
  readonly target: ReportTargetSelection;
  readonly pageSummaries: readonly ReportPageSummary[];
  readonly pages: readonly ReportPageResult[];
  readonly downloads: readonly ReportDownloadResult[];
  readonly problemTable: readonly ReportProblemTableEntry[];
  readonly tree: ClosedReportTree;
}

type ReportPageResult =
  | {
      readonly state: "rendered";
      readonly pageId: string;
      readonly route: string;
      readonly tree: ClosedReportPage;
      readonly problemIds: readonly number[];
    }
  | {
      readonly state: "execution-failed";
      readonly pageId: string;
      readonly route?: string;
      readonly problemIds: readonly [number, ...number[]];
    };
```

Analysis issue 是可呈现的数据事实。它保留在 MetricValue、ClosedRows、领域视图和不可关闭的问题面中，不自动使 Page 失败。Host 收集本次 execution 已完成的 Analysis 请求；作者过滤 rows、丢弃查询返回值或返回无关节点都不能移除这些问题。load、render、复合组件、`resolve()`、参数处理、树验证、route collision 或下载 collision 失败，则进入 execution problem。show 和 view 保留其它成功 Page；static export 对任一 execution problem fail closed。

## 内建 Report

NiceEval 的内建 Report 是 Host 提供的普通 Report，不另建作者导入面。它们和自定义 Report 一样，只从
Sample 取得 NiceEval 已发布的 Analysis input 与闭合领域值，不能取得 Record reader、路径或持久化 raw
payload。默认选择和有界 Run 概览见 [CLI](cli.md#内建-run-概览)；它们仍以 Sample Core、MetricValue、闭合
Evidence 和问题面为准，而不是创建 Report 自己的持久状态。

精确 Attempt 的内建 overview 同时消费 Evidence、Observability 与 File Changes。Evidence 已含 immutable Outcome、
权威 Core + Assertions fold 的 Verdict 及 Assertions；Observability 由 `AttemptTrace` 展示 command 与 diagnostic。

File Changes 先显示 trajectory 与 collection。仅 reliable `net` 可进入摘要或 `DiffView`；完整空轨迹、partial 的
空安全前缀和 `not-recorded` 分开显示，partial limitation 与 `indeterminate` issue 不可隐藏。

overview 只组织这些闭合结果，不直接读取 Record 或重新计算 Verdict 或 `net`。

```ts
interface ReportExecutionProblem {
  readonly category: "execution";
  readonly code:
    | "page-params-invalid"
    | "page-load-failed"
    | "page-render-failed"
    | "component-compose-failed"
    | "component-resolve-failed"
    | "semantic-tree-invalid"
    | "route-conflict"
    | "download-conflict";
  readonly pageId?: string;
  readonly summary: string;
}

type ReportExecutionError =
  | AnalysisError
  | ReportLimitExceeded
  | {
      readonly code: "report-definition-invalid";
      readonly issues: readonly ReportDefinitionIssue[];
    }
  | {
      readonly code: "report-route-invalid";
      readonly route: string;
      readonly reason: string;
    };

type ReportShowError =
  | ReportConsoleError
  | { readonly code: "report-show-render-failed"; readonly operation: string };

type ReportViewOpenError =
  | ReportExecutionError
  | { readonly code: "report-view-open-failed"; readonly reason: string };

type ReportExportError =
  | ReportLimitExceeded
  | {
      readonly code: "report-export-execution-problem";
      readonly problems: readonly ReportExecutionProblem[];
    }
  | { readonly code: "report-export-target-exists" }
  | { readonly code: "report-export-write-failed"; readonly operation: string };
```

Typed failure、execution problem、Analysis issue 和 interruption 绝不互相冒充。公开 error 不能泄露 payload、secret、任意 filesystem path 或 raw system cause；诊断日志只可在显式 debug policy 下输出已脱敏的内部原因。

## Static export

export() 只消费一份已经完成的静态 execution。它按以下顺序工作：

1. 检查 execution problem、闭合树、全部 route、下载、限额和输出 closure；
2. 在写出首字节之前，唯一地检查并准备目标目录；
3. 写出 HTML、host-data、downloads、manifest 和内建 runtime；
4. 全部文件成功写出后，最后写零字节 complete marker；
5. sync 目录并返回 receipt。

目标目录必须不存在。存在的完整目录与前次失败留下的无 complete marker 目录都返回 report-export-target-exists；Host 不删除、不替换，也不缓存前一次 prepare 成功。中断或写入失败可能留下没有 marker 的目录，Host 据此提示用户删除后重试。此合同不承诺原子目录发布。

Recorded Analysis issue 可以进入静态站的不可关闭问题面。任一 execution problem 则不发布完整站点。

## 限额

| 常量 | maximum | 计数范围 |
|---|---:|---|
| REPORT_PAGES_MAX | 20,000 | 普通页面加全部参数实例 |
| REPORT_DOCUMENT_NODES_MAX | 20,000 | 每份闭合页面树 |
| REPORT_DOCUMENT_DEPTH_MAX | 32 | 每份闭合页面树 |
| REPORT_DOWNLOAD_FILES_MAX | 1,000 | 全部下载项 |
| REPORT_DOWNLOAD_FILE_BYTES_MAX | 33,554,432 | 单个规范化文件 buffer |

Host 在分配固定集合前检查已知数量，并在 enumerate()、树遍历和下载收集时累计其它限额。降低 maximum 是 breaking contract；实现不能散落匿名 magic number。

```ts
interface ReportLimitExceeded {
  readonly code: "report-limit-exceeded";
  readonly limit:
    | "pages"
    | "document-nodes"
    | "document-depth"
    | "download-files"
    | "download-file-bytes";
  readonly maximum: number;
  readonly observedAtLeast: number;
}
```

## 实现验收

实现不能只以 Markdown lint 证明。冻结验收至少检查：

- 普通 Page、参数化 Page、两种 defineComponent() 形态和普通 named result 类型都能编译；
- 参数 encode/decode 的规范往返、重复 key、跨 Page route conflict、大小写 conflict 与目录前缀 conflict；
- static execution 枚举每个参数化 Page，并在空枚举时保留摘要；
- 同一 Page instance、组件实例和 Analysis 依赖在一次 execution 中最多执行一次；
- 关闭 Scope 后，renderer 无法再取得 Sample 或 reader；
- closed tree 拒绝 cycle、非有限数、坏 Unicode、坏表格和坏图形形状；
- show、view 与 static 从同一闭合树读取，static 对 execution problem 拒绝发布；
- complete marker、已存在目录、无 marker 目录和 typed export error 的精确分支。

## 相关阅读

- [Reports README](README.md)：范围和作者心智。
- [数值与显示语义](calculations.md)：MetricValue 与显示边界。
- [Architecture](architecture.md)：执行时序和不变量。
- [CLI](cli.md)：用户命令与热重载。
- [分享静态报告站](use-case/分享静态报告站.md)：完整站点的实际路径。
