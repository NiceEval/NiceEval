# Capture → Analysis → Report

NiceEval 允许用户代码产生事实、定义比较口径并构建报告。普通作者不需要理解 Record schema、projection、lock、cache 或
migration converter。

本方向把公共心智固定为三层：

```text
Capture                         Analysis                         Report
这次运行发生了什么               这些事实怎样比较                  怎样让人看懂

领域 Plugin / typed Capture  →  Dimension / Measure / relation  →  aggregate + Table / Bars / Scatter
               │
               └──── 内部 Record：保存 frozen facts，由 niceeval migrate 升级平台表示
```

Record 是三层共用的内部 substrate，不是第四个作者层。用户不会取得 Record writer、schema family、converter、installation
或 raw projection。

## 每层的责任

| 层 | 作者决定什么 | 公开对象 | 平台屏蔽什么 |
|---|---|---|---|
| Capture | 事实 identity、producer、值或状态、有限 labels、Evidence refs | 领域 Plugin、`MetricDefinition`、`ScoreDefinition`、`ArtifactDefinition`、Capture token | Record owner、writer、schema version、blob path、lock、cache、migration |
| Analysis | population、denominator、missing、rollup、producer compatibility、refs | `Dimension`、`Measure`、`AnalysisRelation`、`analyze()` | Record I/O、decode、跨版本读取、renderer |
| Report | 分组、显示排序、布局、图形、页面和下钻 | `ReportSample`、`aggregate()`、Page、Table、Bars、Scatter | raw facts、projection、migration、terminal / Web 差异 |

三层是依赖方向，不是三类人。领域 SDK 作者可以同时发布 Capture 与 Analysis API；普通 Eval 作者只使用领域 Plugin；Report 作者
只 import Analysis fields。

## 固定事实信封

第三方只扩展三种固定信封：

| 信封 | 用途 | 可进入 Analysis 的部分 | 不允许的部分 |
|---|---|---|---|
| Metric | 延迟、能耗、价格、大小等 finite scalar | value、unit、预声明 enum labels、状态、uncertainty、producer、refs | timestamp、step、动态 key、嵌套 payload |
| Score | evaluator 的数值、布尔或分类判分 | 预声明 rubric、状态、producer、Evidence refs | 动态 rubric、自由可查询 metadata、向旧 Attempt 追加 |
| Artifact | 日志、图片、表格、SQL rows 与大 JSON | identity、media type、refs | 自动把内容字段变成 Dimension 或 Measure |

OTel Timing、Assertion / Evidence、File Diff、Conversation 与 Usage 是 NiceEval 官方固定事实。它们和第三方信封共用内部提交、
快照、读取和迁移机制，但普通用户看见各自领域 API，不看见 Record。

## 为什么收口在固定信封

[Record → Report 外部产品研究](../../research/record-to-report/README.md)显示，Langfuse、MLflow、W&B、Phoenix 与
ClearML 都由平台拥有少量稳定写入外壳与存储迁移；用户扩展名字、值、Score、Artifact 或显示配置。研究没有找到要求 application
安装第三方 durable schema、相邻 converter 与 projection 才能写入普通自定义事实的成熟公共先例。

NiceEval 不照搬它们的任意 key-value 面：typed definition、frozen Sample、denominator、missing、Evidence refs 与 closed output
继续保留。收口的是持久化扩展权，不是用户增加 Metric、Score、Artifact、Analysis field 或 Report component 的能力。具体比较与
被否决的复杂度见 [API 候选存档](reference/api-candidate.md)。

## 最短的用户路径

普通 Eval 作者选择 Plugin：

```ts
export default defineEval({
  plugins: [
    otelTiming(),
    gpuEnergy({ meter: nvmlEnergyMeter({ device: 0 }) }),
  ],

  async test(t) {
    await t.send("完成任务");
  },
});
```

Analysis package 发布可复用 fields：

