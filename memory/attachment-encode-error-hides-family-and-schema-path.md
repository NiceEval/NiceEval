# Attachment 编码失败不能吞掉已完成的 Attempt

MemoryBench 曾通过公开 CLI 只得到泛化的 `record-attachment-encode-error`，无法确定 family 与违规字段。保留 Schema formatter 的路径和 family 后，还必须分别核对 canonical JSON admission 与领域 invariant：它们不经过 Schema formatter，也会丢掉已有的路径信息。

## 已确认的 producer 风险

长会话的公开 CLI 复现显示，单条消息不超过 16 KiB、条数不超过 collection 上限，整份 `niceeval.agent-turns` 仍可超过 Record 的 1 MiB framing 上限。两轮各 48 条长消息即可触发与下游相同的 `runner-record-attempt-publication-failed`、`path: ["value"]`、空 `schemaIssues`；这证明一种确定根因，不能据此断言原始数据已丢失的下游会话一定命中了同一个预算。

Adapter coverage reason 还可通过公开声明携带超长文本、NUL 或孤立代理项；直接复制到 terminal receipt 会在 producer seal 阶段失败。usage 的非法数字与超量观察已有独立筛选，消息正文也已有 UTF-8、控制字符和单条字节归一，不能把这些已有保护当作整个 Attachment 的预算。

## 边界处理

producer 在封口前规范化 terminal reason，并按实际编码预算保留全局 item 前缀，必要时继续缩减 usage、turn 和 limitation。预算计算必须包含 JSON 转义和 encoded keys；裁剪声明 `collection-cap-reached`，不改变执行身份或 Assertions 已消费的原始 matcher 材料。

Record 的 canonical rejection 必须保留路径和 `record-json-invalid` / `record-json-limit-exceeded` 原因，领域 invariant 也要保留自己返回的路径。整份 payload 的总字节预算超限可以合法地只有根路径，但不能没有原因。

附件编码发生在 storage admission 之前。此时尚无 durable rows，可以释放 family reservation，Runner 将 observability family 留为缺席，另存 `attachment-encode-failed` advisory；不能 poison 整个 Run。Content 读取失败或 storage admission 后的错误仍是发布失败，不能用同一 catch 吞掉。

公开 owner `e2e/runner/test/attachment-publication.test.ts` 分别守护长会话、terminal coverage 和另一 family 的编码失败；通过 `exp --json` receipt、Attempt `show execution` 与 `show usage` 读回，不读取私有 Record。字段路径的非法 JavaScript 值矩阵由最小 Unit 区分。
