# Phoenix 怎样重开、过滤、比较和展示历史

> 观察日期：2026-08-14
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

本页只写读取与比较。
写入顺序见 [execution.md](execution.md)。
行形状见 [storage.md](storage.md)。
evaluator Trace 怎么打开见 [evaluator-observability.md](evaluator-observability.md)。

## 用户入口

| 角色 | 入口 | 打开什么 |
|---|---|---|
| 应用作者 | UI Projects → Traces / Sessions | 一条 OTel Trace 及其 Span 树 |
| 评测作者 | Client 打印的 Compare URL；Dataset → Experiments | 一次 Experiment，或多次 Experiment 并排 |
| 分析作者 | UI 过滤条；`SpanQuery().where(...)`；`get_spans_dataframe` | 过滤后的 Span 表 |
| 报告读者 | 预置 Metrics Dashboard | 项目级 traces、延迟、cost、token、annotation 均分 |
| 编码代理 | `/mcp` | 查询 traces、datasets、experiments |

产品事实：Client 把比较页当作一等入口。
[`get_experiment_url`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/packages/phoenix-client/src/phoenix/client/resources/experiments/__init__.py)

```python
def get_experiment_url(self, dataset_id: str, experiment_id: str) -> str:
    return urljoin(
        str(self._client.base_url),
        f"datasets/{dataset_id}/compare?experimentId={experiment_id}",
    )
```

产品事实：UI 比较页读取多个 `experimentId` 查询参数。
实现落在 `app/src/pages/experiment/ExperimentCompareGridPage.tsx`。

产品事实：`evaluate_experiment` 可以在旧 Experiment 上补新 evaluator，不必重跑 Task。
补评后仍从同一 Compare URL 打开。

## Query 与 filter

产品事实：Span 与 Session 使用两套 Filter Expression。
它们共享 Python 布尔表达式核心。Session 额外支持聚合与 comprehension。
[Filter Expressions](https://arize.com/docs/phoenix/tracing/how-to-tracing/filter-expressions)

产品事实：UI 过滤条与 GraphQL `filterCondition` 走同一语言。
Python `SpanQuery().where(...)` 发到 `POST /v1/spans`。
REST list / search 只用离散查询参数，不接受这套表达式。

产品事实：未知 span 属性名不会报错。它被当成不存在的属性路径，结果是匹配不到。
Session filter 相反：未知名字会被拒绝，并给出「你是不是想写」。

产品事实：Experiment Compare 另有一套过滤语言。
官方页只声明它存在，没有完整语法页。
源码编译器在 `src/phoenix/server/api/helpers/experiment_run_filters.py`。
它认识 example 的 `input` / `reference_output` / `metadata`，以及 run 的 `output` / `error` / `latency_ms` / `evals`。

## Align、group、compare

产品事实：对齐键是 Dataset example 身份，外加 `repetition_number`。
同一 Dataset 版本上的多次 Experiment 按 example 并排。
这不是用户声明的 Sample 分母，而是快照表里的 example 集合。

产品事实：公开面没有独立的 group-by 声明层。
分组发生在 UI 表格、预置 Metrics，或用户导出后的 DataFrame。

## 缺测怎样出现

产品事实：缺值必须写 `is None`。
`annotations['correctness'].label is None` 用来找还没写过该 annotation 的 span。
[Filter Expressions](https://arize.com/docs/phoenix/tracing/how-to-tracing/filter-expressions)

产品事实：Experiment 列表把缺测拆成三列。
`successful_run_count` 是 `error is None` 的 run。
`failed_run_count` 是带 `error` 的 run。
`missing_run_count` 是 `example_count * repetitions - successful - failed`。
[experiments.py `get_experiment`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/server/api/routers/v1/experiments.py)

产品事实：服务端 Resume 把 missing 与 failed 都当成 incomplete。
它不会把失败伪装成缺测，也不会把缺测算进成功。

产品事实：SDK 路径在 `actual_runs < expected_runs` 时只打印警告。
列表接口上的 `missing_run_count` 仍反映未提交的格子。

产品事实：Filter 的 `!=` 不会匹配缺少该属性的 span。
作者必须显式写 `is None`，否则那些行从当前结果里消失，而不是标成 unsupported。

## Render

产品事实：`openinference.span.kind` 会改变 UI 如何组装 Span。
[What are Traces](https://arize.com/docs/phoenix/tracing/concepts-tracing/what-are-traces)
这是约定绑定展示，不是写入时挑选图表。

产品事实：预置 Metrics Dashboard 自动包含 traces 数量、延迟分位、cost、token、错误与 annotation 均分。
[Metrics Dashboard](https://arize.com/docs/phoenix/tracing/llm-traces/metrics)
作者不能在写入 API 里声明一张新 Dashboard。

产品事实：公开面没有名为 Report 的声明对象。
代码侧导出 DataFrame。UI 侧消费预置图与 Compare 页。