```ts
export const gpuEnergyJoules = metricMeasure(gpuEnergyMetric, {
  producers: requireSameProducer(),
  withinAttempt: sum(),
  withinEval: mean(),
  acrossEvals: mean(),
  denominator: allLogicalSlots(),
  missing: partial(),
});
```

Report 作者用接近 0.12.1 的调用形状：

```tsx
const rows = await aggregate(sample, {
  by: { condition, memory },
  values: { passRate, duration, gpuEnergyJoules },
});

return (
  <Bars
    points={rows}
    x="condition"
    y="gpuEnergyJoules"
    color="memory"
    layout="horizontal"
  />
);
```

## 扩展边界

| 用户目标 | 扩展单位 | 不需要扩张什么 |
|---|---|---|
| 增加一种数值或判分 | `defineMetric()` / `defineScore()` 与 Capture token | RecordAttachment schema family |
| 保存复杂材料 | `defineArtifact()` 或官方 Evidence | 可查询 JSON schema |
| 增加指标或分组 | Dimension、Measure、AnalysisRelation | Report 内 raw query |
| 增加图表或页面 | `aggregate()` 与闭合 semantic components | renderer plugin 或 Record reader |
| 升级旧数据 | `niceeval migrate` | 用户 converter 或 executable installation |

结构化第三方 tool event、用户关系对象、Artifact 内容字段查询与 post-hoc 持久判分不进入该公共面。只有两个独立真实领域 SDK，
或一个核心 dogfood 场景，无法在不损失原子性、关系或查询语义的情况下映射到固定信封，并且新增官方信封也不合理时，才重新设计
受限 advanced SPI。

## 选定的 Design PLAN

| 决策 | 采用 | 保证 |
|---|---|---|
| [Record access runtime](../../design/record-runtime/DECISION.md) | PLAN-2 | 同一 root 的资源 owner、generation 与 verified cache 统一 |
| [Projection API](../../design/projection-api/DECISION.md) | PLAN-1 | projection 只留在 Analysis host 与领域 SDK 内部 |
| [Relations API](../../design/relations-api/DECISION.md) | PLAN-1 | package-owned relation 与穷尽 population |
| [Report authoring](../../design/report-authoring/DECISION.md) | PLAN-7 | 受限 `ReportSample`、运行时局部 field DAG、单次 callback 与 0.12.1 风格组件 |

## 范围

本方向包含：

- Metric、Score 与 Artifact 的 typed definition、producer identity 与 total Capture obligation；
- 官方 OTel Timing、Assertion / Evidence 与 File Diff 的同形内部路径；
- Analysis population、Dimension、Measure、relation、三段 rollup 与 `MetricValue`；
- `ReportSample`、`aggregate()`、Page / PageFamily 与闭合 semantic components；
- terminal、Web 与 static 共用的 `ReportExecution`；
- 平台拥有的显式 `niceeval migrate` 与 fail-closed publication。

本方向不增加公共 `record()`、任意 event log、用户 Record schema、用户 converter、全程序 Analysis graph、Report raw query 或
renderer plugin。

## 入口

- [Library](library.md) —— 三层公开 API、类型、状态与错误。
- [Architecture](architecture.md) —— 依赖方向、内部 Record 边界、identity 与执行不变量。
- [Authoring](authoring.md) —— 五类角色怎样自定义、添加与扩展。
- [Lifecycle](lifecycle.md) —— Capture、Analysis、Report 与 migration 的完整时序。
- [CLI](cli.md) —— `show`、`view`、静态导出和 `niceeval migrate`。
- [Use Case](use-case/README.md) —— 官方能力与第三方扩展的完整可抄路径。

## 子方向

- [成本投影](analysis/cost/README.md) —— 以具内容身份的价格表形成 Analysis Calculation，不改写 Record 中的观测事实。
- [Chart 语义内核](report/chart-kernel/README.md) —— 统一终端与 HTML 的图表语义、精确值、键盘焦点和 Table 渐进增强。
