---
format: concord.document/v1
id: stale-dist-report-type-identity-typecheck
title: 改 src 类型后 dist/report 变陈旧,typecheck 报跨包类型不相认
createdAt: 2026-07-15T03:50:16Z
createdAtSource:
  kind: first-recorded
  path: memory/stale-dist-report-type-identity-typecheck.md
  commit: 29e9136737bd570bfb05f35121166e1104040843
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
    statement: "- 已修
      [stale-dist-report-type-identity-typecheck](stale-dist-report-type-identi\
      ty-typecheck.md) — 改 src 公共类型后 `dist/report` 陈旧,typecheck 在 show/view
      宿主报「X not assignable to X」同名类型不相认;修法=先 `pnpm run build:report`
      重建再排查,不要顺着报错改 src"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 改 src 类型后 dist/report 变陈旧,typecheck 报跨包类型不相认

## 现象

在 `src/`(尤其 `src/results/types.ts`、`src/report/types.ts`、`src/shared/*`)改公共类型后跑 `pnpm run typecheck`,报错点不在改动处,而在 `src/show/index.ts`、`src/view/data.ts` 这类同时 import raw src 与 `dist/report/**` 的文件——报「Type 'X' is not assignable to type 'X'」两个同名类型不相认,或 dist 侧 `.d.ts` 里引用的字段已不存在。看起来像自己改坏了类型,实际改动本身是对的。

## 根因

`src/report/**` 是仓库里唯一预编译面(`pnpm run build:report` → `dist/report/**`,发布用;见 CLAUDE.md「Release」)。`dist/report` 的 `.d.ts` 是**上一次构建时**从当时的 src 快照生成的:src 类型一改,dist 里还是旧形状。show/view 宿主同时消费两边,tsc 把「raw src 的类型」和「dist 编译产物里的同名类型」当成两个独立声明(两份模块实例,同类问题的构建期版本见 report-build-rootdir-and-module-identity 条目),于是同名不相认。

## 修法

改完一批 src 公共类型后立刻 `pnpm run build:report` 再 typecheck;报「X not assignable to X」且一边路径在 `dist/report` 下,先重建再排查,不要顺着报错去改 src。2026-07 docs↔code 对齐(schema v8、AssertionResult 判别联合等大批类型变更)期间踩了两次,均重建即绿。适用场景:任何触及 `src/report/**` 依赖到的公共类型(results/scoring/shared)的改动。
