---
format: niceeval.memory/v1
id: human-short-error-and-score-summary
title: Human 短错误丢失前文且 Score 摘要隐藏未启动计数
createdAt: 2026-09-20
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_1NZ67DBK6VWY8Y3R
      - netake_GPYRQ6D0Q344KXS7
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/cli/test/provider-error-feedback.test.ts#necase_7HXVADGZABWJQXEC"]}
promotions: []
---
# 现象与根因

Human 把预算内的 `Missing API_KEY; configure the provider before running` 截成从 `API_KEY` 开始，原因是预算判断之前先按大写 token 聚焦文本。FAILURES 按 locator 保留每条 execution error，却把条目数标为 kinds。纯 Score 摘要独立分支没有显示已有的 completion.unstarted，三次计划中的两次执行错误触发 fail-fast 后，剩余一次在结束摘要中消失。

# 修复与验证

预算内安全消息直接保留；FAILURES 使用 entries，不合并执行错误；Score 摘要显示 not started，不制造 skipped。调度、选择器、Record 与四态 Verdict 不变。

公开入口为安装后 `niceeval exp short-error --rerun all`。既有 owner `e2e/cli/test/provider-error-feedback.test.ts#necase_7HXVADGZABWJQXEC` 同时保留长消息预算、不同 Provider 错误与 Query 下钻检查。

首次 red 命令：`pnpm e2e test --repo cli --artifact-root .artifacts/human-feedback-red -- --run test/provider-error-feedback.test.ts`。旧源码 HEAD 为 cf25a6bfe21b8382c7063ff9ac01f5a861545ace，候选 SHA-256 为 e05464972076ef2efb9614e428d6d6f68a3d94fde4134aba50149a124bc15a1d。三个 soft assertion 分别因 Missing 丢失、2 kinds 和缺少 1 not started 失败；两条执行错误均可见的断言首次通过。

同一命令使用 `.artifacts/human-feedback-green` 取得定点 green；候选 SHA-256 为 2f361ddc23b36b2e919e3e2d07fdb4b032217ff75b5a4e7c3bb6f7909b53ebdf。正式 red、takeover 与回归关系由受管命令补充。
