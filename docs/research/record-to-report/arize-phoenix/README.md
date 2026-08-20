# Arize Phoenix：Project、Trace、Dataset、Experiment 与 Annotation

> 观察日期：2026-08-14
>
> 观察对象：Arize Phoenix 开源服务端、官方 Client、OpenInference 约定，以及官方文档站
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

Phoenix 是一套开源 AI observability 与 evaluation 平台。
用户代码真实执行。OpenTelemetry 与 OpenInference 把一次运行写成 Trace 与 Span。
同一 Phoenix 服务再保存 Dataset、Experiment、Annotation，并提供查询与 UI。

官方首页把工作流写成四段：发送 traces，评分，改 prompt，再用同一组输入跑 Experiment 比较。
[What is Arize Phoenix](https://arize.com/docs/phoenix)

Get Started 用四个具名步骤说同一条回路。
Tracing 看发生了什么。Evals 判断输出对不对。Prompts 改指令。Experiments 用同一组输入比较改动。
[Get Started](https://arize.com/docs/phoenix/get-started)

Phoenix 不是外接 SQL 后再画图的 BI 工具。
用户进程或 Playground 真实执行任务。同一服务再查询、打分、比较并展示。

## 观察边界

源码事实钉到 GitHub Release `arize-phoenix-v20.2.0`，提交 `4367f3fc2a2dd1f7da125c6f38a77bf91325710d`，2026-08-13。
[Release](https://github.com/Arize-ai/phoenix/releases/tag/arize-phoenix-v20.2.0)

Python Client 钉到 `arize-phoenix-client` 3.1.0，提交 `2eb1a2eeb49c112a7b7e7c89c10f795892c2b055`。
[Client Release](https://github.com/Arize-ai/phoenix/releases/tag/arize-phoenix-client-v3.1.0)

字段级 SQLAlchemy 形状另用祖先提交 `b4d9b19e6c681cedcf627fc27dc48f13c7320b73`（2026-08-08）核对。
20.0–20.2 的 CHANGELOG 未改 Experiment / Dataset / Trace 表形状。

文档站按 `/llms.txt` 滚动更新，不当作某个 tag 的冻结副本。
[llms.txt](https://arize.com/docs/phoenix/llms.txt)

产品没有在公开面写出某能力时，只写「本次检查的一手公开面未提供」，不推断闭源实现。

## 用户心智

普通应用作者只理解 Project 与 tracing 配置。
他们注册 tracer，跑业务代码，然后在 UI 里打开 Trace。

评测作者另有一套名词。Dataset 是 example 集合。Task 是对每个 example 执行的函数。
Experiment 在固定 Dataset 版本上重跑 Task，并用 Evaluator 打分。

人工审阅者面对的是 Annotation。
它可以写在 Span、Trace、Document 或 Session 上。
`annotator_kind` 是 HUMAN、LLM 或 CODE。
[Annotations Concepts](https://arize.com/docs/phoenix/tracing/concepts-tracing/annotations-concepts)

## 原生对象总图

```text
Project
  └── ProjectSession? ── Trace ── Span
                              ├── SpanAnnotation / DocumentAnnotation
                              └── DatasetExample.span_rowid?

Dataset ── DatasetVersion
  └── DatasetExample ── DatasetExampleRevision (CREATE / PATCH / DELETE)
        └── Experiment 固定 version，并快照 example + revision
              └── ExperimentRun ── ExperimentRunAnnotation
                    ├── ExperimentRun.trace_id ── Task Trace
                    └── Annotation.trace_id ── evaluator Trace
```

这些对象的 layer、owner 与依赖见 [layers.md](layers.md)。
表、信封与权威/派生区分见 [storage.md](storage.md)。

## 研究页

| 页 | 写什么 |
|---|---|
| [layers.md](layers.md) | Phoenix 自己的 layer、component、resource，以及 owner 与依赖 |
| [execution.md](execution.md) | 实验从发起到完成、失败、partial、retry / resume 的真实顺序 |
| [storage.md](storage.md) | 公开类型、表、文件、API 信封，以及权威事实与派生值 |
| [reading-and-comparison.md](reading-and-comparison.md) | 历史怎样重开、过滤、对齐、比较和展示；缺测怎样出现 |
| [schema-and-migration.md](schema-and-migration.md) | 对象版本、Alembic、升级命令、是否改写已保存数据 |
| [evaluator-observability.md](evaluator-observability.md) | Phoenix 原生产品面：evaluator 自己的 Trace |

后一页不是为对照 NiceEval 而拆的层。
它是官方单独成页的 evaluator 可观察性。
[Evaluator Traces](https://arize.com/docs/phoenix/evaluation/llm-evals/evaluator-traces)

## 与 NiceEval 的相似点、差异和可吸收约束

这张对照只存在于本页。其它研究页使用 Phoenix 自己的名词。

| Phoenix 对象 | 更接近 NiceEval 的哪一层 | 不能直接类比的地方 |
|---|---|---|
| Trace / Span | 一次运行的遥测 | 身份是 OTel ID，不是 sealed Attempt owner |
| Dataset example + version | 题集行与固定分母 | example 可改；版本管集合，不管字段 schema |
| Task 函数 | 用户代码里的执行体 | 不是持久实体 |
| Experiment / ExperimentRun | 一次固定题集版本的评测运行 | SDK 路径在 Client 进程执行 |
| Annotation / ExperimentRunAnnotation | 写回的分数信封 | upsert，不是不可变 Claim |
| `explanation` | 最接近 Evidence 的公开字段 | 规范叫 reason or evidence，不是独立 Evidence 类型 |
| Filter / Compare | 查询与比较读面 | 没有 Sample 分母，也没有 coverage / unsupported |
| Metrics Dashboard / Compare 页 | 呈现 | 没有 typed Report 声明 |

相似点：

- 用户函数真实执行，SDK 写入，同一产品读取。
- Experiment 创建时固定 Dataset 版本，并快照 example revision。
- 执行事实与评价分开。Span / Run 之外另有 Annotation。
- Evaluator 可以生成独立 Trace，从分数下钻到 judge 调用。
- 允许事后补评，不必重跑 Task。
- Filter 把 missing 与 `!=` 分开。
- 服务端用自己的 migration 演进表，不把用户自定义键做成新的磁盘格式。

差异：

- Phoenix 没有 Record → Analysis → Report 三套公共 API。
- Task 没有持久身份。SDK 实验没有服务端 status 封口。
- Annotation 与 Experiment Evaluation 都是 upsert，不是不可变 Claim history。
- `trace_id` 关联是字符串软连接，不是强制外键。
- 预置 Dashboard 与 span kind 约定绑定展示。自定义 Dashboard 交给闭源的 Arize AX。
- 未知 span 属性名静默匹配不到。

可吸收约束：

- 吸收「同一产品读写」和「比较必须固定题集版本」。
- 吸收「评价对象与 evaluator 执行 Trace 分开，且能双向打开」。
- 吸收「成功 run 不可替换，失败 run 可重提」。
- 吸收「missing / failed / successful 分列计数」。
- 不要把任意属性袋当成版本化 RecordAttachment。
- 不要把 Alembic 或预置 Dashboard 当成用户事实 migration 或 Report 作者面。
- 不要用 `explanation` 字符串代替绑定 subject 的 Evidence。
