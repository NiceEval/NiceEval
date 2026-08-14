# Phoenix Evaluator 可观察性

> 观察日期：2026-08-14
>
> 观察对象：Phoenix 把 evaluator 调用写成独立 Trace 的产品面
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

本页只写 Phoenix 自己的 evaluator observability。
总图与导航见 [README.md](README.md)。
调度顺序见 [execution.md](execution.md)。
表与软连接见 [storage.md](storage.md)。
从分数打开 judge Trace 的入口见 [reading-and-comparison.md](reading-and-comparison.md)。

Phoenix 把「被评执行」和「evaluator 自己怎么判」分成两条 Trace。
分数写在 Annotation 或 Experiment Evaluation 上。
用户可以从分数下钻到 judge 的 prompt、response、token、latency 和错误。

## 观察边界

| 对象 | 固定方式 |
|---|---|
| 服务端 20.2.0 | tag `arize-phoenix-v20.2.0`，提交 `4367f3fc2a2dd1f7da125c6f38a77bf91325710d` |
| Python Client 3.1.0 | 与 20.2.0 同仓 |
| 官方文档 | [Evaluator Traces](https://arize.com/docs/phoenix/evaluation/llm-evals/evaluator-traces)；[Dataset Evaluators](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/how-to-dataset-evaluators)；[Annotations Concepts](https://arize.com/docs/phoenix/tracing/concepts-tracing/annotations-concepts) |

## 产品面是什么

产品事实：Phoenix Evals 会自动 tracing 每次 evaluation。
官方列出的内容包括输入、evaluation prompt、模型回复、最终分数与执行细节。[Evaluator Traces](https://arize.com/docs/phoenix/evaluation/llm-evals/evaluator-traces)

产品事实：Dataset Evaluator 各自拥有一个 Project。
该 Project 专门收这个 evaluator 的 Trace。
入口在 evaluator 详情页的 Traces tab。[Dataset Evaluators](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/how-to-dataset-evaluators)

产品事实：SDK 实验里，Client 给每个 evaluator 开独立 Tracer。
根 Span 名是 `Evaluation: {name}`。
`openinference.span.kind` 写成 `EVALUATOR`。
符号在 `Experiments._run_evaluations`。
[experiments/__init__.py](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/packages/phoenix-client/src/phoenix/client/resources/experiments/__init__.py)

这三件事同属一条产品承诺：判断过程本身必须可打开。

## 三条写入路径

### 1. SDK Experiment evaluator

顺序是源码写明的：

1. Task 先跑完，并已经 `POST` 成 `ExperimentRun`。
2. `evaluate_experiment` 为每个 `(example, run, evaluator)` 再开一条 Trace。
3. evaluator 函数返回 `score` / `label` / `explanation` / `metadata`，或更短的 `bool` / `float` / `str`。
4. Client `POST /v1/experiment_evaluations`。
   payload 带 `experiment_run_id`、`name`、`annotator_kind`、`result` 或 `error`，以及 evaluator `trace_id`。

产品事实：这条 evaluator Trace 与 Task Trace 不共享 `trace_id`。
关联写在 `experiment_run_annotations.trace_id`。
它是字符串，不是数据库外键。
[`ExperimentRunAnnotation`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/db/models.py)

产品事实：同一 `experiment_run_id` + `name` 再写会 upsert。
后一次评价替换前一次，不保留同名历史。
[`upsert_experiment_evaluation`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/server/api/routers/v1/experiment_evaluations.py)

产品事实：evaluation POST 失败只打 warning。
实验继续，不回滚已有 Task run。

### 2. Dataset Evaluator / Playground

产品事实：Dataset Evaluator 挂在 Dataset 上，只在 UI / Playground 实验里自动跑。
SDK `run_experiment` 必须显式传入 evaluators。[Dataset Evaluators](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/how-to-dataset-evaluators)

产品事实：表 `dataset_evaluators` 有必填 `project_id`。
外键指向 `projects`，`ondelete=RESTRICT`。
[`DatasetEvaluators`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/db/models.py)

产品事实：服务端 `ExperimentRunner` 先对账已成功但缺 annotation 的 runs，再跑新 Task。
这样 Resume 或补挂 evaluator 时，只补 missing evaluation。
[`experiment_runner.py`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/server/daemons/experiment_runner.py)

### 3. 对已有 Trace 回写 Annotation

产品事实：生产 Trace 上的评价走 Annotation，不走 `experiment_run_annotations`。
信封是 `name` + `annotator_kind` + `result.{label,score,explanation}` + `metadata` + `identifier`。[Annotating via the Client](https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/capture-feedback)

产品事实：`identifier` 让多个 annotator 或多次评价共存。
未提供 `identifier` 时，同名 annotation 原地替换。

产品事实：OpenInference 把 `annotation.explanation` 写成 “Reason or evidence for the result”。
[Semantic Conventions](https://arize-ai.github.io/openinference/spec/semantic_conventions.html)

`phoenix-evals` 可以先在进程内算出 Score。
要出现在 Trace 过滤条或 Metrics 均分里，必须再写成上述 Annotation。

## 对象怎样连在一起

```text
被评执行
  Trace / Span                         生产或 Task 运行
  ExperimentRun.trace_id ──字符串──►  上述 Trace.trace_id

判断过程
  evaluator Trace                      独立 trace_id
  根 Span kind = EVALUATOR
  DatasetEvaluators.project_id ──FK──► 专用 Project

判断结果
  ExperimentRunAnnotation              钉在 ExperimentRun 上
    .trace_id ──字符串──►             evaluator Trace
  或 SpanAnnotation / TraceAnnotation  钉在生产对象上
    按 (name, 对象, identifier) upsert
```

产品事实：从 Span 进入 Dataset 时，example 往往在 `metadata` 里带着 `trace_id` / `span_id`。
显式 span link 才会填 REST `source`。
[Linking Examples](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-datasets/linking-examples-to-spans)

产品事实：Annotation 可以随 example 进入 Dataset `metadata`。
官方把它用于后续 Experiment 对照旧分数，或训练 LLM judge。
[Annotations Concepts](https://arize.com/docs/phoenix/tracing/concepts-tracing/annotations-concepts)

这是双向 lineage，不是只复制 input 文本。

## 用户怎样重新打开

| 入口 | 打开什么 |
|---|---|
| Experiment Compare 里的 evaluation 单元格 | 分数，以及指向 evaluator Trace 的链接 |
| Dataset Evaluator 的 Traces tab | 该 evaluator 专用 Project 里的全部调用 |
| 生产 Trace 上的 Annotation 面板 | 写在 Span / Trace / Session 上的 label、score、explanation |
| Filter `annotations['name'].score` | 按已写回的评价筛选被评 Span |
| Filter `evals['name'].label` | 与 `annotations` 同一套语法的别名 |

产品事实：官方 Evaluator Traces 页强调「Transparency」。
用户应能看到原始 prompt 与模型逐步理由，而不是只看到最终分数。
[Evaluator Traces](https://arize.com/docs/phoenix/evaluation/llm-evals/evaluator-traces)

产品事实：这套可观察性不提供不可变 Claim 历史。
同名再写会替换。Judge Trace 存在，也不等于 evidence basis 被封存。

## 与主模型的边界

本页不重复 Dataset 版本或 Experiment 调度。

本页要守住的边界只有一条：
分数是写回对象，evaluator 执行是另一条 Trace。
两者靠 `trace_id` 或 evaluator Project 相连。

NiceEval 对照只写在 [README.md](README.md) 末节。
