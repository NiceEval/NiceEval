# Notes

## 2026-07-28 并发踩坑
多 agent / 终端 `claude` 同时改 `entity-lists/index.tsx`、`summaries/index.tsx`、`metric-views/index.tsx`
会互相覆盖。对策：叶子组件放到 `lists.tsx` / `metric-components.tsx`，`index` 只再导出；
**同工作树同时只保留一个写者。**

## 水位（typecheck 绿；dual-render + ResolvedPage + source-resolve 56 绿）
- ResolvedPage 单次 resolve → 多 locale 投影：已落
- Composition `ctx.resolve(source, input?)` 同缓存：已落
- SampleOverview / SampleSummary / FailureList → Composition + Chart/Table/Stat
- standard 已用 Callouts / CopyBlock / Waterfall + sources
- 待做：AttemptDetail Composition、收紧 Component、清旧词、E2B/E2E/source-map
