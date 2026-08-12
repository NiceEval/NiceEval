# Relations 子设计

**上游**：[Projection](projection.md) · **下游**：[Derivation](derivation.md) 或
[Report](report.md) · **API 单源**：[Library](../library.md)

Relations 把同一 Sample 的 local projections 建成 fact relations。它只回答结构上“谁引用谁”和
“每条 edge 是否满足 cardinality”，不判定多个 observations 的数值谁更权威。

## 拥有的契约

Relation assembler 绑定 Sample handle。入口先核对 view token、population alignment、exact owner 与
package provenance，然后才对 included slots 执行 pure relation builder。不同 Sample 的 projections
混用时整次调用返回 typed failure，不产生半套 rows。

Host 直接传递 excluded、not-recorded 与 core-invalid。Included slot 穷尽返回 matched、
unmatched、ambiguous、package-result、capture-expectation 或 representation-unavailable。第三方
builder 不能通过少返回 rows 改变 denominator。

## Identity 与 cardinality

Relations 只使用 exact owner 与 durable cross-package anchors。Package-local operation → spans 之类的
关系由 package schema 和 Projection 验证，不重新 join。

| cardinality | 零个 target | 一个 target | 多个 targets |
|---|---|---|---|
| one | unmatched | matched | ambiguous |
| optional-one | matched-empty | matched | ambiguous |
| many | matched-empty | matched collection | matched collection |
| non-empty-many | unmatched | matched collection | matched collection |

合法一对多不是 ambiguous。同一 anchor 在多包中作为 reference 也不是 duplicate mint。Orphan
operation 没有可建立的 send edge，保留为 unmatched local fact。

## 不拥有的责任

- 不打开 Record、解码 package、运行 migration 或改变 Sample。
- 不按时间邻近、文本相等、provider ID 或 array index 猜 join。
- 不静默 union usage/timing observations，不选择 source authority。
- 不把 dangling anchor 反向改写为 package invalid。

## 演进和验收

Anchor 语义改变时发布新 kind 或 version，不在 read time rekey。Relation builder 可独立演进，
但必须声明 input projections 和每条 edge cardinality。

- 同一 `send` 能合法对应多个 agent events 与多个 OTel operations。
- 缺少 anchor 时保留局部事实，不用 heuristic 补 relation。
- Attachment 六态和 capture expectations 保留原因，不折成 missing。
- Built-in relation 只组合 public primitives，不获得 private owner lookup。
