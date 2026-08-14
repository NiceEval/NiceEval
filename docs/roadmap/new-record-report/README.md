# Record → Analysis → Report 分层架构

NiceEval 把运行事实、分析口径、呈现数据、报告组合与最终交付分开。普通用户只需要理解 Record、Analysis 与 Report，平台内部再把 Analysis 和 Report 拆成可独立演进的层。

```text
┌──────────────────────────────────────────────────────────────┐
│ ⑦ 使用与交付                                                │
│ niceeval show / view / view --out                           │
└──────────────────────────────▲───────────────────────────────┘
                               │ Closed Report Tree
┌──────────────────────────────┴───────────────────────────────┐
│ ⑥ Report 组合                                               │
│ Query + Page + 中立组件 + 官方领域组件                       │
└──────────────────────────────▲───────────────────────────────┘
                               │ Semantic Nodes
┌──────────────────────────────┴───────────────────────────────┐
│ ⑤ 组件                                                      │
│ Table / Bars / Scatter │ Trace / Attempt / Experiment       │
└──────────────────────────────▲───────────────────────────────┘
                               │
┌──────────────────────────────┴───────────────────────────────┐
│ ④ 呈现模型                                                  │
│ SemanticFrame           │ Closed DomainView                 │
└──────────────────────────────▲───────────────────────────────┘
                               │
┌──────────────────────────────┴───────────────────────────────┐
│ ③ Analysis 执行                                             │
│ QueryPlan → TypeScript Executor → 可选内部加速器             │
└──────────────────────────────▲───────────────────────────────┘
                               │ QueryPlan
┌──────────────────────────────┴───────────────────────────────┐
│ ② Analysis 语义                                             │
│ Population / Dimension / Measure / Relation / Reduction     │
└──────────────────────────────▲───────────────────────────────┘
                               │ Current Record
┌──────────────────────────────┴───────────────────────────────┐
│ ① Record                                                    │
│ 当前唯一 Schema / Capture / Storage / Validation / Migrate  │
└──────────────────────────────────────────────────────────────┘
```

## 三个公共心智

```text
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ Record         │ →  │ Analysis       │ →  │ Report         │
│ 发生了什么     │    │ 应该怎样计算   │    │ 怎样让人看懂   │
└────────────────┘    └────────────────┘    └────────────────┘
```

Record 是运行时追加、完成后封口的事实账本。Analysis 是 population、分母、缺测、重试归并与 Evidence 的统计口径合同。Report 是在 frozen Sample 上执行一次的报告配方，完成后只留下闭合语义树。

七层是内部责任边界，不要求普通用户逐层理解。每层只回答一个问题，并向上一层提供闭合 API。

| 层 | 心智模型 | 只回答的问题 | 契约入口 |
|---|---|---|---|
| ① Record | 事实账本 | 实际发生了什么，旧格式怎样升级为当前格式 | [Record](record.md) |
| ② Analysis 语义 | 统计口径合同 | 事实应当怎样进入总体、分母与归并 | [Analysis 语义](analysis-semantics.md) |
| ③ Analysis 执行 | 计算机器 | 已定义的口径怎样稳定执行 | [Analysis 执行](analysis-execution.md) |
| ④ 呈现模型 | 闭合结果包 | 组件需要什么完整数据 | [呈现模型](presentation-models.md) |
| ⑤ 组件 | 展示镜头与诊断仪器 | 一份闭合结果怎样被观察 | [组件](components.md) |
| ⑥ Report | 可执行报告配方 | 查询、页面与组件怎样组合 | [Report](report.md) |
| ⑦ 使用与交付 | 同一报告的出口 | 用户怎样在终端、Web 与静态站查看 | [使用与交付](delivery.md) |

## 两条呈现路径

Analysis 不把所有数据压成一张表。中立组件与官方领域组件共享同一个 frozen Sample 和 Evidence identity，但消费不同的闭合模型。

