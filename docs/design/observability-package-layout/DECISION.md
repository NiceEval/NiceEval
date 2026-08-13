# Decision

## 裁决

为 [Record → Analysis → Report Roadmap](../../roadmap/record-analysis-report/README.md) 采纳
[PLAN-1](PLAN-1/README.md)：七个 owner-specific logical family 各自成为一份 durable RecordAttachment。

这是 Roadmap 目标的选型裁决。该方向被产品采用前，当前
[Observability Feature](../../observability.md) 仍是唯一当前契约；Design Decision 不自行替换 Feature。

## 为什么选择 PLAN-1

- definition、current payload、相邻 migration 与实际写入对象一一对应，作者可以明确指出写入哪个值；
- conversation、commands、usage、timing 与 diagnostics 的 migration blast radius 彼此独立；
- official 与第三方都能使用同一套 RecordAttachment definition、writer、reader 与 projector 内核；
- `ProjectedSample` 只保留既有 Attachment 六态，不增加 Receipt、representation selection 或 fallback；
- OTel 作为唯一 timing collector 的受限 capture transport，不要求 raw OTLP 成为第二份 durable authority。

## 为什么否决 PLAN-2

[PLAN-2](PLAN-2/README.md) 能保留 OTel package 的 source-qualified observations 与不可拆 seal transaction，
但会引入 Capture Receipt、representation selection 和更大的 migration blast radius。读取一个 timing view 也可能
materialize 整份 OTel closure。本 Roadmap 优先选择明确的 owner-local value 与独立 schema 演进。

PLAN-1 不声称 `niceeval.timing/v1` 保存 OTel provenance。无法绑定 owner、verified clock domain、稳定 phase 或
durable anchor 的 span 不进入 interval，并使 timing collection 为 partial。

## 契约落点

- official timing 端到端语法：[Roadmap use case](../../roadmap/record-analysis-report/use-case/官方OTelTiming.md)。
- layout 与 capture 边界：[PLAN-1](PLAN-1/README.md)。
- current timing v1 shape：[Observability Attachments](../../feature/record/architecture/observability-attachments.md#timing)。
