# npm 上的 niceeval 还是 `outcome`/`outcomes`,本地 checkout 的文档已经在讲 `verdict`

## 现象

按 `docs/reports.md`(本地 dev checkout 的文档草稿)写自定义 report 的 metric/`where`/
`CaseList.data`,用 `attempt.result.verdict` 和 `{ verdicts: [...] }`,在一个真实
`pnpm add niceeval` 装出来的消费者项目里 typecheck 报错:`Property 'verdict' does not exist
on type 'EvalResult'`,`CaseListDataOptions` 也没有 `verdicts` 字段。

## 根因

[terminology-overhaul-2026-07](terminology-overhaul-2026-07.md) 那次改名(`ResultOutcome` →
`Verdict`,`outcome` 字段 → `verdict`,2026-07-11 裁决)已经落进本仓库的工作区与 docs,但
**还没发版**——写这条 memory 时 npm 上最新的 `niceeval@0.5.4` 仍是改名前的字段:
`EvalResult.outcome: ResultOutcome`,`CaseList.data` 的选项字段是 `outcomes`,不是
`verdict`/`verdicts`。本地 dev checkout 的 `docs/reports.md` 描述的是"即将发布"的状态,
不是"当前能装到的包"的状态。

## 修法

- 给外部消费者项目(不是 niceeval 自己)写代码时,契约以 `node_modules/niceeval/src/**/*.ts`
  (已安装包的源码——niceeval 直接发布 `.ts` 源码,没有单独的 `.d.ts`)为准,不要以本仓库的
  `docs/` 为准;两者在一次改名发版的窗口期内会不一致。
- 判别技巧:typecheck 报"属性不存在"且属性名恰好是最近一次 `memory/` 里记录的改名条目
  (如 verdict/outcome),先怀疑"文档比发布的包新",去 `node_modules/niceeval/src/` 里
  `grep` 实际字段名,而不是怀疑自己抄错了 API。
- 这类改名发版后此条目应标"已修"并补上发版版本号(如 `niceeval@0.6.0` 起字段名统一)。
