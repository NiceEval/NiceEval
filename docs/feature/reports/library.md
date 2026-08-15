# Report Library（报告库）

本页是 `niceeval/report` 作者 API 的唯一契约。Report 作者只从这个导入面取得 ReportDefinition、Page、组件、
计算、投影和显示原语。Record reader、迁移、输出目录、watcher、模块加载和 renderer 不进入作者面。

Host composition SDK 服务 CLI、替代 CLI 或深度应用集成。它以固定 Sample 和 ReportDefinition 调用
`buildSiteRevision()`，得到内部 ClosedSiteRevision。普通作者不导入 Host entry，也不把 revision 当作返回值。

## 作者导入与调用

```tsx
import {
  aggregate,
  Bars,
  defineComponent,
  defineReport,
  Download,
  Grid,
  model,
  passRate,
  Stat,
  Table,
  type MetricValue,
  type PageEvidence,
  type Sample,
} from "niceeval/report";
```

作者调用 `defineReport()` 定义站点，调用 `defineComponent()` 定义组合组件或呈现原语。Page 和组合组件在构建期间得到
Host 签发的 Sample。它们可调用 `aggregate()`、`rollup()` 和 `to*` 投影，然后只把关闭值交给组件。

`defineReport(render)` 是单页简写。带 `pages` 的写法定义多个普通或参数化 Page。两种写法都在完整站点构建时获得同一
Sample，并归入同一个 ClosedSiteRevision。

```ts
type AuthorRenderable = ReportNode | ReportElement;

interface ReportDefinition {
  readonly title?: LocalizedText;
  readonly theme?: ThemeDefinition;
  readonly dimensionPins?: DimensionPins;
  readonly head?: readonly HeadTag[];
  readonly pages: readonly [PageDefinition, ...PageDefinition[]];
}

declare function defineReport(
  definition: ReportDefinition,
): Report;

declare function defineReport(
  render: (sample: Sample) => AuthorRenderable | Promise<AuthorRenderable>,
): Report;

type PageDefinition =
  | PlainPageDefinition
  | ParameterizedPageDefinition<JsonValue, unknown>;
```

`Report` 是 `defineReport()` 返回的验证后作者定义。`ReportDefinition` 与固定 Sample 是 Host 构建输入；它们不是
浏览器可读取的对象。

## Page

普通 Page 由一个 `render` 回调组成。省略 `path` 时，`report` Page 的路径为 `/`，其它 Page 的路径为 `/<id>`。
参数化 Page 必须给出 `params`、`load`、`render` 与 `navigation: false`。

```ts
interface PlainPageDefinition<Input = Sample> {
  readonly id: string;
  readonly path?: string;
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
  ) => AuthorRenderable | Promise<AuthorRenderable>;
}

interface ParameterizedPageDefinition<Params extends JsonValue, Input> {
  readonly id: string;
  readonly path?: string;
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
  ) => AuthorRenderable | Promise<AuthorRenderable>;
}
```

`enumerate(sample)` 是参数实例的唯一输入。每次站点构建对每个参数化 Page 调用一次，再构建全部返回实例。
`show --page`、`view --page`、HTTP 导航和浏览器刷新都不能跳过这个步骤，或为一个新 key 调用 `load`。

`encode` 产生一个规范的 key segment，`decode` 只接受同一规范。Host 对所有枚举值要求
`encode(decode(key)) === key`。重复 key、坏 key、抛出的回调和路径冲突都会使整个 revision 失败。

```tsx
const EvidenceSummary = defineComponent(
  ({ evidence }: { readonly evidence: PageEvidence }) =>
    <Table
      caption="Evidence"
      rows={evidence.entries.map(entry => ({
        attempt: entry.attempt.locator,
        state: entry.state,
      }))}
    />,
);

export default defineReport({
  title: "Experiment report",
  pages: [
    {
      id: "overview",
      title: "Overview",
      render: async sample => {
        const rows = await aggregate(sample, {
          by: { model },
          values: { passRate },
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
      load: async (_sample, params, context) =>
        await context.evidence(params.locator),
      render: evidence => <EvidenceSummary evidence={evidence} />,
    },
  ],
});
```

`PageLoadContext.evidence(locator)` 只在构建期按 canonical locator 交出已关闭的 Evidence。它验证 locator 属于当前
Sample，却不提供 Record reader、source root、任意路径或浏览器端请求能力。

## Sample 与关闭的输入

Sample 表示固定 selection 和只在当前构建中可用的受限读取能力。作者不能构造它、改变它的 Record root、把它保存到
构建外，或用它改变总体和分母。

```ts
const rows = await aggregate(sample, {
  by: { model },
  values: { passRate },
});
```

上例的 `rows` 是 ClosedRows。它有稳定 row identity 与全局 issues；每行的 `passRate` 是完整 MetricValue。
普通外部数组可交给中立组件，但不会自动获得 Evidence navigation、分母或问题语义。

复杂数值由 `rollup()` 交出；Attempt、Trace、Source 和文件差异等领域内容由 `to*` 投影交出。它们必须在 Page
构建时关闭。作者不能把未完成读取、Promise、Stream、callback、reader 或原始 Record payload 交给组件。

