---
format: concord.document/v1
id: ai-sdk-official-entry-points-narrowed
title: ai-sdk-official-entry-points-narrowed
createdAt: 2026-07-19T10:46:51+08:00
createdAtSource:
  kind: first-recorded
  path: memory/ai-sdk-official-entry-points-narrowed.md
  commit: 084930f5129f9c0ac773fdeed8ca358fe2e97b5b
description: 设计裁决——AI SDK
  官方接入面从三个(fromAiSdk/aiSdkAgent/uiMessageStreamAgent)收窄到两个,aiSdkAgent
  降级为进程内调用窄例外,不再是推荐入口;e2e/adapter/ai-sdk 删掉 in-process 覆盖,OTel 证明改挂 HTTP 路径
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---

**裁决**(2026-07-19):`docs/feature/adapters/sdk/ai-sdk/README.md` 的「AI SDK 接入面」从三条收窄为两条——`uiMessageStreamAgent`(HTTP)与 `fromAiSdk`(结果转换器)。`aiSdkAgent` 从主表格移除,改成页面末尾一段说明:它仍是 `niceeval/adapter` 的合法导出,但只服务「被测循环本身就是目标边界、应用从未以 HTTP 形式部署」这条 [remote-agent.md 进程内调用](../docs/feature/adapters/library/remote-agent.md) 窄例外,不是 AI SDK 应用的推荐接入方式。

`e2e/adapter/ai-sdk` 同步删除 `evals/in-process/`、`experiments/in-process.ts`——该仓库的被测应用本来就有一个真实 HTTP 部署(`src/backend/server.ts`),进程内 `aiSdkAgent` 循环复刻的是同一份 `tool-defs.ts`/`models.ts`,不满足"被测循环本身就是目标边界"这条例外,是「测函数不等于测生产路径」的反面教材,不是需要保留的覆盖。仓库承担的 OTel 证明(执行树 span 时间注释)改挂到 `uiMessageStreamAgent` 路径:应用接入官方 `@ai-sdk/otel`(仿 `examples/zh/tier2/ai-sdk-v7` 的 `registerTelemetry` 模式),`niceeval.config.ts` 加 `telemetry: { port: 4318 }` 固定端口,`scripts/e2e.ts` 起服务时注入 `OTEL_EXPORTER_OTLP_ENDPOINT`。usage 非空这条机制事实原来挂在 `in-process` 上,现在没有入口能扛(UI Message Stream 协议帧本来就不带 token 计数)——确认 `e2e/report` 已经独立覆盖"usage 到达 CLI 读回"这条机制事实,不是新增的覆盖缺口。

**曾选方案**:保留 `aiSdkAgent` 作为与 `uiMessageStreamAgent` 并列的「官方工厂」,`e2e/adapter/ai-sdk` 继续用它覆盖「进程内循环 vs HTTP 传输层事件词汇一致」。这个方案已经被另一个并发 session 写进未提交的 `docs/engineering/testing/e2e/adapter/ai-sdk.md`/`e2e-ci/README.md`(把 `fromAiSdk` 降级但保留 `aiSdkAgent`),本次改动覆盖了那批文字。

**否决理由**:全部真实 example(`examples/zh/tier1|tier2|tier3/ai-sdk-v7`)零个用 `aiSdkAgent`,只用 `uiMessageStreamAgent`——留着它当"官方入口"制造了一个没人真实走的路径,且与仓库的通用规则(`docs/getting-started.md`、`connect-your-agent.mdx`:即使 agent 和 eval 同代码库也要走 HTTP,不做进程内直调)相矛盾。`e2e/adapter/ai-sdk` 这个具体仓库更进一步:它的应用明明部署了 HTTP,进程内覆盖测的是同一份逻辑的第二份实现,不是"这条路径没有 HTTP 边界"的合法例外。

**连带确认**:`--timing` 的 per-turn OTel 子树缺口([[ai-sdk-agent-otel-timing-subtree-unlinked]])是 `AgentOtelChannel` 的合成 traceId 从不匹配真实 span 这一 niceeval 侧结构性问题,与走 in-process 还是 HTTP 无关——迁移到 HTTP+`defineConfig({telemetry})` 后同一验收脚本仍把这条断言写成非 gating warning,不指望迁移顺带修好它。
