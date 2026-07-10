# view 对零可读结果曾静默导出空报告(exit 0)

**现象**:`.niceeval/` 目录存在但零可读结果(真空,或全部落盘 schemaVersion 不兼容被整批跳过)时,`niceeval view --out site` 照常导出一张空报告并以 0 退出;本地 `niceeval view` 也能对空库起 server 渲染空仪表盘。CI 静态发布场景(Vercel/GitHub Pages 的 buildCommand)里,空报告会静默顶掉线上的上一次部署——消费仓 coding-agent-memory-evals 曾因 25 份 v1 落盘全被 0.5 跳过而只差一个守卫脚本兜住。

**根因**:`loadViewScan` 只在 `--report` 在场时做零结果校验(`opts.report && experiments.length === 0`),裸 view / `--out` 没有守卫;而 data.ts 注释里「匹配不到直说,不渲染一张空页面」的原则对位置前缀 / `--experiment` 都已执行,唯独漏了「整库零可读」这一格。

**修法**(2026-07-10,`src/view/data.ts`):`loadViewScan` 对 `results.experiments.length === 0` 一律抛 `ViewInputError`——server 起不来,`--out` 非零退出。错误文案 `noReadableResults()`:真空给 `cli.view.noResults` 入门提示;有 skipped 时逐条列目录+原因,niceeval 落盘的 schemaVersion 场景拼出可跑的 `npx niceeval@<版本> view` 命令(复用 `toSkippedNotice`)。测试在 `src/view/data.test.ts`「零可读结果直说」组。同役裁决:发布口径不设 `--latest` 收窄 flag,发布=本地 view 所见即所发,见 `docs/view.md` 发布口径裁决(2026-07-10)。
