---
format: niceeval.memory/v1
id: run-read-errors-thrown-as-effect-defects
title: Run 查询的预期错误被抛成 Effect defect
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# Run 查询的预期错误被抛成 Effect defect

P2；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Astra review，父 agent 独立复核。入口：`packages/niceeval/src/run/host/runtime.ts:210`。

数据库存在但 Run ID 不存在，或 list continuation 非法时，调用方不能按声明捕获 RunReadError。目标错误通道见 [Run Library](../docs/feature/run/library.md)。

`run/host/runtime.ts` 在 Effect.gen 内直接 throw RunReadError；list 在同类 generator 内调用会 throw 的 decodeContinuation。外层 Effect.mapError 只能转换 typed failure，不能转换 defect。无数据库分支却使用 Effect.fail，造成同类缺失 Run 错误的通道不一致。已按安装的 Effect 4.0.0-rc.112 指南与源码复核。

待验证：公开 CLI 创建 Run 后查询另一个格式合法的完整 ID，核对领域错误反馈；Host 可组合后再验证 catchTag 能捕获 RunReadError。修复方向为 Effect.fail 与 Effect.try 边界，不用 catchCause 把所有 defect 都掩盖成用户输入错误。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。
