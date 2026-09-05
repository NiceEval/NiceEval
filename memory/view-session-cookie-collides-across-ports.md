---
format: niceeval.memory/v1
id: view-session-cookie-collides-across-ports
title: 同一浏览器打开第二个 View 会覆盖第一个实例的 session cookie
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# 同一浏览器打开第二个 View 会覆盖第一个实例的 session cookie

P2；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Astra review，父 agent 独立复核。入口：`packages/niceeval/src/view/server.ts:356`。

同一 browser context 依次打开同一 host 的两个不同端口 View，第二次认证会覆盖第一个实例的 cookie；第一实例随后不能通过 session 校验。目标独立 session 见 [Insight architecture](../docs/feature/insight/architecture.md)。

`view/server.ts` 使用固定名称 niceeval_view_session 和 Path=/，各实例 session 值独立随机。Cookie 不按端口隔离，见 [RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)。启动 credential 一次性消费后，原链接不能再次交换。代码与协议支持此结论，实际 UI 尚待浏览器复现。

待验证：同一 Playwright browser context 打开两个独立 View，完成认证后分别执行详情查询和硬刷新。两个实例都应继续工作。修复须同步 cookie 的生成、命名与校验，并保留现有 HTTP 认证边界。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。
