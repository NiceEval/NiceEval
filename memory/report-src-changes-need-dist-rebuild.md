---
format: concord.document/v1
id: report-src-changes-need-dist-rebuild
title: report-src-changes-need-dist-rebuild
createdAt: 2026-07-15T17:06:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/report-src-changes-need-dist-rebuild.md
  commit: 8d032cad6e47365a1235967d0b048c940a10ac17
description: 改 src/report/** 后 CLI 行为不变——show/view 宿主 import 的是 dist/report 预编译产物,要 pnpm run build:report
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [report-src-changes-need-dist-rebuild](report-src-changes-need-dist-rebuild.md) — 改 `src/report/**` 后 CLI 行为不变:show/view 宿主 import 的是 `dist/report` 预编译产物,单测绿 + CLI 旧 ≈ 忘了 `pnpm run build:report`"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**(2026-07-15):修好 `src/report/text/faces.ts` / `table.ts` 的 Result 单元格收口,typecheck 与 vitest 全绿,但在真实 repo 里 `pnpm exec niceeval show` 输出完全没变,极像改错了渲染器。

**根因**:`src/show/index.ts` 对 report 包 import 的是 `../../dist/report/report.js` 与 `../../dist/report/built-ins/index.js`——`src/report/**` 是全仓库唯一预编译发布的部分(JSX web 面,见 CLAUDE.md Release 节),CLI 宿主为了与用户报告共享同一模块实例也吃 dist。vitest 直接测 src,所以测试绿与 CLI 行为旧可以同时成立。

**修法**:改完 `src/report/**` 想在 CLI(`niceeval show` / `view`)上看到效果,必须先 `pnpm run build:report`。判别口径:单测绿 + CLI 旧 ≈ 大概率忘了重建 dist,先重建再怀疑改错文件。
