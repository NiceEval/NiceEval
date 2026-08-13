# Eval 平台从运行写入到报告呈现的作者面

> 观察日期：2026-08-13
>
> 观察对象：Langfuse、MLflow、Weights & Biases、Arize Phoenix 与 ClearML
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

本目录研究一类完整产品：应用或实验由用户代码实际运行，运行时 SDK 保存事实，随后由同一产品查询、比较并呈现结果。
外接 SQL 后再画图的 BI 工具不在本轮范围内。

五个项目都具有大规模公开采用信号。观察日附近的 GitHub 页面显示：
[Langfuse](https://github.com/langfuse/langfuse) 约 29.1k、[MLflow](https://github.com/mlflow/mlflow) 约 26.5k、
[W&B](https://github.com/wandb/wandb) 约 11.1k、[Phoenix](https://github.com/Arize-ai/phoenix) 约 10.1k、
[ClearML](https://github.com/clearml/clearml) 约 6.7k stars。star 只用于筛选成熟样本，不作为 API 正确性的证据。

## 共同研究问题

每份研究使用相同的场景和问题，避免只按各家营销分类复述功能。

1. 一次 Run、Trace、Task 或 Experiment 怎样开始、封口并形成稳定身份。
2. 官方 Timing、Usage、Score、Evidence、Artifact 等事实怎样写入。
3. 用户能否增加自定义事实；扩展的是名字和值、固定 envelope、任意属性，还是版本化 schema。
4. 写入 API 是否要求用户预先决定图表，或只保存中立事实。
5. 读取与分析怎样选择 Run、固定分母、分组、聚合，并处理 missing、partial 与 unsupported。
6. 图表、Dashboard 与 Report 怎样消费分析结果；作者使用代码、UI，还是两者共用的声明。
7. 历史数据怎样面对 SDK、schema 与产品升级；谁声明 migration，何时重写持久数据。
8. 普通应用作者、扩展作者、分析作者和报告作者分别需要理解多少层。

每份研究还用四个 NiceEval 场景检验完整路径：官方 OTel Timing、用户 GPU Energy、Assertion 与 Evidence、旧数据升级后重新分析和报告。

## “可扩展”的四种不同承诺

本研究不把 arbitrary JSON、custom metric、custom chart 和 custom schema 统称为可扩展。每个产品分别判断以下四级能力：

| 能力 | 用户实际得到什么 | 仍未得到什么 |
|---|---|---|
| 保存 | 可写入一个新名字或 opaque payload | 不保证能筛选、聚合或迁移 |
| 分析 | 可把新值当作 Metric、Score 或 Dimension 查询 | 不保证能形成新视觉形状 |
| 呈现 | 可组合图表、Dashboard 或 Report | 不代表能增加持久化类型 |
| schema | 可定义新的 durable 类型与历史 converter | 需要承担 identity、兼容性与 migration 成本 |

只有产品明确提供最后一级公开契约时，正文才称它支持用户自定义持久 schema。固定 envelope 内增加名字、标签和值不算新增 schema。

## 独立研究

- [Langfuse](langfuse.md)
- [MLflow](mlflow.md)
- [Weights & Biases](wandb.md)
- [Arize Phoenix](phoenix.md)
- [ClearML](clearml.md)

## 横向判断

比较只采用各页已经引用的一手材料。各产品页中的 NiceEval 建议代表研究者当时的推论，不自动成为本页研究判断。

### 五家共同把扩展放在哪里

| 产品 | 用户写入的稳定外壳 | 用户真正扩展的单位 | 默认是否绑定图表 | 分析与报告 | migration 的主人 |
|---|---|---|---|---|---|
| Langfuse | observation、score、media | 名字、值、metadata、封闭 observation type | 否 | Metrics 查询加 Dashboard UI | Langfuse 迁数据库、API 与历史宽表 |
| MLflow | param、metric、tag、artifact、assessment | 名字、值、固定 assessment 信封 | 否 | `search_runs`、DataFrame 与 Tracking UI | MLflow 用 Alembic 迁 Tracking Store |
| W&B | Run 的 config、history、summary、Table、Artifact | 键、值、类型化对象 | 否；`define_metric` 与 `plot_table` 可选绑定 | Public API、Workspace 与 Report | W&B 升 SDK 与服务端；用户不写事实 converter |
| Phoenix | span、annotation、dataset example | 约定键、值、任意 OTel 属性、固定 annotation 信封 | 否；span kind 影响预置展示 | Filter、`SpanQuery`、Compare 与预置 Dashboard | Phoenix 迁服务端表与 Client 入口 |
| ClearML | Task、五类 event、parameter、configuration、artifact | title、series、值与固定 event type | 是，Logger 调用直接选择 UI 页签和图 | Task 读取、Compare、Markdown Report | ClearML 迁 Mongo、Elasticsearch 与 API 版本 |

五家都允许用户写新内容，却没有一家要求用户先定义一套 durable payload schema、相邻 converter、installation trust 与
projection，再让普通写入生效。共同模型是：**平台拥有少量稳定外壳，用户在外壳里增加名字和值；平台拥有存储迁移。**

这是支持 NiceEval 在 beta 收缩公共面的产品证据，不是「schema SPI 永远没有价值」的理论证明。五家涉及的主流场景本来就可能
遗漏需要一等关系或结构化查询的新领域；因此本研究同时给出恢复 advanced SPI 讨论的具体验证门槛，而不是永久封死方向。

这不是说任意 key-value 已经足够。五家也共同暴露了它的代价：字符串拼错不会尽早失败，缺值常被当成 `NaN`、`None` 或空集合，
分析作者自己决定分母，Report 往往直接查询原始事实。NiceEval 已有的 fixed Sample、coverage、evidence refs 与 closed
semantic output 仍值得保留。

### 没有证据支持的复杂度

本轮没有找到以下公共产品先例：

- 第三方 SDK 为每种自定义事实发布 durable schema family。
- application 在配置里安装这类 family 的可信 executable capability。
- 用户为每条相邻 schema 边提供历史 converter。
- Report 为了读取一个自定义数值而理解 adapter、projection 或 migration graph。

因此，五份研究不能为当前「任意第三方 durable schema」的复杂度背书。它们更支持一个较窄、也更容易解释的扩展承诺：

1. NiceEval 定义固定、可迁移的事实种类。
2. 用户可以定义新的 Metric 或 Score 名字，并写入这些固定信封。
3. 用户可以附加 Artifact，但 Artifact 默认不成为可查询 schema。
4. 新的一等事实种类由 NiceEval 产品演进增加，不由每个应用临时扩张持久层。

该候选明确不承诺结构化第三方 tool event、用户关系对象、Artifact 内容字段查询或向旧 Attempt 追加 post-hoc Score。只有两个
独立真实领域 SDK，或一个核心 dogfood 场景，无法在不损失原子性、关系或查询语义的情况下映射到固定信封，并且新增一个官方
信封也不合理时，才根据这个具体反例重新设计受限 advanced SPI。

### migration 应该迁什么

外部产品的共同做法是平台迁自己的 store，而不是让使用者迁每个 metric 名字。NiceEval 可以保留显式
`niceeval migrate`，但缩小它的职责：

- NiceEval 维护 Record Core 与固定事实信封的 converter。
- CLI 先展示计划，用户确认后迁移；普通读取不静默改写历史。
- 用户定义的 Metric / Score identity 一旦发布就保持原义。
- 改单位、值域或事实含义时发布新 identity；不要用 migration 把旧事实重新解释成新事实。
- 显示名、格式和 Report 布局不属于持久事实，不触发 migration。

这把「存储表示升级」与「领域含义改变」分开。前者由平台迁移，后者由新的定义与显式 Analysis 关系表达。

### 对 NiceEval 的初步判断

用户心智只需要三层，Record 留作内部 substrate：

```text
Capture   发生了什么：领域 API 或固定事实定义
    ↓
Analysis  怎样计算：population、denominator、missing、coverage、evidence
    ↓
Report    怎样呈现：aggregate、Table、Bars、Scatter、Page

内部：Record 保存事实并由 niceeval migrate 升级，不进入作者 import surface
```

扩展作者不是第四层。他只是同时在 Capture 发布一个受限定义，并在 Analysis 发布相应 field。普通 Eval 作者只调用领域 API；
Report 作者只 import field，不知道事实怎样落盘。

详细候选语法、Report 不可能三角的取舍与四个场景见 [API 候选](api-candidate.md)。候选已经经过一次独立设计挑战并吸收其有限
条件，仍须由用户裁决后才能改写 Roadmap。