## MetricValue

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

`value` 是 number 或 `null`。`samples` 是实际贡献数，`total` 是该分组坐标的固定分母。合法零值保持
`value: 0`；它不是 `empty`。`partial` 可以有 `value: null`，但只能表示分母成员缺失且没有贡献值。

| state | value | 必须保留的含义 |
|---|---|---|
| `available` | number | 所有预期成员按该度量规则贡献。 |
| `partial` | number 或 null | 部分成员贡献，issues 说明缺口。 |
| `empty` | null | 输入完整，领域结果合法为空。 |
| `unsupported` | null | Host 缺少所需 Analysis 输入。 |
| `failed` | null | 读取或归并失败，issues 保留身份与引用。 |

显示组件不得只取 `value`。它们保留 state、samples、total、issues 和 refs。排序、筛选与 limit 只改变可见项，
不能重算 MetricValue 或缩小 total。

## defineComponent()

`defineComponent()` 有两种作者形态。组合组件可异步取得关闭数据，再组合已有组件。它得到的 context 同时有
`sample` 和同值兼容别名 `scope`。

```tsx
const Leaderboard = defineComponent(async (_props, { sample }) => {
  const rows = await aggregate(sample, {
    by: { model },
    values: { passRate },
  });

  return (
    <Grid>
      <Bars points={rows} x="model" y="passRate" />
      <Table rows={rows} />
    </Grid>
  );
});
```

新显示原语定义 text 与 web 两面。可选的 `resolve()` 只在构建期求值一次；`text()` 与 `web()` 同步读取同一个关闭值。
它们不能从浏览器请求数据或各自重新计算。

```ts
interface ComponentFaces<Props extends object, Data = Props> {
  readonly resolve?: (
    props: Props,
    context: AuthorResolveContext,
  ) => Data | Promise<Data>;
  readonly text: (data: Data, context: TextContext) => TextFaceNode;
  readonly web: (data: Data, context: WebContext) => WebFaceNode;
}

declare function defineComponent<Props extends object, Data = Props>(
  faces: ComponentFaces<Props, Data>,
): ReportComponent<Props>;
```

Page 和组件可返回受支持的 JSX/React element。Host 在 Sample 仍可用时解释 element，再把它关闭为站点页面内容。
DOM handle、任意 HTML、event handler 与浏览器副作用不进入 ClosedSiteRevision。

## 中立组件与下载

| 组件 | 唯一数据入口 | 不做什么 |
|---|---|---|
| `Table` | `rows` | 不读取 Analysis 或重新归并。 |
| `Bars`、`Line`、`Scatter` | `points` | 不改变 MetricValue 或分母。 |
| `Stat` | 完整 `value` | 不把 `value` 拆成未包装 number。 |
| `Grid`、`Stack`、`Callout`、`Text` | children 或普通文本 | 不引入读取能力。 |

图形必须在关闭页面内容中保留文字或表格等价信息。颜色、hover 与交互只能增强这些已有内容。

Download 接收构建期已经得到的 bytes：

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

Host 把这些 bytes 放进 ClosedSiteRevision，并对 route、下载、静态文件与 manifest 使用同一个冲突集合。下载不会在
HTTP 请求或静态导出时再次计算。

## head 与 Style

`ReportShell.head` 只声明结构化、非执行 metadata。`<Style>` 只声明 inline CSS。本地静态文件必须在构建期写入
ClosedSiteRevision。

inline 或 external executable script、功能性网络依赖、动态 CSS 读取与任意 HTML 都被拒绝。组件 props、下载、rows、
领域视图和 JSON 不能注入 head、style 或可执行内容。

## Host 边界与失败

Host 的构建边界是：

```text
ReportDefinition + fixed Sample
          │
          ▼
buildSiteRevision()
          │
          ▼
ClosedSiteRevision
```

普通作者不调用这条 API。CLI 和高级 Host 在完成 selection 后调用它；show、JSON、view 和静态导出只消费结果的不同投影。

构建前校验 id、路径与 Page 形状。构建中校验参数 key、关闭页面内容、链接、下载、HTML、静态文件、全站冲突和固定限额。
Analysis issue 留在可见数据中。任何作者回调、枚举、页面关闭或全站校验错误都阻止 revision 形成。

## 固定限额与缓存

每次站点构建最多包含 20,000 个 Page、每页 20,000 个文档节点、每页 32 层深度、1,000 个下载和单个
33,554,432-byte 下载文件。

页面级缓存只能保存完全关闭的页面值。若 Host 使用它，key 必须包含 Sample、Report、renderer、Page 与 params identity。
缓存不能改变 Evidence、分母、issues、最终 bytes 或 revision identity。

## 相关阅读

- [Reports README](README.md)：SSG-first 心智与四个入口。
- [数值与显示语义](calculations.md)：MetricValue、分母与显示边界。
- [Architecture](architecture.md)：全站 builder、revision 与发布不变量。
- [CLI](cli.md)：用户命令的构建与投影。
