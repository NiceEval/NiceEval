# `niceeval show @<locator>` 在配了 `config.report` 的项目里打不开

**现象**:MemoryBench 里 `niceeval show @<locator>` 直接失败(退出码 1)、`--json` 面可用(2026-07-31 真机)。当时怀疑是 pnpm link 工作树的陈旧 `dist/report/**`。

**根因**:与 link 工作树、`dist` 陈旧无关(先 `pnpm run build:report` 再跑,报错逐字不变;`--report standard` 立刻能开)。真实原因是项目自己的默认报告:MemoryBench 的 `niceeval.config.ts` 填了 `report: memory`,那份报告只声明了一张 sample 页,没有 attempt-input page。`show @<locator>` 按契约装载 `config.report` 后找不到 attempt 页,按[「报告没声明 attempt 页时不悄悄落回内建详情」](../docs/feature/reports/show/reports.md)报错——这是设计行为,不是崩溃。

报错本身有真 bug:出处标签写成 `flags.report ?? "the built-in report"`,忽略了取值链中间那档,于是从 `config.report` 装载时消息说成「内建报告没有 attempt 页」——而内建报告恰恰是有的,读者被指向一个不存在的矛盾,也看不出该去改哪个文件。

**修法**:已修(2026-07-31)。出处判断收进装载 facade:`src/report/runtime/host.ts` 新增 `describeReportSource(reportPath, configuredReport)`,三档与 `loadHostReport` 一一对应;`src/show/index.ts` 缺 attempt 页的报错改用它,并先给一条当场可用的读法(`--report standard` 或 `--json`),再给三条把 attempt 页加进本报告的路径。覆盖类别声明在 `docs/engineering/testing/unit/reports.md`「报告取值链与 `--report` 值判别」,区分力场景是「没写 `--report` 但配了 `config.report`」。

**留给后续**:`view` 对这种报告会补官方详情页(见该篇「view 数据装载」类别),`show` 按契约不补——两个宿主在同一份报告上的下钻可达性不同,是有意的,但用户是从 `show` 打印出的 locator 走过来的,值得复盘这条契约本身。
