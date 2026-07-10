# View —— 本地结果查看器(`niceeval view`)

控制台和 `summary.json` 是「当下」的;`niceeval view` 是「事后看图」——不连任何外部服务,只读 `.niceeval/<时间戳>/` 这些结构化工件。结果保存格式见 [Results Format](results-format.md),数据来源见 [Observability](observability.md#结果可视化niceeval-view)。

```sh
niceeval view                         # 起本地 web,自动打开浏览器,读 .niceeval/ 下所有历史运行
niceeval view .niceeval/<run>/summary.json    # 单文件模式:只看这一份报告
niceeval view weather                 # 位置参数 = eval id 前缀,收窄报告槽选集(与 show 同语义)
niceeval view --run site-data/run     # 结果目录经 --run 递入;--experiment <id> 只看该实验
niceeval view --report reports/exam.tsx       # 报告槽整槽换成自定义报告(与 show 同一文件)
niceeval view --no-open               # 只打印 URL,不打开浏览器
niceeval view --out site              # 目录式静态导出:index.html + artifact/
```

位置参数的判定:指向存在的文件 → 单文件模式(不与 `--run` 或其它位置参数混用);指向存在的目录 → 报错直说走 `--run`;其余按 eval id 前缀。收窄只作用于报告槽(榜单 / overview / 注入报告的选集),证据室数据恒为全量,attempt 深链在任何收窄下都可达。

架构上是**一次性烘焙进单个 HTML+JSON 的静态产物**(`src/view/index.ts` 的 `renderHtml`),不是常驻的多页面 server——`niceeval view` 起的 web 服务每次请求现读现渲染,`--out` 则直接导出。这是刻意的取舍,详见 [References](references.md#调研过判断不值得抄的及理由)。

`--out` 只有目录式一种形态:写 `<out>/index.html`,并把前端会 fetch 的三类工件(`sources.json` / `events.json` / `trace.json`)复制到 `<out>/artifact/<base>/`,与本地 server 的 `/artifact/<rel>` 路径路由同一布局,同一份前端产物在两种托管下用同一个相对 URL(`src/view/app/lib/artifact-url.ts`)。`diff.json` / `o11y.json` 刻意不复制:查看器从不读取,且 diff 可达上百 MB,带上只会拖垮静态部署体积。

零可读结果(目录真空,或全部落盘被 skipped)时 `loadViewScan` 抛 `ViewInputError`:本地 server 起不来,`--out` 非零退出、不导出空页面——与 show 的「匹配不到直说」同一原则,同时是 CI 静态发布的守卫(构建失败让托管平台保留上一次部署,空报告不顶上线)。错误逐条列 skipped 目录与原因,niceeval 落盘的 schemaVersion 场景拼出可跑的 `npx niceeval@<版本> view` 命令(`src/view/data.ts` 的 `noReadableResults`)。

> 发布口径裁决(2026-07-10):发布的站与本地 view 完全一致(所见即所发),不设 `--latest` 之类的发布收窄 flag——结果既已提交进仓库,历史体积成本已被接受,导出再收窄只会让线上站 ≠ 本地站、平添第二种导出语义;发布策划过的选集属于 `copySnapshots` 积木(宿主语言挑选,`view --run` 对着产物看)。公开文档的 CI 发布页(`docs-site/zh/guides/publish-report.mdx`)因此只有一种姿势:`.niceeval/` 提交进仓库(gitignore 排除 `diff.json`)+ `view --out` 一行构建命令,可叠 `--report` 发布自定义报告。曾评估过「本地 copySnapshots 固化快照提交、CI 只导出」的第二姿势,已否:平添第二个真相源,发布依赖人记得跑本地脚本,站点会静默过期。

> 单文件导出(`--out report.html`)曾经存在,已移除:代码/transcript/trace 视图依赖工件文件,单文件注定是残缺体验,而 coding eval 恰恰最依赖这些视图——这个形态的存在本身就在诱导用户导出一份看不了证据的报告。「传一个文件给同事」的需求,答案是把整站导出托管起来发链接,或用 [Reports](reports.md) 积木在 CI 里落判决数据。`--out` 目标以 `.html` 结尾时 CLI 直接报错并给出改法。

## 结果版本机制

`niceeval view` 读取的是已经落盘的报告,而报告会比 CLI 活得更久:用户可能几个月后打开 `.niceeval/<run>/summary.json`,也可能把 CI 产物下载到另一台机器上看。所以 view 的版本策略要优先保证两件事:

1. 新版本 CLI 不轻易丢下旧报告。
2. 真读不了时,错误信息要告诉用户「该用哪个版本看」或「这份历史结果可以删掉」。

具体设计:

- **报告自己带版本。** `summary.json` 顶层放 `format: "niceeval.results"`、`schemaVersion` 和 `producer.version`,设计见 [Results Format · 版本与升级设计](results-format.md#版本与升级设计)。没有这些字段的现有报告视为 legacy v0。
- **版本判定只有一份实现。** 读取层收编后(2026-07),版本判定与形状校验住在 `niceeval/results`(`src/results/format.ts` 的 `classifySummary`),view 经 `openResults` 消费,不再自带 loader 常量,更不散落在 React 组件里。
- **先分类,再渲染。** 磁盘 JSON 经 `openResults` 分流:能读的成为快照层次,读不了的进 `skipped`(三种原因);前端组件只吃 `viewData` 的官方数据契约与快照明细。
- **未知字段不是错误。** 新增 `git`、`environment`、`agentSetup`、`classification` 等字段时,旧 view 可以忽略;新增 artifact kind 也只是不展示。只有必需字段缺失、字段类型错误、或 `schemaVersion` 超出支持区间才算版本/格式错误。

### 报错与降级

`view` 有两种入口,错误处理不同:

- **读整个 `.niceeval/` 目录。** 遇到某个 run 读不了,不要让整个页面失败。loader 应收集 `skippedRuns[]`,继续渲染其它 run,并在页面顶部显示一条可展开提示:哪些 `summary.json` 被跳过、原因是什么、建议怎么处理。
- **读单个 `summary.json`。** 这是用户明确指定的目标,读不了就应该让命令失败,打印可执行的下一步,不要打开一个空页面。

错误分类:

| 场景 | 行为 | 文案要点 |
|---|---|---|
| 没有 `format` / `schemaVersion`,但有 `results[]` + `startedAt` | 按 legacy v0 读 | 可弱提示「旧格式报告」,不阻断 |
| `format` 不是 `niceeval.results` | 跳过或失败 | 说明这不是 niceeval 报告 |
| `schemaVersion` 小于最低支持版本 | 跳过或失败 | 建议用写出该报告的 `producer.version` 打开,或先导出/归档后 `niceeval clean` |
| `schemaVersion` 大于当前支持版本 | 跳过或失败 | 建议升级 niceeval,或用报告里的 `producer.version` 对应版本打开 |
| 必需字段坏了,例如 `results` 不是数组 | 跳过或失败 | 说明报告可能损坏,给出文件路径 |
| attempt 工件缺失,例如 `events.json` 不存在 | 页面仍可打开 | 只在展开该 attempt 时显示「artifact missing」 |

命令行错误要给到具体命令,例如:

```text
Cannot open .niceeval/2026-07-02T03-10-24-123Z/summary.json.
This report was written by niceeval 0.12.0 with results schema 3,
but this viewer supports schema 0-1.

Try:
  npx niceeval@0.12.0 view .niceeval/2026-07-02T03-10-24-123Z/summary.json
  pnpm dlx niceeval@0.12.0 view .niceeval/2026-07-02T03-10-24-123Z/summary.json

If you no longer need historical reports:
  niceeval clean
```

如果 `producer.version` 缺失,文案退化成「upgrade niceeval」或「try an older niceeval matching when the report was created」,不要编造版本号。

### 迁移策略

默认不做隐式迁移。理由:

- eval 结果是审计材料,原地改写会让「当时到底写出了什么」变模糊。
- view 是读工具,不应该因为用户想看报告而修改 `.niceeval/`。
- 大多数版本不需要迁移:新增字段、未知 artifact、UI 展示变化都可以通过兼容 loader 解决。

真正需要迁移时再加显式命令,并且默认写到新目录:

```sh
niceeval migrate-results .niceeval/<old-run>/summary.json --out .niceeval/<new-run>/
```

迁移命令只解决「旧格式还能确定转换到新格式」的情况;如果某份报告依赖旧版本 view 的展示逻辑,更好的建议仍然是:

```sh
npx niceeval@<producer.version> view .niceeval/<run>/summary.json
```

`niceeval clean` 不是迁移工具,只负责删除当前项目的历史运行结果。它适合用户明确表示「旧报告不要了,只想让 view 干净」的场景;不应该在 view 报错时自动执行。

## 现状(已实现)

- **三个 tab**:Experiments(按 `experimentId` 聚合的对比榜单,`GroupSelector` 选组、`ExperimentTable` 展示同组内配置并排,点开一行钻到 eval / attempt 级明细)、Runs(所有 run 打平成一张表)、Traces(trace 瀑布图)。
- **运行总览指标** —— pass / fail / error / skip 计数、总 token、总 $。
- **eval attempt 钻取** —— `AttemptModal` 点开单个 attempt 看断言、错误、耗时、用量、transcript、trace。
- **trace 瀑布图** —— 把 `trace.json` 画成时间轴瀑布,只读 canonical(`gen_ai.operation.name` → `kind`、`gen_ai.*`),不认任何原生 span 名,所以不同 agent 的图天然对齐、可叠加对比。
- **Copy fix prompt(学 Next.js 16.3 的 Copy prompt)** —— 榜单右上角把全部失败(含工件路径与修复步骤)打包成可直接粘给 coding agent 的英文修复 prompt;`AttemptModal` 头部有单条版。实现在 `src/view/app/components/CopyControls.tsx` 的 `buildFixPrompt`。

## 已知的文档 vs 实现差异

这两条之前被 [Observability](observability.md) 的能力列表当成已实现的写了,这次审查代码(`src/view/index.ts`、`src/view/app/`)发现对不上,已经从那边挪过来,归到下面「计划中」:

- **"跨运行趋势"实际是合并,不是可对比的历史。** 旧 `aggregateRows` 把 `.niceeval/` 下**所有**历史 `summary.json` 按 `experimentId` 揉进同一行——通过率、平均耗时、成本都是跨全部历史 run 的累计值。**已修(2026-07,统计层收编)**:`aggregateRows` 已删,榜单改为 `results.latest()` 选集 + 官方计算函数(每个实验最新一次快照,跨快照累计处经 `dedupeAttempts` 去重),历史快照身份保留在 `viewData.snapshots` 里供 Runs / Traces 与后续 Compare 使用,见[用 Reports 积木重建 view](#用-reports-积木重建-view设计提案)。
- **"质量 × 成本散点图"没有实现。** `src/view/app` 下没有任何图表 / scatter / canvas 组件,现有可视化都是表格和文字指标。

## 外部参考

### agent-eval playground

**是什么:** Vercel `agent-eval` 项目下的 `packages/playground`,发布为 `@vercel/agent-eval-playground`。一个独立的 Next.js web 应用,`npx @vercel/agent-eval-playground` 直接跑,提供 `/`(总览)、`/experiments`、`/experiments/[name]/[timestamp]`、`/evals`、`/evals/[name]`、`/compare`、`/transcript/[...]` 几个路由。零数据库、零 API 路由——所有页面是 Server Component,`force-dynamic`,每次请求都现读 fs,永远是盘上最新数据。

**怎么做的:**

- `bin.mjs` 解析 `--results-dir` / `--evals-dir` / `--port` 几个 flag,resolve 成绝对路径塞进 `RESULTS_DIR` / `EVALS_DIR` 环境变量,再 `spawn` 包自带的 `next start -p <port>`(注意:README 写的是 `next dev`,实际跑的是 production 的 `next start`)。
- `lib/data.ts` 是所有数据读取的唯一入口,纯 `fs.readdirSync`/`readFileSync`,没有缓存也没有数据库:
  - `listExperiments`/`getExperiment` 递归 walk `results/` 目录树,遇到子目录名匹配 ISO 时间戳(`/^\d{4}-\d{2}-\d{2}T/`)就判定它的父目录是一个 experiment、这些时间戳目录就是它的历史 run 列表。
  - `getExperimentDetail(name, timestamp)` 在某次 run 目录下再递归找带 `summary.json` 的子目录(= 一个 eval 的结果),读 `summary.json` + 每个 `run-N/result.json`。
  - `listEvals`/`getEvalDetail` 递归 walk `evals/` 目录,遇到带 `PROMPT.md` 的目录就判定是一个 eval fixture。
- `/compare`(`components/ComparePage.tsx`,client component)两个下拉框选"某个 experiment 的某次 run",候选项和对应的完整 `ExperimentDetail` 都由服务端预先读好、一次性传给客户端(不是选中后才 fetch)。选中两边后纯前端算 delta:整体 `avgPassRate`/`avgDuration` 对两边的 `evals[]` 取平均相减;per-eval 按 eval name 取并集,逐行对比 `passRate`/`meanDuration`,delta 用颜色区分涨跌。
- **关键点:** "能任意选两次运行对比"完全建立在**目录结构天然保留时间戳身份**上——`results/<experiment>/<ISO-timestamp>/` 从不合并,每次 run 落一个新目录,`getExperiment` 返回的 `timestamps: string[]` 就是完整历史列表,`/compare` 只是在这份现成的列表上做了个下拉选择器 + 前端减法。

**跟 niceeval 的差异(为什么不能直接照搬这套形状):** playground 是多页面、每次请求都读 fs 的 live Next server;niceeval `view` 是一次性烘焙进单个 HTML+JSON 的静态产物(见上文"架构上"一段)。playground 靠"存储层本来就是每次 run 一个新目录"天然拿到历史身份;niceeval 当时的 `aggregateRows` 反而是**主动把**同一个 `experimentId` 的所有历史 run **合并**成一行(见上文"已知的文档 vs 实现差异",2026-07 已收编修正)。所以 niceeval 要做 Compare,抄的是"保留快照身份、不要提前合并"这个**原则**,不是 playground 的目录结构或 API 形状——数据仍然得在生成 HTML 那一刻就把所有候选快照的统计算好塞进 `viewData`,不能假设前端能像 playground 一样随时再去问 fs。

调研时更完整的"抄了什么 / 为什么不抄"决策记录见 [References](references.md#vercel-agent-eval--packagesplayground)。

## 计划中的小功能

### 结果版本提示与跳过列表(已实现,2026-07 收编进 results lib)

按合流路线落地,不再是 view 的专项:

1. `openResults` 返回 `skipped`(三种原因:incompatible-version / malformed / incomplete),带 `schemaVersion` 与**完整** `producer`。
2. 目录入口继续渲染已成功读取的 run,页面顶部横幅逐条展示 skipped:`producer.name === "niceeval"` 时给 `npx niceeval@<version> view` 命令,第三方 harness 如实报名字版本、不拼 npx([Results Lib 的裁决](results-lib.md#读openresults))。
3. 单文件入口遇到不兼容 schema 时直接退出,打印上文的 `npx niceeval@... view ...` 建议(`src/view/data.ts` 的 `IncompatibleResultsError`)。

这比一开始就做 migration 更实际:多数用户只是想看当前报告;旧报告读不了时,用写出它的旧版本 viewer 打开比自动转换更可控。

### Compare —— 挑两次运行对比

跟 `experiments/compare/`(文档里"一组可对比实验"的示例文件夹名,见 [Experiments](experiments.md#实验怎么组织文件夹--一组可对比的实验))是两回事,别混——这里指 view 里一个新增的小 tab。

**动机:** 上面"已知的文档 vs 实现差异"提到的问题——现在选不出"这次 vs 上次",只有累计历史。参考对象是上面[外部参考](#agent-eval-playground)里的 playground `/compare` 页。

**数据模型:** 现有的 `rows`(累计视图)继续服务 Experiments / Runs / Traces 三个 tab——"这个 agent 整体现在什么水平"仍然是合并全部历史更有用的默认视图,不动它的语义。新增一份**不合并**的快照列表,按 `(experimentId, startedAt)` 索引,每个快照携带该次 run 里这个 experiment 的 eval 级统计(复用 `evalLevelStats` 的输出形状)。这份数据随 `viewData` 一起烘焙进静态 HTML(不像 playground 能按需查 fs)。

**UI:** 在 `src/view/app/App.tsx` 的 `navItems` 加一个 `compare`。两个下拉选"快照"(`experimentId @ startedAt`),不限制两边必须是同一个 `experimentId`;选完出整体通过率 / 平均耗时 / 总成本三个 KPI delta,加一张 per-eval 并排表(复用现成的 `outcomeOf` / `formatPercent` / `formatDuration` / `formatCost`)。只跑过一次、没有历史快照时,下拉只有一项,提示"再跑一次才能对比",不报错。

**明确不做的:** 不做时间序列折线图(历史快照一多不适合塞进单个静态 HTML,而且这次要补的是"挑两点"这个最小能力);不改 Experiments tab 现有的"累计历史"默认语义(这是另一个值得讨论的问题,不在这次一起改)。

实现形态已并入[用 Reports 积木重建 view](#用-reports-积木重建-view设计提案):两个下拉选快照的数据模型照本节,表格与 delta 单元直接用 Reports 的组件。

### 质量 × 成本散点图

之前文档写过、实际没做。没有具体设计,先记一句:每个 eval(或每个 agent)一个点,一眼看出"贵且不准"的角落——值得补,但优先级低于 Compare。点位与轴向的契约不用另起炉灶:[Reports 提案](reports.md#计算函数与数据契约)的 `scatter()` / `MetricScatter` 已经钉了「点 = 维度分组的聚合、系列连线、轴向随 better(右上恒为好)」,view 落地时直接吃同一份 `ScatterData`。

### Eval 目录页

独立于"跑过的结果",单纯浏览 `evals/` 目录下每个 fixture 的 `PROMPT.md` 和文件列表,不用先跑一次才能看"有哪些 eval、prompt 写的什么"(learnings 见 [References](references.md#vercel-agent-eval--packagesplayground))。没有具体设计,优先级低于 Compare。

## 用 Reports 积木重建 view(设计提案)

> 状态:迁移中。依赖的两个提案已落地(results 读取面、report 计算与组件,见 [Source Map](source-map.md#results-lib-与-reports));三步迁移中**读取层与统计层已完成(2026-07)**——view 的 loader 收编进 `openResults`,`aggregateRows` 删掉,`__NICEEVAL_VIEW_DATA__` 换成官方数据契约(OverviewData / TableData + 快照元信息 + skipped / warnings,声明在 `src/view/shared/types.ts`);**`--report` 报告槽已接线(2026-07)**——报告树在计算侧 `renderReportToStaticHtml` 成静态 HTML,以 `<template id="niceeval-report">` 静态块烘在 `__NICEEVAL_VIEW_DATA__` 旁,前端只摆放不解析;dev server 每次请求现读现渲染,报告文件变更下次请求整页重算(装载走 mtime cache-busting,`src/report/load.ts`);`--out` 时报告页即首页报告槽、证据室同站。渲染层其余部分(默认榜单换 `MetricTable` 组件、scatter、Compare)未动。

[Reports](reports.md) 把「自己搭报告页」拆成组件 + 计算函数 + 结果库三种零件之后,view 的正确定位随之改变:**view 不再是一套并行实现,而是用同一批零件搭出来的「默认报告页 + 证据室」**——用户搭页面用什么零件,view 自己就用什么。view 因此成为这套积木的第一个常驻消费者,组件与计算函数的正确性被它天天验证;反过来,上面「计划中的小功能」里的三件事(跳过列表、Compare、散点图)也全部退化成「拼现成积木」,不再是专项开发。

逐层替换:

| view 今天 | 合流后 | 顺带兑现 |
|---|---|---|
| `loadSummaries` / `readSummary`,版本判定散在 loader | [`openResults`](results-lib.md#读openresults) | 「结果版本提示与跳过列表」= 渲染 `results.skipped`,不再专门做;计划中的 normalize 层就是 results lib |
| `aggregateRows` 把全部历史揉成一行 | 选择器 + 计算函数(`RunOverview.data` / `MetricTable.data(rows: "experiment")`) | 跨快照去重白捡——`--resume` 合入结果被重复计数的问题顺带修掉;「累计 vs 最新」从 loader 的既成事实变成 UI 上可切换的两次显式调用 |
| `ExperimentTable` / Runs 表 / 总览指标(自绘) | `MetricTable` / `RunOverview` | 覆盖率角标、缺数据渲染、better 排序这些诚实细节自动继承 |
| 质量 × 成本散点图(计划中,没做) | `MetricScatter` | 见上节 |
| Compare(计划中,没做) | 两个下拉选快照 + 时间轴 `DeltaTable` 变体 | Reports 待定的「时间轴 delta」在 view 首发,两边永远同一套「对比」语义 |
| AttemptModal / Traces 瀑布 / 导航壳 | **保留,这是 view 的本体** | 证据室:transcript、断言、代码视图、trace 瀑布——报告积木不重造它们 |

导出机制同样合流:

- `view --out <目录>` 的工件复制换成 [`copySnapshots`](results-lib.md#复制与瘦身copysnapshots)(sources/events/trace,diff/o11y 照旧不带);单文件导出已整个移除(见上文「静态导出」的移除记录),合流时不必再背这个形态。
- 烘进 HTML 的 `__NICEEVAL_VIEW_DATA__` 从私有 rows 换成**官方数据契约**(OverviewData / TableData / ScatterData + 快照元信息)。外部脚本从此没有理由扒 HTML——coding-agent-memory-evals 曾用字符串标记从 index.html 里抠内嵌 JSON、再正则消毒构建机路径,那类 hack 的存在本身就是数据契约缺位的证据;但内嵌数据仍不是承诺的持久化格式,要数据走 [Reports 场景三](reports.md#dx-模拟)自己算。
- 补 `#/attempt/<run>/<result>` 路由,路由参数就是 `AttemptRef`——报告页(前门)与 view(证据室)靠同一个身份契约打通,`attemptHref` 从此有确定的去处(对应 [Reports 迭代问题裁决记录](reports.md#迭代问题裁决记录)第 5 条)。**已实现**:`src/view/app/lib/attempt-route.ts` + `App.tsx` 接线,loader 的 `withViewRefs` 给每条 result 注入 `attemptRef`;旧 `?modal=` 参数保留为只读回退。

迁移顺序即依赖顺序,每步独立可交付:

1. **换读取层。**(已完成,2026-07)results lib 落地,view 的 loader 删掉,skipped 列表 UI 直接上——行为中立的重构,外加诚实增强(三种原因、producer 感知的提示)。
2. **换统计层。**(已完成,2026-07)计算函数落地,`aggregateRows` 删掉;榜单数字因「latest 口径 + 去重」而变(变得更对),在 changelog 里明说。选集 warnings(partial-coverage / stale-snapshot / synthetic-experiment-id)经 `OverviewData.warnings` 进前端横幅,`data-kind` 标注。
3. **换渲染层 + 补两个 tab。** 榜单换 `MetricTable`,新增 scatter,Compare 以时间轴 delta 首发;AttemptModal / Traces 原样保留。

界线(2026-07 更新,原表述「固定摆法、想换摆法去写自己的页面」被宿主化提案精确化):**view = 报告槽 + 证据室**。报告槽默认装内置默认报告——它没有特权,就是 `Report` 契约的出厂预设,作为值(`defaultReport`)公开导出;`niceeval view --report <文件>` 整槽替换,用户在自己的报告里 spread `defaultReport` 即可「官方水位 + 自己口径」,不做 tab 管理、不做注册表,详见 [Reports · 宿主化报告](reports.md)。证据室(AttemptModal / Traces / 导航壳)是 view 本体,报告块经 `attemptRef` 深链进来。view 仍不长配置、不长插件——报告文件是显式路径递进来的宿主语言模块,不是插件;要自己的 React 组件,宿主仍是你自己的页面([Reports](reports.md)),零件是同一批。

## 相关阅读

- [Observability](observability.md#结果可视化niceeval-view) —— 事件流、trace、usage/cost 这些 view 渲染的数据从哪来。
- [Results Format](results-format.md) —— view 读取的 `.niceeval/<run>/summary.json` 与 attempt 级 JSON 工件。
- [References](references.md#vercel-agent-eval--packagesplayground) —— 这次调研 agent-eval playground 的完整记录。
- [Experiments](experiments.md) —— `experimentId`、可对比组、`niceeval exp` 怎么产生这些历史快照。
