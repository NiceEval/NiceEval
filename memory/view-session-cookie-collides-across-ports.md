---
format: niceeval.memory/v1
id: view-session-cookie-collides-across-ports
title: 同一浏览器打开第二个 View 会覆盖第一个实例的 session cookie
createdAt: 2026-09-05
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_NPCQ260FNXM1SY43 -> netake_0SVB9XS4NCGH4WFE; current installed authorization Journey, three isolated + two same-copy + default parallel + single-case observations, all pass and cleanup verified by parent.
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/insight/test/view-authorization.browser.spec.ts#necase_XDDZFNTFXA177RG0"]}
promotions: []
---
# 同一浏览器打开第二个 View 会覆盖第一个实例的 session cookie

同一 browser context 打开同一 host 的两个不同端口 View 后，第二次认证覆盖第一个实例的固定名称 cookie。Cookie 不按端口隔离；一次性 credential 已消费后，首个实例的原链接不能重新交换 session。目标见 [Insight architecture](../docs/feature/insight/architecture.md)。

修正为每个 Host 进程生成独立随机 cookie 名，并由该实例的交换与校验路径使用；HttpOnly、SameSite=Strict、host-only、一次性 credential 与 Host/Origin 边界保持有效。

安装后 authorization Journey 用同一浏览器依次认证两个真实 View，再分别打开和硬刷新 Attempt。旧候选正式红灯证明第一个实例失效；最终候选同时包含初始化与唯一背景/弹窗修正，两实例均持续显示详情，错误授权仍被拒绝。

Final acceptance: candidate be39d8a68af55510a974013fd5e61950f85bf23a0ceb34d516681434fb9ea5d1; inventory neinv_QP84SXZDB9HV95JN; red nered_NPCQ260FNXM1SY43; complete takeover netake_0SVB9XS4NCGH4WFE. All seven observations match the current test source, pass, and report process cleanup. The full Insight seven-case suite also passes with default browser concurrency.
