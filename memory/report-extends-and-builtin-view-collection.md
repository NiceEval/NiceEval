# 报告级复用走 extends,内建入口改为具名视图集合

## 裁决(2026-07-17)

- `defineReport` 新增 `extends`:在另一份报告上叠外壳。合并语义「页归 base(同引用)、外壳字段声明即整字段覆盖、未声明沿用 base」,在 `defineReport` 调用时折叠完成,产物仍是普通 `ReportDefinition`(可再被 extends,宿主装载管线零改动)。`content` / `pages` / `extends` 三选一。
- `niceeval/report/built-in` 改为**内建视图集合**:每个内建视图一份 defineReport 成品、一个名字、一个源文件、一条具名导出;当前只有 `standard`(报告 / Attempts / 追踪三页),默认导出恒等于 `standard`。未来加内建视图 = 加文件加名字,不需要注册表。
- 用户场景落点:`defineReport({ extends: standard, title, links, head })`——在默认报告上加品牌与 GA,页面内容零行。

## 曾选方案与否决理由

1. **照抄唯一路径**(原契约「复用不需要 import 内建入口,直接写同名组件」,shell.md 曾写明「复用从不消费默认导出」):用户在真实 repo(coding-agent-memory-evals)只想加 title/links/head 却要照抄 ~40 行三页声明,且内建演进不跟随。被用户推翻:「想在默认 report 上加 title 和 link 还有 head 就要全部重写,这个不对」。
2. **页具名导出**(built-in 导出 `pages` / `reportPage` / `attemptsPage` / `tracesPage`,用户装进自己的 `pages` 拼装;曾同日完整落过 docs):被用户当场否决——复用的单位应是**整份有名字的报告**,不是页列表;未来会有更多内建视图,每个都需要一个名字。页级拼装需求仍由照抄承接。

## 落点

docs:`docs/feature/reports/library/built-in.md`(重写)、`shell.md`(ReportDef 三选一 + extends 合并语义)、`README.md` / `concepts.md` / `source-map.md`;docs-site:`zh/tutorials/custom-reports.mdx`、`zh/tutorials/publish-report.mdx`。代码:`src/report/report.ts`(defineReport extends 折叠)、`src/report/built-in/standard.tsx` + `index.tsx`(视图集合)、`src/show/report-host.ts`(报错下一步文案)。测试:`src/report/dual-render.test.tsx`「extends 与内建视图集合」。注意 `./report/built-in` 的 exports 指向 dist——改 src 后必须 `pnpm run build:report`,否则外部 repo 报「does not provide an export named 'standard'」。
