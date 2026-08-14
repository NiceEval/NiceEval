# Decision

## 裁决

旧 Observability 拆包方案曾采纳
[PLAN-1](PLAN-1/README.md)：七个官方 owner-specific logical family 各自成为一份 durable RecordAttachment。第三方扩展使用
平台固定的 Metric、Score 与 Artifact envelopes，不获得新增 family 的权限。

这是固定五类 Attachment catalog 定稿前的历史选型裁决，不构成当前 durable 协议。

## 为什么选择 PLAN-1

- definition、current payload、相邻 migration 与实际写入对象一一对应，作者可以明确指出写入哪个值；
- conversation、commands、usage、timing 与 diagnostics 的 migration blast radius 彼此独立；
- 官方 families 与第三方固定 envelopes 共用同一个 writer、reader、验证与迁移内核，但不共用公开 Attachment authoring API；
- `ProjectedSample` 只保留既有 Attachment 六态，不增加 Receipt、representation selection 或 fallback；
- OTel 作为唯一 timing collector 的受限 capture transport，不要求 raw OTLP 成为第二份 durable authority。

## 为什么否决 PLAN-2

[PLAN-2](PLAN-2/README.md) 能保留 OTel package 的 source-qualified observations 与不可拆 seal transaction，
但会引入 Capture Receipt、representation selection 和更大的 migration blast radius。读取一个 timing view 也可能
materialize 整份 OTel closure。本 Roadmap 优先选择明确的 owner-local value 与独立 schema 演进。

PLAN-1 不声称 `niceeval.timing/v1` 保存 OTel provenance。无法绑定 owner、verified clock domain、稳定 phase 或
durable anchor 的 span 不进入 interval，并使 timing collection 为 partial。

## 当前契约落点

- 固定 catalog 与 owner layout：[Record Architecture](../../feature/record/architecture.md)。
- timing v1 shape：[Observability Attachments](../../feature/record/architecture/observability-attachments.md#timing)。
- Analysis 的闭合读取：[Analysis Library](../../feature/analysis/library.md)。
