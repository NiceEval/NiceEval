# 外壳与多页

报告外壳只保留宿主必须在 page render 之外读取的声明。
页面内容、页脚、页头链接和团队署名都由普通 ReportNode 组成。

## 单页缩写

单页报告直接传 render 函数：

```tsx
export default defineReport(async (sample) => {
  const rows = toExperimentRows(sample);

  return (
    <Col>
      <Table rows={rows} />
    </Col>
  );
});
```

宿主把它规范化为 id 为 `report` 的 sample page。
函数在装载期不执行，只在该 page 被请求时执行。

## 多页形状

```ts
interface PageDefinition<P = void, I = Sample> {
  id: string;
  title: LocalizedText;
  navigation?: boolean;
  params?: PageParams<P>;
  load?: (
    base: Sample,
    params: P,
    ctx: PageLoadContext,
  ) => I | Promise<I>;
  render: PageRender<I>;
}

interface ReportOptions {
  title?: LocalizedText;
  theme?: ThemeDefinition;
  dimensionPins?: DimensionPins;
  head?: HeadTag[];
  pages: readonly [
    PageDefinition,
    ...PageDefinition[],
  ];
}
```

`pages` 是非空有序数组，数组顺序就是导航顺序。
 page id 必须唯一；数字样式的 id 仍按数组位置导航，不做数值排序。
声明 `params` 的页必须同时声明 `load` 且 `navigation: false`；page 的完整形状见 [Library](../library.md#defineReport-保留静态-page-边界)。

## 完整示例

```tsx
export default defineReport({
  title: "Security evals",
  pages: [
    {
      id: "overview",
      title: "Overview",
      render: async (sample) => {
        const performance = await aggregate(sample, {
          by: { agent },
          values: { passRate, costUSD },
        });

        return (
          <Col>
            <Scatter
              points={performance}
              x="costUSD"
              y="passRate"
              point="agent"
            />
            <Table rows={performance} />
          </Col>
        );
      },
    },
    standardAttemptPage,
  ],
});
```

装载期只校验外壳与 page 清单，不执行 render。
宿主只执行被请求的 page 实例；同一个实例的 text 与 web 面读取同一棵结果树。

## 外壳字段穷尽

| 字段 | 宿主必须提前读取的原因 |
|---|---|
| `title` | 浏览器 `<title>` 与 show 页索引标题 |
| `theme` | 主题有独立装载链，`--theme` 可整份替换 |
| `dimensionPins` | 页级槽位分配要在装载期读到固定声明 |
| `head` | 文档 `<head>` 不在报告树中 |
| `pages` | 路由、导航、按页求值与失败隔离 |

除此之外没有外壳槽位。
页脚与页头链接使用普通函数包裹每个 render；组件脚本样式随 renderer 的 `assets`；站点级字体、SEO 和埋点才进入 `head`。

## `head`

`head` 只接受白名单内的静态标签与属性。
本地脚本、样式和图片路径相对报告定义文件解析，进入静态站时按内容哈希物化。
远程脚本必须显式写完整 URL，并受发布策略与 CSP 校验。

初始报告不得依赖 `head` 脚本才可读。
站点注入只能增强宿主，不得重新取数或改写读数。

## `dimensionPins`

`dimensionPins` 把维度值钉在固定的视觉槽位上：

```ts
type DimensionPins = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;
```

外层键是维度名：内建维度用公开分组字段名，例如 `agent`、`experiment`；自定义分组用作者在 `aggregate().by` 对象里声明的键。
内层把完整维度值映射到 1–24 的槽位号，与主题令牌 `--niceeval-color-series-1..6` 同为一基：

```ts
dimensionPins: {
  agent: { codex: 1, "claude-code": 7 },
},
```

固定只影响呈现，不改变分组函数返回值、结果字段或 MetricValue。
固定的槽位号原样生效：两个值钉同一槽位，就是作者要它们同一身份。
装载期校验只看结构：槽位号非整数或越界、值键为空，按完整用户反馈拒绝，错误指到 `dimensionPins.<维度>.<值>`。
维度名不判未知——自定义分组键只在 page render 里出现，装载期不可能有全集；固定了从未出现的维度就是不生效。

未固定的值按页分配，规则单点声明在 [页级呈现分配](../components/README.md#维度呈现分配单位是页)：固定值全报告同身份，未固定值只保证页内自洽。
宿主在装载期读取固定声明，每一页因此能独立分配槽位，不执行其它 page。

## 跨页复用

跨页内容是普通高阶函数：

```tsx
const withFooter =
  (render: PageRender<Sample>): PageRender<Sample> =>
  async (sample) => (
    <Stack>
      {await render(sample)}
      {footerNote}
    </Stack>
  );
```

宿主不认识 footer、header 或 chrome。
内建报告也使用相同的普通组合方式。

## 相关阅读

- [Library](../library.md) —— `defineReport()` 的完整重载。
- [Architecture](../architecture.md) —— 多页惰性求值、缓存与失败隔离。
- [主题](theme.md) —— theme 的装载与分发。
