# Task Plan: remaining-gap + report-single-resolve-migration

## Goal
并行完成 Reports 呈现侧收口与「单次 resolve → 多面投影」作者模型迁移。

## Phases
### remaining-gap
- [x] 0–1.6（原语 + Chart/Dataset；Table/Cell/Grid/Stat 已在树中）
- [x] 2 watch → import 闭包（server-watch 测绿）
- [x] 1.7 原语替换专用件（standard / Composition / sources 投影；lists.tsx·Metric*·faces 物理删除留给 1.8）
- [x] 1.8 清旧词 + dead code 物理删除（专用件物理删；公开面只留新名；show/e2e/demo 已切 Table+sources/compute）
- [ ] 3 E2B（无 key → 点名）
- [ ] 4 E2E
- [ ] 5 source-map / docs-site 收口

### report-single-resolve-migration
- [x] 1 ResolvedPage + view 单次 resolve
- [x] 2 Composition `ctx.resolve(source, input?)`
- [ ] 3 收紧 Component 协议
- [x] 4 官方组合 → defineComposition
- [x] 5 删旧公开面（与 1.8 同批）

## Status
1.8 已完成：公开面旧词与专用件死代码已清；`pnpm run typecheck` + `src/report` 测绿。
下一步：Component 协议收紧、source-map/docs-site 收口、E2B/E2E。
