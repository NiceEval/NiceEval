# Capture → Analysis → Report 设计地图

这是一张跨决策地图，不是新的产品层。已经定稿的公共契约见
[Capture → Analysis → Report Roadmap](../roadmap/record-analysis-report/README.md)；本页只说明公共三层怎样落到内部 seam。

## 对外只有三层

```text
Capture                         Analysis                         Report
定义并提交 Metric/Score/Artifact  定义 Dimension/Measure/Relation  用 aggregate 取 closed rows 并呈现
```

普通插件作者不接触 Record，Report 作者也不接触 Projection、reader 或 migration。Record 是 NiceEval 的内部持久化边界；
Sample、Projection 与 Relations 是 Analysis 执行所依赖的内部 correctness seams，不是第四、第五套用户 SDK。

## 内部依赖方向

```text
Capture definitions + registered producer
  ↓ total obligations（available / unavailable / failed / unsealed）
fixed Metric / Score / Artifact envelopes
  ↓ platform-owned Record writer + adjacent converters
Record snapshot + frozen Sample population
  ↓ internal Projection + Relations
Analysis fields（Dimension / Measure / Relation）
  ↓ await aggregate(reportSample, request)
closed typed rows（MetricValue / issues / refs / stable row key）
  ↓ Bars / Table / Scatter / semantic components
closed semantic tree
  ↓ terminal / Web / static hosts
```

这条方向不可反转：Report 不能读取 Record；Analysis 不能写事实；Capture 不能决定聚合口径或展示形状。

## 每层屏蔽什么

| 公共层 | 作者看到 | 被屏蔽的细节 |
|---|---|---|
| Capture | `defineMetric` / `defineScore` / `defineArtifact`、producer、typed token、`seal` | Record package、owner layout、lock、cache、generation、编码与迁移 |
| Analysis | `Dimension` / `Measure` / `Relation`、三段 reduction、`MetricValue`、`analyze` | Attachment traversal、slot join、decoder、snapshot lease |
| Report | 受限 `ReportSample`、`await aggregate()`、closed rows、语义组件 | Projection manifest、Calculation registration、branded ids、Record reader、renderer 差异 |

## 内部设计决策

| seam | 采用的设计 | 对公共 API 的影响 |
|---|---|---|
| Record runtime | [PLAN-2](record-runtime/PLAN-2/README.md) | 单 root authority、generation 与 verified cache 全部留在 host 内 |
| durable layout | [PLAN-1](observability-package-layout/PLAN-1/README.md) | 平台固定 Metric/Score/Artifact envelopes，并拥有 converter 链 |
| Projection | [PLAN-1](projection-api/PLAN-1/README.md) | direct projection 只供 Analysis/host 实现；Report 不获得 projection handle |
| Relations | [PLAN-1](relations-api/PLAN-1/README.md) | 跨包关系先形成 closed、穷尽的 Analysis value |
| Report | [PLAN-7](report-authoring/PLAN-7/README.md) | callback 只拿受限 sample；每次 `aggregate` 编译运行时局部 field DAG |

这些方案的组合不是把五层都公开。它们分别守住存储、读取、关系与执行正确性，最后折叠成三套按角色划分的作者 API。

## 为什么 Report 选择运行时局部 DAG

Report 作者需要依据已经得到的 rows 决定后续显示或取数，因此保留普通 async callback：

```tsx
const overview = definePage({
  id: "overview",
  route: "/",
  render: async ({ sample }) => {
    const rows = await aggregate(sample, {
      by: { agent },
      values: { passRate, costUSD },
    });

    return <Bars rows={rows} x="agent" y="passRate" />;
  },
});
```

每次 `aggregate` 只为本次请求编译有限 field DAG，并在同一 execution 内按 exact field identity memoize。callback 返回后，
host 才冻结 semantic tree。这样保留 0.12.1 的业务 DX，同时守住 population、denominator、evidence、requested-page
isolation 与多 renderer 同义；放弃的是 callback 执行前预编译整份 Report 的所有依赖。

## Attempt detail 的 owner routing

1. Sample 用 Record Core 选择 logical slots，并绑定 exact Attempt 与 origin Run。
2. 内部 Projection 解码 Metric、Score、Artifact 与官方运行事实。
3. Relations 用 durable anchors 对齐 assertion、operation、source site 与 artifact；没有 anchor 就保留 unmatched。
4. Analysis field 形成带 coverage、issues 与 refs 的 closed rows。
5. 参数化 Page 用稳定 row key 与 refs 形成详情 route；官方与用户 Report 都不取得私有 reader。

## 扩展归属

| 想扩展什么 | 应该做什么 | 不应该做什么 |
|---|---|---|
| 新的数值或状态事实 | 定义 Metric 或 Score，并注册 Capture producer | 自定义 Record Attachment schema |
| 大文本、diff、trace、SQL query/result | 定义 Artifact；需要数值判分时另定义 Score/Metric | 把任意 JSON 塞入 Metric attributes |
| 新分组、公式或跨事实关系 | 增加 Analysis Dimension / Measure / Relation | 在 Report 里手写 Record join 与 denominator |
| 新表格、图表或详情页 | 组合 `aggregate` 与既有 semantic components | 在 renderer 中重新查询数据 |
| 新 host primitive | 修改 NiceEval core，并同时定义 terminal、Web 与 static face | 由普通插件注册带任意执行权限的 renderer |

## 演进与迁移

定义兼容演进保持相同 definition identity；语义变化创建新的 Metric/Score/Artifact id。持久化 schema 的 converter 由平台随版本
发布，并且只能相邻、纯函数、确定性地转换。打开 snapshot 时必须先完成完整 converter 链；缺步、歧义、校验失败或未知新版本一律
fail closed。应用配置不安装 converter，也不执行历史第三方代码。
