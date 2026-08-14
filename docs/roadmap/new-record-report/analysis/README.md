# Analysis（分析）

Analysis（分析）把冻结样本中的持久事实解释为可比较的统计读数和诊断视图。它从 Record（持久事实层）取得已经封口的数据，再向 Report（报告层）交付闭合结果。

Analysis 不写入 Record，也不组织页面或渲染输出。它独占总体、分母、缺失处理、归并、问题和 Evidence（证据）引用的统计口径。

## 心智模型

Analysis 的作者声明 Population（总体）、Dimension（维度）、Measure（度量）和 Relation（关系）。这些声明说明哪些成员可比较、怎样分组、怎样归并，以及哪些证据必须随读数保留。

一次 Query（查询）固定在一个 `AnalysisQuerySource`（分析查询句柄）上。它由 Analysis Host SDK（分析宿主开发工具包）从同一份冻结事实签发，并绑定当前 operation Scope（操作资源作用域）；它不能改变样本成员，也不能读取另一个 Record root。相同输入与相同字段声明因此总是使用同一组预期成员和分母。可显示的选择摘要另存为 `AnalysisSampleSummary`（分析样本摘要），不是第二种查询句柄。

```text
AnalysisQuerySource（唯一不透明查询句柄）
    ↓
Population / Dimension / Measure / Relation
    ↓
Query
    ↓
SemanticFrame 或 DomainView
```

## Query 与 View 子结构

Query 是作者提交的有限语义请求。它只描述总体、分组字段、度量或诊断目标，不携带 SQL、文件路径或 Record 读取能力。

View（视图）是查询的闭合输出形状。表格和比较任务得到 SemanticFrame（语义数据帧）；Trace、Attempt 和证据诊断得到 DomainView（领域视图）。

QueryPlan（查询计划）把声明编译为与执行后端无关的有限计算。AnalysisExecutor（Analysis 执行器）负责执行该计划，DuckDB（DuckDB 执行后端）只是在需要时替换内部计算方式。

这些内部对象不改变作者可见的总体、分母、缺失或证据口径。它们也不从 niceeval/analysis 导出。

## 输入与输出

| 边界 | 接收或交付的对象 | 约束 |
|---|---|---|
| 输入 | 当前 schema 的 AnalysisQuerySource | 句柄已经冻结且绑定 Scope；没有可读字段、Record root、写入会话或迁移权限 |
| 语义声明 | Population、Dimension、Measure、Relation | 每个字段有稳定 identity，并说明所属总体 |
| 表格输出 | SemanticFrame | 每个单元保留 value、state、observed、denominator、issues 和 refs |
| 诊断输出 | DomainView | 保留领域身份、树或时序、issues 和 refs，不压成通用表格 |

闭合输出不含 reader、Promise、回调、执行器或未解释的 Record 载荷。Report 只能使用这些结果组织页面，不能重新计算度量或缩小分母。

## 为什么不是六层

把 Query 和 View 提升为并列产品层，会得到 Record → Query → Analysis → View → Report 的五层图。这会把请求和输出误当成拥有独立事实、生命周期或用户入口的系统。

Query 由 Analysis 拥有，因为它固定的正是总体、分母和归并口径。View 也由 Analysis 拥有，因为它只是同一口径的表格或诊断结果。

QueryPlan、执行器和 DuckDB 更不能成为产品层。它们只替换计算机制，不拥有新的作者职责或公开数据边界。

三层因此保持清楚的责任方向：Record 保存发生过的事，Analysis 解释这些事，Report 组织并呈现可读报告。

## 入口

- [Library](library.md) —— niceeval/analysis 的公开声明、查询和闭合结果契约。
- [Use case](use-case/README.md) —— 用 pass rate 与 latency 比较多个运行的完整路径。
