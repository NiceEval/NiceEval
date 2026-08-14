# Braintrust：Span、Dataset、Experiment 与 Transaction History

> 观察日期：2026-08-09
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 一手材料

- [Advanced tracing](https://www.braintrust.dev/docs/instrument/advanced-tracing)
- [Build datasets](https://www.braintrust.dev/docs/annotate/datasets)
- [SQL version queries](https://www.braintrust.dev/docs/reference/sql)
- [Recover deleted experiment rows](https://www.braintrust.dev/docs/kb/recovering-deleted-experiment-rows)
- [Run evaluations](https://www.braintrust.dev/docs/evaluate/run-evaluations)
- [Capture user feedback](https://www.braintrust.dev/docs/instrument/user-feedback)

## Span、Dataset 与 Experiment

Braintrust 让 production logs 与 experiment 使用同一种 Span 结构。
input、output、expected、scores、metadata 和 metrics 可以出现在同一 Span，production data 也能直接转成 Dataset。

Dataset 的 insert、update 和 delete 都进入 event-log history。
fetch API 暴露 `_xact_id`，named snapshot 可以固定某个 transaction，Experiment metadata 还保存 dataset version。
Dataset origin 能指向 producer project log row 与 source `_xact_id`。

## Transaction history

SQL 的 version 参数可以读取历史 Experiment 或 Dataset。
官方恢复指南还展示了用旧 `_xact_id` 重建被删除 Experiment rows，并警告全历史扫描可能超时。

这证明 `_xact_id` 是真实历史边界，不只是展示版本号。
它仍不是 RecordGraphRef：

- 它是服务端 transaction identity，不是内容寻址 root。
- 离开 Braintrust 后，ID 本身不能验证内容。
- 相同 version query 不支持长期 production project logs。
- update span 和 delete 仍是公开工作流的一部分。

## Feedback 与 child spans

Braintrust Feedback 可以直接向原 Span 写 score、expected、comment 和 metadata。
多用户 feedback 官方建议改用 child spans，避免彼此替换；父 Span 还会聚合 child score。

该聚合适合作为 Projection，不适合作为唯一权威判断。
否则普通读取会丢失具体判断者、原始分歧和 basis。
