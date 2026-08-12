# LLM eval 与 tracing 产品

> 观察日期：2026-08-09
>
> 观察对象：MLflow、Weights & Biases Weave、LangSmith、Arize Phoenix 与 Braintrust 的公开文档和 API
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 研究判断

五个产品都遇到了 NiceEval 的部分问题：生产 trace 要进入 dataset，判断要附着于执行，评测输入和 scorer 要固定版本，原始结构还要投影成可读界面。
它们因此比 Git 或 EventStore 更接近普通 Eval 作者的使用场景。

没有一个产品公开承诺跨这些对象的 immutable、content-addressed Record revision。
它们的版本和 lineage 通常只固定 dataset、prompt、object 或 experiment 中的一部分。

最有价值的行业共识是：trace 与 assessment/feedback/annotation/score 应当分开，底层事实写入协议应由 instrumentation 和 SDK 隐藏。
NiceEval 可以保留更强的 Claim 和 evidence 契约，同时把 `observe()`、`claim()`、Node 和 edge 移出普通用户主路径。

## 一手材料

### MLflow

- [Trace concepts](https://mlflow.org/docs/latest/genai/tracing/observe-with-traces/)
- [Assessments](https://mlflow.org/docs/latest/genai/assessments/)
- [Evaluation Dataset concepts](https://mlflow.org/docs/latest/genai/concepts/evaluation-datasets/)
- [Build datasets from traces](https://mlflow.org/docs/latest/genai/datasets/)
- [OTLP export](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/export/)
- [OpenTelemetry attribute mapping](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/attribute-mapping/)

### W&B Weave

- [Ops, Calls, and Traces](https://docs.wandb.ai/weave/guides/tracking/tracing)
- [Track and version objects](https://docs.wandb.ai/weave/guides/tracking/objects)
- [Call schema](https://docs.wandb.ai/weave/guides/tracking/call-schema-reference)
- [Feedback](https://docs.wandb.ai/weave/guides/tracking/feedback)
- [Datasets](https://docs.wandb.ai/weave/guides/core-types/datasets)
- [Export evaluation data](https://docs.wandb.ai/weave/guides/evaluation/export_eval)

### LangSmith

- [Run data format](https://docs.langchain.com/langsmith/run-data-format)
- [Feedback data format](https://docs.langchain.com/langsmith/feedback-data-format)
- [Manage datasets](https://docs.langchain.com/langsmith/manage-datasets)
- [Example data format](https://docs.langchain.com/langsmith/example-data-format)
- [View traces](https://docs.langchain.com/langsmith/view-traces)
- [Messages view trace format](https://docs.langchain.com/langsmith/messages-view-trace-format)
- [Administration and retention](https://docs.langchain.com/langsmith/administration-overview)

### Phoenix

- [OpenInference specification](https://arize-ai.github.io/openinference/spec/)
- [Annotation concepts](https://arize.com/docs/phoenix/tracing/concepts-tracing/annotations-concepts)
- [Span Annotations](https://arize.com/docs/phoenix/sdk-api-reference/typescript/packages/phoenix-client/span-annotations)
- [Updating datasets](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-datasets/updating-datasets)
- [LLM evaluators](https://arize.com/docs/phoenix/evaluation/server-evals/llm-evaluators)

### Braintrust

- [Advanced tracing](https://www.braintrust.dev/docs/instrument/advanced-tracing)
- [Build datasets](https://www.braintrust.dev/docs/annotate/datasets)
- [SQL version queries](https://www.braintrust.dev/docs/reference/sql)
- [Recover deleted experiment rows](https://www.braintrust.dev/docs/kb/recovering-deleted-experiment-rows)
- [Run evaluations](https://www.braintrust.dev/docs/evaluate/run-evaluations)
- [Capture user feedback](https://www.braintrust.dev/docs/instrument/user-feedback)

## 候选筛选

| 候选 | 最接近 Record 的部分 | 公开边界 |
|---|---|---|
| MLflow | Trace 与 Assessment 分层，trace 进入 Evaluation Dataset | Assessment 可更新或删除；没有统一 revision root |
| W&B Weave | versioned Object 与精确 hash ref | Object、Call、Feedback 分属不同平面；version 可删除 |
| LangSmith | dataset 历史、Run/Feedback 分离、Messages/Details projection | Run 可 patch；历史 dataset 不固定 producer trace 的完整对象链 |
| Phoenix | Span/Annotation 分层、dataset version、evaluator trace | Annotation 是 upsert；各对象没有共同 root |
| Braintrust | `_xact_id` 历史读、dataset snapshot 与 origin | production log 不支持相同版本读；ID 不是内容证明 |

一般 APM 或只有 trace UI 的产品没有列入。
它们无法回答判断依据、dataset lineage 或历史 revision 的问题，只会重复“也保存 span”这一表面相似性。

## MLflow：Trace 与 Assessment 的清晰分层

MLflow Trace 保存应用执行的 span tree。
Assessment 是独立对象，用于 feedback、expectation 或 evaluation result，并带 source、rationale 等字段。

这是 Observation 与 Claim 最直接的领域先例之一：

- Span 保存模型调用、tool、retrieval 和应用步骤。
- Assessment 保存人工、代码或模型 evaluator 对 trace/span 的判断。
- evaluator failure 可以与判断结果分开反馈。

边界也很明确。
Assessment 没有强制 `basedOn` 列出 evaluator 实际读取的 span、dataset row 或外部材料。
公开 API 允许 update 或 delete，因而不是不可变 Claim。

Evaluation Dataset 是持续增长的 collection。
它有 content digest、record source 和 schema/profile；相同 input 还可以 merge expectations 与 tags。
这适合 curating workflow，却不等同于固定的 Sample 或 Record revision。

MLflow 可以接收和导出 OTLP，并在 MLflow、OpenInference 与 OTel GenAI 属性间转换。
这种 translation 只处理已知字段，不提供 unknown payload 的 raw-byte round trip 或 strong-closure traversal。

### 对 NiceEval 的启发

- 保留 Assessment 式领域动词，不让普通 evaluator 构造任意 Claim JSON。
- evaluator request/response 进入 Observation，score/verdict 进入 Claim。
- supersession 应创建新 Claim 并保留旧值，不就地 update。
- schema translation 属于 interop Projector，不能改写 durable Observation。

## W&B Weave：精确版本引用，但没有统一根

Weave 的 Op 是 versioned function，Call 是一次执行，Trace 是共享 trace ID 的 Call tree。
Object 可以保存 Dataset、Model、Prompt 或其它 JSON-serializable data。

Object 内容变化会产生新 version。
ref 可以使用 hash、`vN` 或 movable alias；精确 ref 最接近 NiceEval NodeRef 的用户体验。

官方也允许删除某个 Object version。
查找引用已删除对象的 graph 时会出现 `DeletedRef`。
这里的 immutable 表示已发布 version 不就地修改，不代表永久 retention。

Dataset 是 versioned Object，Evaluation 可以引用 dataset、model 和 scorer。
evaluation export 还给出 `row_digest`，按行内容而不是位置对齐两次评测。

这些 identity 各有正确作用域：

- Object ref 固定某个配置或 dataset version。
- `row_digest` 固定某个 eval row。
- Call ID 固定执行事实对象。
- Feedback 是另一个可添加、查询或 purge 的平面。

它们没有共同的 project/record revision root。
一组精确 ref 也不会自动证明所有依赖都已闭合并可离线复制。

### 对 NiceEval 的启发

- 普通探索可以默认 latest，receipt、Sample 和 Report 必须保存 exact ref。
- 删除后返回具名 deleted/unavailable，不能折成 `null`。
- evaluator definition、dataset 和 model 都要有稳定 identity。
- leaf digest 只回答叶身份，不能冒充整个 RecordGraphRef。

## LangSmith：Projection UX 很强，事实根较弱

LangSmith 把 Span 保存为 Run record。
低层 ingest 可以先 POST Run，再 PATCH output、error 或 end time；它是可完成和更新的 record，不是提交后永不改变的 revision。

Feedback 是独立 record，关联 `run_id`，并带 score、value、comment、correction、source metadata 和 modified time。
它支持 Observation/Claim 分层方向，却没有 immutable Claim 或 tracked basis 的公开保证。

Dataset 每次 add、update 或 delete example 都创建新 version。
过去版本只读，可通过 `as_of` 或 tag 读取并执行 evaluation。
Example 还能保存 `source_run_id`，说明生产 trace 进入 dataset 时需要 lineage。

LangSmith 最值得吸收的是 Messages、Turns 和 Details 的读面分层。
普通用户看到对话，诊断者可以下钻原始 Run tree。
无法识别某种格式时，Messages adapter 会明确失败，而不是静默猜测。

这仍不是 NiceEval Projector 的完整先例。
Messages extraction 依赖 integration metadata、payload shape 和 adapter logic，没有公开固定 projector version、参数或 `basedOn`。
同一旧 Run 可能随 UI 或 adapter 升级产生不同展示。

LangSmith trace 还有 retention tier 和删除能力。
固定 dataset version 不能保证 producer Run、Feedback 和 projection logic 永久存在。

### 对 NiceEval 的启发

- 同时提供友好 Projection 和原始 Evidence view。
- 无法解释 payload 时返回明确 unsupported adapter，不猜字段。
- trace 进入 dataset 时保存双向 lineage，而不只复制 input 文本。
- Projector identity、version、参数和 GraphRef 必须进入 memo 与审计面。

## Phoenix：最完整的 evaluator 可观察性

Phoenix 使用 OpenInference 表达 AI trace。
OpenInference 是建立在 OpenTelemetry 上的 semantic convention，定义 LLM、tool、retrieval 等 span kind 和属性。

Phoenix 把 Span 与 Annotation 分开。
Annotation 可以标明 HUMAN、LLM 或 CODE annotator，并携带 label、score 和 explanation。
这与 Observation/Claim 的概念边界高度一致。

结构化 Annotation 仍是 upsert。
默认对同一 span/name 再写会原地替换；`identifier` 可让多个 annotator 或 evaluator version 共存，但相同 key 仍会更新。
它不等于不可变 Claim history。

Dataset update 会生成新 `version_id`，Experiment 可以固定该 version。
生产 Span 进入 Dataset 时还能建立 dataset example 与 source Span 的双向链接。

LLM evaluator 的 prompt、model 和 invocation parameters 会版本化。
每次 evaluator 调用还生成独立 OTel Trace，用户可以从 Annotation 下钻 judge request、response、token 和 latency。

这是 NiceEval 最应该吸收的产品路径：

```text
被评执行 Span
  ├─ evaluator execution Trace
  └─ Annotation score
```

NiceEval 应进一步把 evaluator execution 存成 Observation，把 score/verdict 存成 immutable Claim，并让框架生成实际读取 basis。
judge Trace 的存在本身不证明 evidence closure 完整。

## Braintrust：历史 transaction ID 最接近 revision

Braintrust 让 production logs 与 experiment 使用同一种 Span 结构。
input、output、expected、scores、metadata 和 metrics 可以出现在同一 Span，production data 也能直接转成 Dataset。

Dataset 的 insert、update 和 delete 都进入 event-log history。
fetch API 暴露 `_xact_id`，named snapshot 可以固定某个 transaction，Experiment metadata 还保存 dataset version。
Dataset origin 能指向 producer project log row 与 source `_xact_id`。

SQL 的 version 参数可以读取历史 Experiment 或 Dataset。
官方恢复指南还展示了用旧 `_xact_id` 重建被删除 Experiment rows，并警告全历史扫描可能超时。

这证明 `_xact_id` 是真实历史边界，不只是展示版本号。
它仍不是 RecordGraphRef：

- 它是服务端 transaction identity，不是内容寻址 root。
- 离开 Braintrust 后，ID 本身不能验证内容。
- 相同 version query 不支持长期 production project logs。
- update span 和 delete 仍是公开工作流的一部分。

Braintrust Feedback 可以直接向原 Span 写 score、expected、comment 和 metadata。
多用户 feedback 官方建议改用 child spans，避免彼此替换；父 Span 还会聚合 child score。

该聚合适合作为 Projection，不适合作为唯一权威判断。
否则普通读取会丢失具体判断者、原始分歧和 basis。

## 跨产品研究判断

### 判断是独立对象

MLflow Assessment 和 Phoenix Annotation 说明 trace 与评价需要分层。
NiceEval 应保留这一信息模型，并比同业更严格地禁止原地替换。

### evaluator execution 也要被观察

Phoenix judge Trace 是最好的直接先例。
保存 request/response 能调查 parser、prompt 或 model 故障；最终 score 仍应是另一个 Claim。

### lineage 必须双向可导航

Phoenix source Span、LangSmith `source_run_id` 和 Braintrust origin 都说明 trace→dataset 不能只复制输入值。
读取者需要从 dataset 回到 producer trace，也要从 producer trace 看到后续使用。

### 每种 digest 只有自己的作用域

Weave row digest、Dataset digest、Object ref 和 transaction ID 都有价值。
它们不能替代为 Record 全体 authoritative payload 建立 identity 的 Graph root。

### Projection 应同时提供友好层和原始层

LangSmith Messages/Details 是优秀的 UX 模式。
NiceEval 还需要固定 Projector identity、version、参数和 GraphRef，并由框架自动追踪 basis。

## 对上层 API 的研究判断

五个产品都把普通用户导向 instrumentation、typed evaluator、dataset 和 experiment 操作。
没有产品要求每个 Eval 作者手写通用 Merkle graph 或 CAS transaction。

NiceEval 的主路径应是：

| 使用者 | 公开动作 | 框架自动生成 |
|---|---|---|
| Eval 作者 | assertion、judge、verdict | Claim id、scope、evaluator identity、time、basis |
| Adapter 作者 | agent message、tool result、usage、lifecycle event | binding、sequence、stream、transform metadata |
| Projector 作者 | typed reads 与普通 `T` result | EvidenceValue、unavailable、verification、dependency trace |
| 协议扩展作者 | advanced payload/codec registration | Node、strong edge、catalog 与 commit validation |

底层 `observe()` 和 `claim()` 可以存在于 advanced 边界。
它们不应是普通 Eval 作者学习 NiceEval 时首先看到的 API。

## 不应复制的行业惯例

- latest、tag 或 alias 进入历史 receipt。
- Feedback 或 Annotation 按 name 原地替换。
- 删除后只返回 `null`，不区分 deleted、not-recorded、retained-out 或 corrupt。
- 用 comment、metadata 或 source ID 冒充 evaluator basis。
- 把 OTel/JSON 可导出描述成 unknown schema 可验证复制。
- 把 UI 聚合 score 写回权威事实。
- 用“immutable snapshot”文案代替不可变 API、retention 和内容验证契约。

## 证据空白

公开材料没有确认以下强保证：

- 五个产品均未承诺 unknown future payload 可由 generic reader 原字节复制并验证完整 strong closure。
- MLflow Dataset digest、Weave version hash 和 Braintrust `_xact_id` 都没有公开证明跨全部依赖的 Record identity。
- LangSmith Messages adapter 没有公开历史 projector version pin。
- Phoenix Annotation upsert 的完整历史和旧 version retention 没有形成与 Record 等价的契约。
- SaaS 内部可能拥有额外 audit log；本研究只比较普通用户可依赖的公开 API。