```text
Current Record
      ↓
Analysis semantic kernel
      ├─ typed query ─────────→ SemanticFrame ─→ Table / Bars / Scatter
      │
      └─ domain projection ───→ DomainView ────→ Trace / Attempt / Experiment
```

`SemanticFrame` 是带 population、状态、分母、问题与 Evidence refs 的分析结果。`DomainView` 保留树、时序、身份和复核路径，不能为了复用图表组件而退化成平表。

## Migration 边界

平台只维护一个当前 Record schema。普通读取不把旧版本解释成当前对象，也不把版本联合传入 Analysis。

```text
Old Record ── niceeval migrate ──→ Current Record ──→ Analysis
```

旧版本解码、相邻 converter、staging 验证与原子发布全部属于 Record 层。`show`、`view` 与 Report execution 遇到旧版本时返回 `migration-required`，不静默改盘。

新增 Query、Measure、组件、Page 或 renderer 不能推动 Record schema 升版。只有无法从已有事实恢复的新事实，或已有持久语义无法正确表达时，Record 才能增加 migration。

## SQL 与执行后端

SQL 不是 Record 与 Report 之间的公共层。Report 作者只能提交 typed Analysis query，不能查询 Record 物理表。

```text
Typed Query → QueryPlan → TypeScript Executor
                         └→ 可选内部 DuckDB Executor
```

DuckDB 只有在真实 workload 证明 Analysis 执行成为瓶颈，并通过完整结果差分验证后，才能成为内部 executor。差分必须逐项比较 value、state、observed、denominator、issues、refs 与 producer compatibility，不能只比较 scalar。

探索性 SQL 若以后出现，只查询版本化逻辑 catalog，并返回与 `MetricValue` 不兼容的 `ExploratoryRows`。它不能进入官方 Metric、Comparison 或可复核 Report 路径。

## 依赖规则

```text
Delivery
   ↓
Report
   ↓
Components
   ↓
Presentation Models
   ↓
Analysis Execution
   ↓
Analysis Semantics
   ↓
Record
```

依赖只能向下：

- Record 不知道 Analysis field、组件或页面。
- Analysis 语义不选择执行引擎，也不生成展示节点。
- executor 不知道 Table、TraceViewer 或 renderer。
- 组件不打开 Record，也不重新聚合 `MetricValue`。
- Report 不枚举 raw Run、Attempt 或 Event，不改变 nominal population。
- renderer 不执行 Query，只消费同一次 execution 产生的闭合语义树。
- migration authority 不进入 Analysis、Report 或 application package。

## API 面

| 面向对象 | 入口 | 能力 |
|---|---|---|
| 普通 Eval 作者 | `niceeval`、领域 Plugin | 运行 Eval 并产生 typed facts |
| Analysis 作者 | `niceeval/analysis` | 定义 Population、Dimension、Measure、Relation，调用 `analyze()` |
| Report 作者 | `niceeval/report` | 使用 `ReportSample`、`aggregate()`、Page 与组件 |
| 普通用户 | `niceeval show`、`niceeval view` | 查找、查看、比较与导出结果 |
| 平台 host | 内部 capability | Record 写入、migration、Analysis executor、领域投影与 renderer |

Record schema、migration converter、执行引擎和 renderer capability 都不属于 application API。

## 全局不变量

1. Analysis 只接收当前 Record schema，不接收历史版本联合。
2. Record 只保存不可重新计算的事实，不保存 Report 派生结果。
3. Analysis 独占 population、denominator、missing 与 reduction 语义。
4. scalar 丢失状态、分母或 refs 后，不能重新包装成 `MetricValue`。
5. 中立组件消费 `SemanticFrame`，官方领域组件消费闭合 `DomainView`。
6. Report 作者只组合 Analysis fields、closed rows、opaque refs 与 semantic components。
7. terminal、Web 与 static renderer 消费同一棵闭合语义树。
8. 新查询和新组件不会要求 Record migration。
