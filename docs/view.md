# View —— 本地结果查看器(`niceeval view`)

控制台是「当下」的;`niceeval view` 是「事后看图」——不连任何外部服务,只读 `.niceeval/<experiment>/<快照>/` 下的 `snapshot.json` 与逐 attempt `result.json` 这些结构化 artifact。结果保存格式见 [Results Format](results-format.md),数据来源见 [Observability](observability.md#结果可视化niceeval-view)。

```sh
niceeval view                         # 起本地 web,自动打开浏览器,读 .niceeval/ 下所有历史运行
niceeval view .niceeval/<experiment>/<快照>/snapshot.json    # 单文件模式:只看这一份快照
niceeval view weather                 # 位置参数 = eval id 前缀,收窄报告槽 Selection(与 show 同语义)
niceeval view --run site-data/run     # 结果目录经 --run 递入;--experiment <id> 只看该实验
niceeval view --report reports/exam.tsx       # 报告槽整槽换成自定义报告(与 show 同一文件)
niceeval view --no-open               # 只打印 URL,不打开浏览器
niceeval view --out site              # 目录式静态导出:index.html + artifact/
```

位置参数的判定:指向存在的文件 → 单文件模式(不与 `--run` 或其它位置参数混用);指向存在的目录 → 报错直说走 `--run`;其余按 eval id 前缀。收窄只作用于报告槽(注入报告的 Selection;默认报告的散点与实验表随之收窄),证据室数据恒为全量,attempt 深链在任何收窄下都可达。

架构上是**一次性烘焙进单个 HTML+JSON 的静态产物**(`src/view/index.ts` 的 `renderHtml`),不是常驻的多页面 server——`niceeval view` 起的 web 服务每次请求现读现渲染,`--out` 则直接导出。这是刻意的取舍,详见 [References](references.md#调研过判断不值得抄的及理由)。

`--out` 只有目录式一种形态:写 `<out>/index.html`,并把前端会 fetch 的三类 artifact(`sources.json` / `events.json` / `trace.json`)复制到 `<out>/artifact/<base>/`,与本地 server 的 `/artifact/<rel>` 路径路由同一布局,同一份前端产物在两种托管下用同一个相对 URL(`src/view/app/lib/artifact-url.ts`)。`diff.json` / `o11y.json` 刻意不复制:查看器从不读取,且 diff 可达上百 MB,带上只会拖垮静态部署体积。

零可读结果(目录真空,或全部落盘被 skipped)时 `loadViewScan` 抛 `ViewInputError`:本地 server 起不来,`--out` 非零退出、不导出空页面——与 show 的「匹配不到直说」同一原则,同时是 CI 静态发布的守卫(构建失败让托管平台保留上一次部署,空报告不顶上线)。错误逐条列 skipped 目录与原因,niceeval 落盘的 schemaVersion 场景拼出可跑的 `npx niceeval@<版本> view` 命令(`src/view/data.ts` 的 `noReadableResults`)。

> 发布口径裁决(2026-07-10):发布的站与本地 view 完全一致(所见即所发),不设 `--latest` 之类的发布收窄 flag——结果既已提交进仓库,历史体积成本已被接受,导出再收窄只会让线上站 ≠ 本地站、平添第二种导出语义;发布策划过的 Selection 属于 `copySnapshots` 积木(宿主语言挑选,`view --run` 对着产物看)。公开文档的 CI 发布页(`docs-site/zh/guides/publish-report.mdx`)因此只有一种姿势:`.niceeval/` 提交进仓库(gitignore 排除 `diff.json`)+ `view --out` 一行构建命令,可叠 `--report` 发布自定义报告。曾评估过「本地 copySnapshots 固化结果快照提交、CI 只导出」的第二姿势,已否:平添第二个真相源,发布依赖人记得跑本地脚本,站点会静默过期。

> 单文件导出(`--out report.html`)曾经存在,已移除:代码/transcript/trace 视图依赖 artifact 文件,单文件注定是残缺体验,而 coding eval 恰恰最依赖这些视图——这个形态的存在本身就在诱导用户导出一份看不了证据的报告。「传一个文件给同事」的需求,答案是把整站导出托管起来发链接,或用 [Reports](reports.md) 积木在 CI 里落判定数据。`--out` 目标以 `.html` 结尾时 CLI 直接报错并给出改法。

## 结果版本机制

`niceeval view` 读取的是已经落盘的快照,而快照会比 CLI 活得更久:用户可能几个月后打开某个快照的 `snapshot.json`,也可能把 CI 产物下载到另一台机器上看。所以 view 的版本策略要优先保证两件事:

1. 新版本 CLI 不轻易丢下旧快照。
2. 真读不了时,错误信息要告诉用户「该用哪个版本看」或「这份历史结果可以删掉」。

具体设计:

- **快照自己带版本。** `snapshot.json` 顶层放 `format: "niceeval.results"`、`schemaVersion` 和 `producer.version`,设计见 [Results Format · 版本与升级设计](results-format.md#版本与升级设计)。历史版本(schemaVersion ≤ 3)把这三个字段放在 run 级 `summary.json` 顶层,读取器据此识别旧落盘;没有 `format` 字段、也不满足 legacy 的 `results[]` + `startedAt` 启发式的,当作无关 JSON 忽略。
- **版本判定只有一份实现。** 版本判定与形状校验住在 `niceeval/results`(`src/results/format.ts` 的 `classifySummary`),view 经 `openResults` 消费,不自带 loader 常量,更不散落在 React 组件里。
- **先分类,再渲染。** 磁盘 JSON 经 `openResults` 分流:能读的成为快照层次,读不了的进 `skipped`(三种原因);前端组件只吃 `viewData` 的快照明细与 skipped 条目,统计口径住在报告槽里。
- **未知字段不是错误。** 新增 `git`、`environment`、`agentSetup`、`classification` 等字段时,旧 view 可以忽略;新增 artifact kind 也只是不展示。只有必需字段缺失、字段类型错误、或 `schemaVersion` 超出支持区间才算版本/格式错误。

### 报错与降级

`view` 有两种入口,错误处理不同:

- **读整个 `.niceeval/` 目录。** 遇到某个快照读不了,不要让整个页面失败。目录扫描收集 `skipped`(三种原因:incompatible-version / malformed / incomplete),继续渲染其它快照,并在页面顶部显示一条可展开提示:哪些快照被跳过、原因是什么、建议怎么处理。
- **读单个 `snapshot.json`。** 这是用户明确指定的目标,读不了就应该让命令失败,打印可执行的下一步,不要打开一个空页面。

错误分类:

| 场景 | 行为 | 文案要点 |
|---|---|---|
| 没有 `format` 字段,也不满足 legacy 的 `results[]` + `startedAt` 启发式 | 当作无关 JSON 忽略 | 不出现在 skipped 列表里 |
| `format` 是 `"niceeval.results"` 但 `schemaVersion` 不同(含历史版本的 run 级 `summary.json`) | 跳过,标为 incompatible-version | 拼出 `npx niceeval@<producer.version> view <目录>` 命令 |
| `snapshot.json` 是坏 JSON,或必需字段类型错误 | 跳过,标为 malformed | 说明快照可能损坏,给出文件路径 |
| 有 attempt 落盘、没有 `snapshot.json` | 跳过,标为 incomplete | 说明快照元数据没写完(进程中断或人为删文件) |
| attempt artifact 缺失,例如 `events.json` 不存在 | 页面仍可打开 | 只在展开该 attempt 时显示「artifact missing」 |

命令行错误要给到具体命令,例如:

```text
⚠ .niceeval/2026-07-10T08-00-00-000Z: written by niceeval 0.4.6 (schemaVersion 3);
  this CLI reads schemaVersion 4.
  Run `npx niceeval@0.4.6 view .niceeval/2026-07-10T08-00-00-000Z` to view it.
```

单文件模式指向版本不同的 `snapshot.json` 时输出同样的提示后退出,而不是报「不是 niceeval 结果」。如果 `producer.version` 缺失,文案退化成「upgrade niceeval」或「try an older niceeval matching when the report was created」,不要编造版本号。

**这套版本机制是 results 层的通用能力,不是 view 专属。** `niceeval show` 裸跑零可读结果时,`skipped` 目录同样按上表分类展示;niceeval 自己写的、schemaVersion 不兼容的部分额外给出可执行建议——但 `show` 没有 view 的单快照直读模式,`--run` 认的是结果根(其下可以有多个 experiment,不是单个快照目录),所以不对每份落盘各拼一条命令,而是按 `producer.version` 分组、每组一条 `npx niceeval@<version> show --run <结果根>`,同版本的多份快照合并成一行,不重复刷屏。分组实现在中性层(`src/results/skipped-notice.ts` 的 `groupIncompatibleVersionSkips`),`show` 侧文案在 `src/show/render.ts` 的 `skippedRunsText`,`view` 侧文案(逐条给出,因为 view 支持精确打开某一份快照)仍是 `src/view/data.ts` 的 `noReadableResults`。

版本不匹配没有隐式迁移:eval 结果是审计材料,原地改写会让「当时到底写出了什么」变模糊,view 是读工具,不应该因为想看结果而修改 `.niceeval/`。`niceeval clean` 也不是迁移工具,只负责删除当前项目的历史运行结果——适合用户明确表示「旧结果不要了,只想让 view 干净」的场景,不在 view 报错时自动执行。

## 现状

> 状态:证据室(Runs / Traces / `AttemptModal` / trace 瀑布图 / Copy fix prompt / 横幅)与报告槽默认组件(`ExperimentList` + `AttemptLocator`,见下文「用 Reports 积木重建 view」)都是当前已实现行为。报告槽渲染出的 `#/attempt/@<locator>` 深链与证据室自己的 attempt 路由(`src/view/app/lib/attempt-route.ts` 与 `AttemptModal`)消费同一套单段、不透明 `AttemptLocator` 路由,报告槽里的数字点开即落地进证据室弹窗。

view = **报告槽 + 证据室**:

- **报告槽(首页)**:由 `renderReportToStaticHtml` 渲染。默认报告 `CostPassRateComparison` 跨整个 Selection 摆一张成本 × 通过率 `MetricScatter`,下面是一份 `ExperimentList`;实验项展开到 Eval,再经证据引用进入 Attempt。默认报告不分组,不含 `RunOverview` / `GroupSummary` / `EvalList` / `AttemptList`。自定义报告可对三个实体列表的 `.data(selection)` 返回数组自行 `.filter()` / `.slice()` 后再传 `items`。`--report <文件>` 整槽替换。
- **证据室**:Runs(所有 run 打平成一张表)、Traces(trace 瀑布图)两个 tab,加 `AttemptModal` 钻取(断言、错误、耗时、用量、transcript、trace)。报告槽里的数字经 `#/attempt/@<locator>` 深链进来,`<locator>` 是不透明的、at 符号前缀的 `AttemptLocator` 短码;证据室数据恒为全量,不随位置参数收窄。
- **trace 瀑布图** —— 把 `trace.json` 画成时间轴瀑布,只读 canonical(`gen_ai.operation.name` → `kind`、`gen_ai.*`),不认任何原生 span 名,所以不同 agent 的图天然对齐、可叠加对比。
- **Copy fix prompt(学 Next.js 16.3 的 Copy prompt)** —— 宿主壳里、报告槽上方的批量按钮:把全部失败(含 artifact 路径与修复步骤)打包成可直接粘给 coding agent 的英文修复 prompt,从 `viewData.snapshots` 现算,所以默认报告与 `--report` 两种填充下都在;`AttemptModal` 头部有单条版。实现在 `src/view/app/components/CopyControls.tsx` 的 `buildFixPrompt`。
- **横幅**:两类横幅各有唯一出口。skipped run 横幅在壳(读不了的落盘,与 Selection 无关)。Selection 的挑选警告(partial-coverage / stale-snapshot / unfinished-snapshot 及任何未来的按实验警告)由宿主渲染入口(view 的 `renderReportToStaticHtml`、show 的 `renderReportToText`)在报告树输出之前自动前置一条警告横幅——这是宿主级保证,与报告树里有没有 `RunOverview` 无关,任何报告(内置或自定义)渲染时都得到同一条横幅。内置默认报告 `CostPassRateComparison` 不含 `RunOverview`,靠这条宿主级横幅让 `Selection.warnings` 一份不落地出现在报告槽,警告仍只有一个出口。

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

**跟 niceeval 的差异(为什么不能直接照搬这套形状):** playground 是多页面、每次请求都读 fs 的 live Next server;niceeval `view` 是一次性烘焙进单个 HTML+JSON 的静态产物(见上文"架构上"一段)。playground 靠"存储层本来就是每次 run 一个新目录"天然拿到历史身份;niceeval 调研当时的 `aggregateRows` 反而是**主动把**同一个 `experimentId` 的所有历史 run **合并**成一行(统计层收编时已修:报告槽改为现刻水位 Selection(`selectCurrentResults`)+ 官方计算函数,历史快照身份保留在 `viewData.snapshots`)。所以 niceeval 要做 Compare,抄的是"保留快照身份、不要提前合并"这个**原则**,不是 playground 的目录结构或 API 形状——数据仍然得在生成 HTML 那一刻就把所有候选快照的统计算好塞进 `viewData`,不能假设前端能像 playground 一样随时再去问 fs。

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

**动机:** 报告槽的默认口径是「现刻水位」(对每个实验、每个 eval,从该实验的历史快照里取最新一次判定,跨快照补齐成一份),选不出"这次 vs 上次"。参考对象是上面[外部参考](#agent-eval-playground)里的 playground `/compare` 页。

**数据模型:** `viewData.snapshots` 已经是**不合并**的快照列表,按 `(experimentId, startedAt)` 索引,每个快照携带 attempt 明细——Compare 需要的历史身份现成保留着。这份数据随 `viewData` 一起烘焙进静态 HTML(不像 playground 能按需查 fs)。

**UI:** 在 `src/view/app/App.tsx` 的 `navItems` 加一个 `compare`。两个下拉选"快照"(`experimentId @ startedAt`,与 Reports 的快照键、`"snapshot"` 维度同一格式),不限制两边必须是同一个 `experimentId`;选完出整体通过率 / 平均耗时 / 总成本三个 KPI delta,加一张 per-eval 并排表,表格与 delta 单元直接用 Reports 的 `DeltaTable`(时间轴对比走快照键,见 [Reports 迭代问题裁决记录](reports.md#迭代问题裁决记录)第 1 条)。只跑过一次、没有历史快照时,下拉只有一项,提示"再跑一次才能对比",不报错。

**明确不做的:** 不做时间序列折线图(历史快照一多不适合塞进单个静态 HTML,而且这次要补的是"挑两点"这个最小能力);不改报告槽「现刻水位」的默认口径。

### Eval 目录页

独立于"跑过的结果",单纯浏览 `evals/` 目录下每个 fixture 的 `PROMPT.md` 和文件列表,不用先跑一次才能看"有哪些 eval、prompt 写的什么"(learnings 见 [References](references.md#vercel-agent-eval--packagesplayground))。没有具体设计,优先级低于 Compare。

## 用 Reports 积木重建 view

> 状态:读取层、渲染层与报告槽已实现(`openResults` 版本分流、`renderReportToStaticHtml` 静态渲染、`defineComponent` 的 web/text 双面,源码入口见 [Source Map](source-map.md#results-lib-与-reports));默认报告已换成 `ExperimentList` / `EvalList` / `AttemptList` 三级实体列表,报告槽渲染出的深链与证据室自己的 attempt 路由(`src/view/app/lib/attempt-route.ts`、`AttemptModal`)都是本节描述的 `#/attempt/@<locator>` 单段格式,两侧消费同一套不透明 `AttemptLocator` 契约。仍在计划的还有 Compare(见上节)与 memory-evals 的静态导出流水线([Reports 场景三](reports.md#dx-模拟))。

[Reports](reports.md) 把「自己搭报告页」拆成组件 + 计算函数 + 结果库三种零件之后,view 的定位是:**不是一套并行实现,而是用同一批零件搭出来的「默认报告页 + 证据室」**——用户搭页面用什么零件,view 自己就用什么。view 因此是这套积木的第一个常驻消费者,组件与计算函数的正确性被它天天验证。

分层职责:

| 层 | 实现 |
|---|---|
| 读取层 | [`openResults`](results-lib.md#读openresults):版本分流与形状校验,读不了的落盘进 `skipped`(三种原因),壳渲染成横幅 |
| 统计层 | 全部住在报告槽里:默认报告摆 `MetricScatter` 与 `ExperimentList`;散点可走 selection-form,实验列表由 `ExperimentList.data(selection)` 生成数组后传 `items`;口径是两个宿主共同注入的现刻水位 Selection |
| 渲染层 | 报告槽 = `renderReportToStaticHtml` 的静态 HTML(宿主前置的 `Selection.warnings` 横幅 + 官方组件 web 面 + 渐进增强 runtime + styles.css 内联);前端 React app 只承担证据室与壳(导航、界面语言、修复 prompt 按钮、skipped 横幅) |
| 证据室 | AttemptModal / Traces / Runs / 导航壳——view 的本体,报告积木不重造它们 |

数据与路由契约:

- `__NICEEVAL_VIEW_DATA__`(声明在 `src/view/shared/types.ts`)只携带证据室与壳需要的东西:快照明细(`snapshots`,含 attempt locator / artifact 基址)、`skippedRuns`、项目名与 run 元信息。**不携带 overview / 榜单这类统计产物**——统计口径整体住在报告槽的 HTML 里,报告槽自己算,壳与报告之间没有第二条数据通道。内嵌数据不是承诺的持久化格式,要数据走 [Reports 场景三](reports.md#dx-模拟)自己算——coding-agent-memory-evals 曾用字符串标记从 index.html 里抠内嵌 JSON、再正则消毒构建机路径,那类 hack 的存在本身就是数据契约缺位的证据。
- `#/attempt/@<locator>` 路由,路由参数是不透明的 `AttemptLocator`——at 符号前缀的短确定性编码,由 `{experimentId, 快照 startedAt, evalId, attempt 下标}` 这个不可变元组派生,从不编码快照目录名或数组下标。报告页(前门)与 view(证据室)靠同一个 locator 身份契约打通:reader 打开结果根时建立 locator → AttemptHandle 索引,`ctx.attemptHref(locator)` 落到这条路由;locator 缺失、畸形或撞车是结构化错误,从不回退成「随便挑一个」。旧 `?modal=` 参数保留为只读回退。
- dev server 每次请求现读现渲染,报告文件变更下次请求整页重算(装载走 mtime cache-busting,`src/report/load.ts`);`--out` 时报告页即首页,证据室同站。

明确裁决的取舍(是裁决,不是缺口):

- **实体钻取由三级列表承接。** `ExperimentList`、`EvalList`、`AttemptList` 分别固定展示 experiment、experiment × Eval、Attempt;`.data(selection)` 返回普通数组,作者过滤后传 `items`。`MetricTable` 只负责任意维度 × 指标,没有实体展开职责。
- **跨块全局搜索不做。** 过滤是每张表自己的 filter 框(渐进增强的浏览态);要固定口径的收窄,用位置参数前缀或自定义报告的计算参数。
- **「一次看一组」不迁移。** 内置默认报告是跨整个 Selection 的一张散点加一张实验表,不按实验组分节;只想看一组时用位置参数前缀收窄 Selection,不做组选择器这类界面状态(需要分组分节的报告用自定义 `--report`,`Section` / `GroupSummary` 仍是可用组件)。

界线:**view = 报告槽 + 证据室**。报告槽默认装 `CostPassRateComparison`;自定义报告可复用 `MetricScatter` / `ExperimentList` 或另摆 Eval、Attempt 列表。证据室仍由 Attempt 引用深链进入,view 不长列表过滤配置。

## 相关阅读

- [Observability](observability.md#结果可视化niceeval-view) —— 事件流、trace、usage/cost 这些 view 渲染的数据从哪来。
- [Results Format](results-format.md) —— view 读取的快照 `snapshot.json` 与 attempt 级 `result.json` / JSON artifact。
- [References](references.md#vercel-agent-eval--packagesplayground) —— 这次调研 agent-eval playground 的完整记录。
- [Experiments](experiments.md) —— `experimentId`、可对比组、`niceeval exp` 怎么产生这些历史快照。
