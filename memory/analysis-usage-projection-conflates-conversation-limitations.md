---
format: niceeval.memory/v1
id: analysis-usage-projection-conflates-conversation-limitations
title: Analysis usage 投影混入 conversation limitation
createdAt: 2026-08-24T14:07:42+08:00
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - "Installed-candidate E2E red: candidate SHA-256 82b7507542e1febf2c65d94db16e8db179df2c12058fd7b43f2f771d140ec1f5 failed e2e/report/test/report-show.test.ts because classic/baseline Tokens was partial with 1/9 samples and eight analysis-missing usage collection is incomplete problems while agentTurns carried only unsupported-input(target=turn-item)."
      - "Installed-candidate E2E green: candidate SHA-256 3c52d917283e7f72b3be8539d1dd999cb72c89eee2ea89681a1426c1b2d4eacc passed the targeted regression, all six Report files / 13 Vitest tests, and both Chromium browser journeys."
      - "E2E reliability takeover: artifacts/e2e/takeover-report-usage/takeover-summary.json reports all three isolated copies, the same-installed-copy repeat, repo-default-parallel, and target-single as clean pass with matrixValidation ok and complete."
      - "Public downstream check: NiceEval/NiceEval-Preview commit 705d90329848825b25b1fbde389905b513ccb93a with its existing sealed Records and candidate 3c52d917283e7f72b3be8539d1dd999cb72c89eee2ea89681a1426c1b2d4eacc returned zero usage collection is incomplete problems for /group/named/pass-gallery; pass-gallery/candidate was available with 4/4 samples and 208 tokens."
promotions:
  - kind: feature
    current:
      path: docs/feature/analysis/library.md
      anchor: 已发布的输入与成员集
    history: []
---
# Analysis usage 投影混入 conversation limitation

## 问题

完整记录 input/output token buckets 的 Attempt 在 Analysis `tokens` Measure 中形成 `analysis-missing — usage collection is incomplete`。Report 因而把 Tokens 显示为无数据，并在 Data notes 中逐 Attempt 重复暴露错误缺口。

## 根因

`niceeval.agent-turns` 同时承载 conversation items 与 usage observations，collection limitation 以 `target` 区分子通道。Preview 的确定性 Direct Agent 发出 `thinking`、`compaction` 等不持久化 conversation 事件，因此 source 合法带有 `unsupported-input(target=turn-item)` 并处于 `partial`；它的 usage observations 仍完整包含 input/output token buckets。

Analysis 的 `attemptTokens` projector 和 Attempt Observability usage view 直接复用了整个 source 的 `partial` 状态，没有按 `usage-observation` target 投影。前者拒绝已有 token buckets 后又找不到 usage-specific limitation，错误回退为 `usage collection is incomplete`；后者也把完整 usage 显示为 partial。

## 修复边界

从一个多通道 source 派生输入或 DomainView 时，只让属于该子通道 target 的 limitation 决定其 collection 状态；其它 target 的 limitation 仍保留在 source dependency 和对应 conversation/command view 中。Record bytes、source family schema 与采集策略不变。

回归由安装后 Report E2E 的静态站公开结果拥有，先证明含 unsupported conversation item 且完整 usage 的 Attempt 不再产生 usage 缺失，并继续保留 conversation partial limitation。
