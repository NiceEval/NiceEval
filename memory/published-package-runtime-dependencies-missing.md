---
format: niceeval.memory/v1
id: published-package-runtime-dependencies-missing
title: 发布包缺失运行依赖并触发 pnpm build approval
createdAt: 2026-08-27T16:30:00+08:00
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - package E2E installed candidate sha256 274baf3685d66576f6bd649b8c69ea3784298603ab8ad5231c03107872481927 in pnpm 11 without a NiceEval build allowlist and passed --version, init, list, and exp --dry
      - package reliability takeover passed all six required observations for the same candidate, including three isolated installations and repeated same-copy execution
promotions: []
---
# 发布包缺失运行依赖并触发 pnpm build approval

## 问题

把发布后的 NiceEval tarball 安装进不声明 `effect`、也不配置 `pnpm.allowBuilds` 的空项目时，pnpm 11 因 `autoevals` 与 `tsx → esbuild` 的安装脚本退出失败。即使绕过该安装状态直接运行 binary，CLI 也因找不到 `effect` 而在 `--version`、`init` 之前崩溃。

## 根因

发布 manifest 只把 `effect` 声明为 dev dependency 与 peer，尽管 CLI 和 `@effect/platform-node` 在运行时无条件需要它。Package E2E 的消费项目又自行声明 `effect`，并通过场景级 `allowBuilds` 允许相关安装脚本，因而没有模拟普通消费者的依赖图。Release workflow 只 pack 和核对 tarball digest，没有在发布同一字节前从空项目安装并运行 CLI。

## 修复边界

`effect` 必须作为与 `@effect/platform-node` 同 revision 的精确 runtime dependency，并把它的纯 JavaScript 运行闭包随包交付，保证 CLI 闭包完整，同时避免其可选原生加速依赖要求消费者批准 lifecycle script。Package owner 和 release gate 都必须在无 NiceEval 专用 allowlist、无消费者自带 Effect 的隔离项目中安装同一候选 tarball，并从安装后的 CLI 验证版本、初始化、发现和 dry planning。

## 回归证明

同一 Package E2E owner 必须先用旧候选在公开安装或启动边界取得红灯，再由修复候选转绿。Memory 仅在该 owner 的可靠性接管和最终同 tarball release smoke 完成后解析为 fixed。
