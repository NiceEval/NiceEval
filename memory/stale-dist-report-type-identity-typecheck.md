# 改 src 类型后 dist/report 变陈旧,typecheck 报跨包类型不相认

## 现象

在 `src/`(尤其 `src/results/types.ts`、`src/report/types.ts`、`src/shared/*`)改公共类型后跑 `pnpm run typecheck`,报错点不在改动处,而在 `src/show/index.ts`、`src/view/data.ts` 这类同时 import raw src 与 `dist/report/**` 的文件——报「Type 'X' is not assignable to type 'X'」两个同名类型不相认,或 dist 侧 `.d.ts` 里引用的字段已不存在。看起来像自己改坏了类型,实际改动本身是对的。

## 根因

`src/report/**` 是仓库里唯一预编译面(`pnpm run build:report` → `dist/report/**`,发布用;见 CLAUDE.md「Release」)。`dist/report` 的 `.d.ts` 是**上一次构建时**从当时的 src 快照生成的:src 类型一改,dist 里还是旧形状。show/view 宿主同时消费两边,tsc 把「raw src 的类型」和「dist 编译产物里的同名类型」当成两个独立声明(两份模块实例,同类问题的构建期版本见 report-build-rootdir-and-module-identity 条目),于是同名不相认。

## 修法

改完一批 src 公共类型后立刻 `pnpm run build:report` 再 typecheck;报「X not assignable to X」且一边路径在 `dist/report` 下,先重建再排查,不要顺着报错去改 src。2026-07 docs↔code 对齐(schema v8、AssertionResult 判别联合等大批类型变更)期间踩了两次,均重建即绿。适用场景:任何触及 `src/report/**` 依赖到的公共类型(results/scoring/shared)的改动。
