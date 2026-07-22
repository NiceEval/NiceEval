---
name: e2e-report-dev-loop-pnpm-link-pollutes-workspace-yaml
description: pnpm link 给 e2e/<repo> 做本地快速迭代会往 pnpm-workspace.yaml/pnpm-lock.yaml 写入持久 override，rm -rf node_modules 也不消失
metadata:
  node_type: memory
  type: project
---

**现象**：在 `e2e/report/`（或任意自成 workspace root 的 e2e 仓库）里跑
`pnpm link /path/to/niceeval` 做本地快速迭代（绕开每次 `pnpm e2e --repo <x>` 都要重新
`pnpm pack` + 隔离安装的开销），链接生效、`node_modules/niceeval` 指向本地源码。但事后
`rm -rf node_modules && pnpm install --frozen-lockfile` 并不能干净复原——`git status`
仍会显示 `pnpm-workspace.yaml`（多出 `overrides: { niceeval: link:../.. }`）和
`pnpm-lock.yaml`（被大幅改写，几百行 diff）被改动。

**根因**：`pnpm link` 不是纯 `node_modules` 层面的操作，它把 override 写进
`pnpm-workspace.yaml`，pnpm 后续任何 `install` 都会读到这条 override 并继续用本地链接
解析 `niceeval`，`--frozen-lockfile` 也不例外（override 优先于 lockfile 记录的版本）。

**修法**：本地调试完必须显式 `git checkout -- pnpm-workspace.yaml pnpm-lock.yaml`
把这两个文件复原到 committed 状态，然后再 `rm -rf node_modules && pnpm install
--frozen-lockfile`（缺这一步光删 node_modules 不够，pnpm 会照着 override 重新链接）。
`git status` 里出现这两个文件的意外改动，先怀疑最近是不是跑过 `pnpm link`。

**适用场景**：给任何 `e2e/<repo>` 写新的 `scripts/verify-*.ts` 时，想用当前 HEAD
的 niceeval 源码快速迭代断言逻辑而不想每次都走 `pnpm e2e --repo <repo>` 的完整
tarball-build-and-inject 流程——更省事也更不容易留手尾的替代方案是直接
`node /path/to/niceeval/bin/niceeval.js <args>`（`bin/niceeval.js` 本身就是相对
自己位置 import `../src/cli.ts`，不需要任何链接/安装即可跑到 HEAD 代码），只在最终
验收时才用一次真正的 `pnpm e2e --repo <repo>`。

**踩过一次的组合坑**：这条替代方案对报告渲染相关改动（`src/report/**`）不完全成立——
`node bin/niceeval.js` 确实跑的是 HEAD 的 `src/cli.ts`，但 `src/cli.ts` 里报告渲染这条
路径内部又转手 import 预编译的 `dist/report/**`（见
[report-src-changes-need-dist-rebuild](report-src-changes-need-dist-rebuild.md)），这份
产物不会因为你用本地入口跑而自动重建。B4 渲染面浏览器验收任务里，`node bin/niceeval.js
view --out` 导出的静态站一度缺了整个 `attempt/` 目录，一度怀疑是刚实现的功能有 bug，
真正原因是 `dist/report` 落后 `src/report` 两天——先 `pnpm run build:report` 再用本文件
推荐的本地入口迭代，两条 memory 要一起看。
