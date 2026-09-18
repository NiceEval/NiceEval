---
format: concord.document/v1
id: docs-otel-mixin-not-implemented
title: docs-otel-mixin-not-implemented
createdAt: 2026-07-03T05:24:42+08:00
createdAtSource:
  kind: first-recorded
  path: memory/docs-otel-mixin-not-implemented.md
  commit: eb582131f9cc4cccadc48a5a769e9b65062873b8
description: docs-site/zh/guides/connect-otel.mdx 把未落地的 otelEvents()
  设计提案写成已实现功能，且链接到不存在的 examples/zh/before/* 目录
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "**已修（2026-07-24 复核）**：走的是第 2 点里的第一条路——把 API
      从用户文档里撤掉，而不是把它实现出来。判据：`otelEvents` 这个符号在
      `src/`、`docs/`、`docs-site/`、`examples/`
      全仓零命中，`docs-site/{,zh/}tutorials/connect-otel.mdx`（页面已从 `guides/` 移到
      `tutorials/`）既不提 `otelEvents` 也不再链 `examples/zh/before/*`。设计文档
      `docs/adapters/otel-mixin.md` 连同整个 `docs/adapters/`
      目录也已不在，`docs/roadmap/adapters/` 只剩 README。"
    proof: []
    source:
      path: memory/docs-otel-mixin-not-implemented.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:c7f411273cfe9cf4e06c7dddf647ca91d7add629fd534673db22030ffcd03ff7
---

**现象**：`docs-site/zh/guides/connect-otel.mdx`（用户文档，非设计提案）把 `otelEvents()` / `import { otelEvents } from "niceeval/adapter"` 写成已经能用的功能，配了完整的 before/after 代码示例、`otel.aiSdk`/`otel.genAi` 等格式模块、双发 exporter 写法，还链接 `examples/zh/before/langgraph`、`.../openllmetry`、`.../openinference`、`.../custom-genai` 作为"可跑示例"。

**根因**：`grep -rl "otelEvents" src/` 零命中——这整套 API 在代码里根本不存在。对应的设计文档 `docs/adapters/otel-mixin.md` 本身开头就写着"**状态:设计提案,未实现。**"，两份文档互相矛盾：一份说是提案，另一份（用户看的那份）当成已发布功能来写。而且被链接的 `examples/zh/before/*` 目录当时都不存在（只有 `examples/zh/origin/*`，且命名和 [[examples-before-after-layout]] 约定的 `zh/before/<name>` 不一致）。

**影响**：任何人（包括我）照 `connect-otel.mdx` 的指引给 langgraph / custom-genai / openllmetry / openinference 写"OTel 零映射接入"的 adapter 代码，都会因为 import 不存在的符号而在写完才发现整段路子是空中楼阁。真正能用的是 `docs/adapters/authoring.md` 里手写 `toStreamEvents` 的 remote-agent 套路（T0 送收，T1 靠手写 mapper），`aiSdkAgent` 内部走的也是这条路，不是 otel mixin。

**修法 / 适用场景**：
1. 给这四个 origin 示例写 niceeval eval 集成时，默认只做 T0（`t.send()`，返回最终文本），不要假设能白嫖 T1；要 T1 就得照 authoring.md 手写 mapper（claude-agent-sdk / codex-sdk 的 SDK message stream 结构化程度高，手写映射成本低；custom-genai/langgraph/openllmetry/openinference 的"结构化数据"目前只存在于 OTel span 里，手写映射等于要重新实现 otel-mixin 提案的核心逻辑，工作量超出"minimal non-invasive"的范围）。
2. 下次 touch `docs-site/zh/guides/connect-otel.mdx` 时要么把它标成"设计提案，未实现"（对齐 `otel-mixin.md`），要么把 otel-mixin 真正实现出来再保留现状——不要让它继续以"用户文档"的身份存在但描述不存在的 API。
3. 该文档里所有 `examples/zh/before/langgraph` 等链接在这些示例真正迁移到 `zh/before/<name>` 之前都是死链。（原文引的 `[[examples-before-after-layout]]` 条目已不存在于 `memory/`，这条 wiki 链接是断的，留作出处记录。）

**已修（2026-07-24 复核）**：走的是第 2 点里的第一条路——把 API 从用户文档里撤掉，而不是把它实现出来。判据：`otelEvents` 这个符号在 `src/`、`docs/`、`docs-site/`、`examples/` 全仓零命中，`docs-site/{,zh/}tutorials/connect-otel.mdx`（页面已从 `guides/` 移到 `tutorials/`）既不提 `otelEvents` 也不再链 `examples/zh/before/*`。设计文档 `docs/adapters/otel-mixin.md` 连同整个 `docs/adapters/` 目录也已不在，`docs/roadmap/adapters/` 只剩 README。

**连带失效（2026-07-24 已处理）**：上一轮审计留的路标——其它三条 memory 正文里当时仍写着 `events: otelEvents({dialects:[...]})` 的示例代码，照抄会 import 不存在的符号。三条都已按当前 API 面重写：`ai-sdk-otel-needsapproval-no-execute-tool-span.md`、`codex-mapcodexspans-not-publicly-exported.md`、`langsmith-dialect-langchain-completion-shape-gap.md`。三条的「现象 / 根因 / 修法」实质不变，只是把不可跑的示例换成散文 + 现有落点指路，并各自在开头挂了 API 时效说明回指本条。以后再撤 API，按同一套办法处理：全仓 grep 确认符号真的没了 → 逐条改写受影响 memory 的示例 → 回到这里把路标结清。

**其它过期引用**：本条正文里引的 `docs/adapters/authoring.md`（手写 `toStreamEvents` 的 remote-agent 套路）也已随 `docs/adapters/` 目录一起消失，当前对应的是 `docs/feature/adapters/library/writing-an-adapter.md` 与 `docs/origin-integration.md`（五个 origin 应用的 Tier 1 接入配方）。
