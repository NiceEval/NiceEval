# 设计裁决:报告 web 面从「零客户端 JS」翻案为渐进增强

- **裁决**(2026-07-11):官方报告组件的 web 面保持静态基线——`renderToStaticMarkup` 产出、不 hydrate、无 JS 时内容完整可读——但随包发布一份渐进增强 runtime(`src/report/react/enhance.js`,发布为 `niceeval/report/react/enhance.js`):纯 vanilla、零依赖、幂等,只作用于 `.nre` DOM 与 `data-nre-*` 属性,提供表头点击排序(`th` 带 `data-nre-sort`、`td` 带 `data-sort-value`)、`MetricTable` 行过滤(`filter` prop 渲染 `<input data-nre-filter>`)、scatter / line 点的 hover tooltip(无 JS 退化为 SVG `<title>`)。宿主(view 的 server 与 `--out` 导出)把 runtime 与 styles.css 一并内联;text 面(`show`)不受影响。
- **曾选方案**(2026-07 早先裁决,曾记录在 reports.md 命名与形状决策表):「列头不做点击重排,两面同口径」——理由是它与「静态导出零客户端 JS」只能活一个,且 web 面一旦长出 text 面没有的口径开关,「人看到的和 agent 读到的一致」就分叉。
- **否决理由**:view 的默认首页迁到报告管线后(裸跑 ≡ `--report <defaultReport>`),报告槽要接住原生 Experiments tab 的浏览体验——几十行的实验榜单没有排序、过滤在浏览上不成立,「零 JS」会把 view 的日常可用性一起砍掉。而旧裁决真正要守的约束是**口径同源**,不是零脚本:增强只做浏览态(临时重排、隐藏行、tooltip),不改数据、不落盘、刷新即回基准态,基准顺序仍由计算侧 `sort` 预排,text 面、无 JS 环境与网页初始态读到同一份内容——「人与 agent 读到一致」在增强下依然成立。零 JS 与「不 hydrate、静态导出一等公民」也不是一回事:runtime 属性驱动、不带组件状态,静态导出内联同一份脚本即可,不引入构建机械。
- **日期**:2026-07-11。落点:`docs/reports.md`「静态为底,渐进增强」契约与命名决策表;实现 `src/report/react/enhance.js` 与两处宿主内联。
