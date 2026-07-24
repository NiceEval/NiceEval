# References —— 从其它项目学到什么

已经落地的借鉴大多分散记在各篇文档自己的"来源"脚注里(比如 [README](README.md) 的整体形状借鉴、[Scoring 来源](feature/scoring/reference/provenance.md) 里的评分设计来源、[experiments/architecture.md](feature/experiments/architecture.md#设计参照从-agent-eval-砍掉了什么以及为什么) 里 `defineExperiment` 对照 agent-eval 的 `ExperimentConfig`)。这篇文档不重复那些,专门记录**调研某个外部项目时学到的东西**——抄了什么、还没抄但值得抄什么、调研过判断不值得抄的及理由——方便以后再研究别的项目时按同样的格式续写,也方便回头核对"这个设计当初是照着谁的形状定的"。

每次调研一个外部项目开一个二级标题,格式固定:是什么 → 已经借鉴的 → 这次新学到、值得抄的 → 调研过但不打算抄的(及理由)。

## Vercel agent-eval —— `packages/playground`

**来源路径:** `/Users/ctrdh/Code/agent-eval/packages/playground`(本机另一个项目,不在这个仓库里,记路径方便下次再核对实现有没有变)。

**是什么:** `@vercel/agent-eval-playground`,独立发布的 Next.js 结果查看器。零数据库、零 API 路由——所有页面是 Server Component,`lib/data.ts` 直接 `fs.readdirSync`/`readFileSync` 读 `results/`(实验结果)和 `evals/`(eval fixture)两个目录,`force-dynamic` 保证每次请求都读最新的盘上数据。CLI(`bin.mjs`)把目录路径塞进环境变量后 `spawn` 包内置的 `next start`。

### 已经借鉴的(更早调研,已经在别处记过来源)

`niceeval view` 本身("本地结果查看器")、sandbox / diff 的工程形状、transcript 归一化与可观测、experiment 层——这些在 [README](README.md) 和 [source-map.md](source-map.md) 里已经标了来源,这里不重复。

### 这次新学到、值得抄的

1. **`/compare`——挑两次运行对比。** playground 靠 `results/<experiment>/<ISO-timestamp>/` 天然分层的目录结构,能选任意两个时间戳的 run,对比整体通过率 / 平均耗时 / per-eval 通过率 delta。niceeval 调研时完全没有这个能力——当时的 `aggregateRows` 把所有历史 run 合并成一行,选不出"这次 vs 上次"。niceeval 把这份能力放在报告组件而不是 view 宿主:成对差异表([`DeltaTable`](feature/reports/library/metric-views.md#deltatable))按 `"snapshot"` 维度对比任意两份结果快照;不给 view 内建 Compare tab 的裁决见 [memory 条目](../memory/view-compare-tab-rejected.md)。
2. **eval fixture 目录页(`/evals`)。** 独立于"跑过的结果",单纯浏览 `evals/` 目录下每个 fixture 的 `PROMPT.md` 和文件列表,不用先跑一次才能看"有哪些 eval、prompt 写的什么"。niceeval 的 `view` 是结果驱动的,没有这种纯浏览 eval 定义的入口——记在这里备查;不做该入口的裁决见 [memory 条目](../memory/view-compare-tab-rejected.md)。
3. **"每次 run 是独立时间戳快照"这个数据原则。** playground 的 `getExperiment` 保留 `timestamps: string[]` 整个历史列表,`/compare` 就是靠这个地基做的。niceeval 要抄的是这个**原则**(不要在聚合时提前合并掉快照身份),不是照搬它的目录 / API 形状。

### 调研过、判断不值得抄的(及理由)

1. **Tool 遥测是固定的 10 项 `ToolName` 枚举** (`file_read`/`shell`/`web_fetch`/…) + Badge 计数(`O11ySummary.tsx`)。niceeval 走的是 OTel GenAI 语义约定的 canonical trace/mapper(见 [Observability](observability.md#transcript-标准事件流)),覆盖面和跨 agent 一致性都更好——这块 niceeval 已经比它强,不用倒退抄。
2. **整个架构是"每次请求都读 fs 的 Next.js 多页面 live server"。** 没有数据库、没有 API 路由,但需要一个常驻的 `next start` 进程。niceeval 的 `view` 是"一次性烘焙 HTML+JSON 静态产物"(`src/view/index.ts` 的 `renderHtml`),导出目录扔给任何静态托管就能看,不需要常驻进程。这是刻意的取舍,不打算改成常驻多页应用——如果要抄 `/compare`,数据仍然要在生成 HTML 时一次性烘焙进去,不能假设前端能随时再查 fs。
3. **`bin.mjs` 的 `--watch` flag。** 只把 `WATCH=true` 塞进环境变量,代码里没有看到被消费的地方,像是半成品,没必要照抄这个具体实现。

## Recharts

**来源:** [recharts.github.io](https://recharts.github.io/en-US/)、`recharts/recharts` GitHub README(经站点调研,未在本仓库留存原始抓取)。

**是什么:** "A composable charting library built on React components" ——SVG 图表库,GitHub README 给出的三条原则是"用 React 组件部署""原生 SVG 支持""声明式组件,组件本身只负责呈现"。图表家族按位置分五组:Charts(`LineChart`/`BarChart`/`AreaChart`/`ComposedChart`/`PieChart`/`RadarChart`/`RadialBarChart`/`ScatterChart`/`FunnelChart`/`Treemap`/`Sankey`/`SunburstChart`)、General(`ResponsiveContainer`/`Tooltip`/`Legend`/`Label`/…)、Cartesian(`XAxis`/`YAxis`/`CartesianGrid`/`Line`/`Bar`/`Area`/`Scatter`/`Brush`/`ReferenceLine`/…)、Polar(`Pie`/`Radar`/`RadialBar`/`PolarAngleAxis`/…)、Shapes。核心组合模型:图表容器(如 `LineChart`)收 `data`(一份对象数组)与尺寸/margin,子组件(`CartesianGrid`、`XAxis`、`YAxis`、`Tooltip`、`Legend`、一个或多个 series 组件如 `Line`/`Bar`/`Area`)按声明顺序摆在容器内,每个 series 组件用 `dataKey` 从容器的共享 `data` 里取自己的字段;容器与子组件之间是显式 React context 关系,每个组件的 API 页固定列"Parent Components"(消费谁的 context,通常是 `ResponsiveContainer` 或某个图表容器)和"Child Components"(向哪些组件提供 context),子组件之间(如 `CartesianGrid`/`XAxis`/`Line`)在 API 文档层面不要求特定顺序。`ComposedChart` 允许在同一个容器里混合多种 series 类型子组件(如同一张图里 `Area`+`Bar`+`Line`)。

### 这次新学到、值得抄的

1. **子组件即配置,新增能力是"加一种子组件类型",不是给已有容器组件继续加字段。** `ComposedChart` 把 `Area`/`Bar`/`Line` 三种 series 组件混进同一张图,三种呈现分属独立组件,不是同一个容器组件靠一个 `type: "area" | "bar" | "line"` 字段切换。容器只认领固定几个概念(数据源、尺寸、margin),把"这张图要有哪些轴、哪些 series、要不要图例"整体下放给子组件列表表达。
2. **三级定制阶梯,同一个类型形状贯穿多个定制点。** `Line` 的 `dot`/`activeDot`/`label`/`shape`、`Tooltip` 的 `content`,都是同一个类型公式:`false`(关闭)→ `{ 部分属性对象 }`(轻量覆盖若干字段)→ `ReactNode | Function`(整体接管渲染)。作者按需要的定制深度选择投入层级,不必为了改一个点的描边颜色就去写一个完整的自定义渲染组件。
3. **父子 context 关系在文档里显式配对声明。** 每个组件的参考页固定给出"我消费谁的 context"与"我给哪些子组件提供 context"两条,读者不用去读实现就能知道一个子组件能不能脱离某个容器单独使用。这是个文档模式,不是 recharts 独有的实现机制——即便不采用 React context,这种"结构关系显式配对写出来"的写法值得在 niceeval 自己的图表类文档里借鉴。

### 调研过、判断不值得抄的(及理由)

1. **`ResponsiveContainer` / 容器的 `responsive` 属性靠浏览器 `ResizeObserver` 测量父元素尺寸。** `ResponsiveContainer` 的 `initialDimension` 默认 `{ width: -1, height: -1 }`,意味着首次测量完成前尺寸不确定——这与 niceeval「web 面先输出完整可读静态 HTML,响应式由 CSS 完成、不依赖 JS 测量」的不变量([Architecture · 静态网页](feature/reports/architecture.md#静态网页))冲突,直接采用会让无 JS 场景下的初始渲染不可靠。niceeval 现有的 CSS Grid + container query 减列方案不测量、不依赖 JS,做的是同一件"让图表适应容器宽度"的事,不需要倒退抄。
2. **把 `recharts` 包整体接进 niceeval 报告 web 面的渲染依赖。** recharts 是纯 SVG/DOM 组件库,没有任何 text/终端投影;niceeval 的图表类组件([`MetricScatter`](feature/reports/library/metric-views.md#metricscatter)/[`MetricLine`](feature/reports/library/metric-views.md#metricline))两面必须同源,text 面的字符坐标图/趋势线无论如何都要自己写,不会因为借了 recharts 的 web 渲染而省下这块工作——把这个包仅当"构建期 SVG 字符串生成器"(固定 viewBox、不用它的 `ResponsiveContainer`)是否划算,留给 [报告图表组合语法](roadmap/report-chart-composition/README.md) 的候选契约评估,这里只记"把它整体接成运行时依赖不划算"这条结论。
3. **动画系统、`syncId` 跨图联动 tooltip、40 余个鼠标/触摸/指针事件 prop。** 这些是浏览器交互层能力;niceeval 报告的「静态 HTML + 渐进增强」模型里,增强脚本只做排序/过滤/tooltip 这类轻量行为([不变量](feature/reports/architecture.md#静态网页)),不需要 recharts 级别的动画或跨图联动系统。

## Playwright ARIA Snapshot 与 ivya / Vitest 移植

**来源:** [playwright.dev/docs/aria-snapshots](https://playwright.dev/docs/aria-snapshots)、[Vitest Browser Mode · ARIA snapshots](https://main.vitest.dev/guide/browser/aria-snapshots)(Vitest 4.1.4+ 实验特性,底层是独立库 ivya,见 [vitest PR #9668](https://github.com/vitest-dev/vitest/pull/9668))。

**是什么:** `toMatchAriaSnapshot`——对页面**可访问性树**(不是 DOM、不是像素)做 YAML 快照断言的 DSL。节点写法 `- role "name" [attr=value]`,子节点靠缩进;`"引号"` 是空白折叠后的精确名,`/…/` 是正则,省略 name 或属性即「不关心」。匹配语义:**默认局部匹配**——模板子节点只需按序作为实际子节点的子序列出现,多出的实际节点忽略;`- /children: equal` 升级为直接子节点精确匹配,`deep-equal` 逐层精确。文本一律空白折叠(多行折成单行再比)。更新走 `--update-snapshots`(默认 patch 模式产 diff 文件)。Vitest 侧的移植 ivya 是 Playwright-independent 的 a11y 树生成 + YAML 子集解析 + 匹配三件套,输入是一个 DOM element。

### 值得抄的

1. **「默认子序列、显式升级精确」的匹配公式。** 省略即不关心 + 有序子序列 + `/children: equal|deep-equal` 三档,让一份期望天然容忍化妆性新增(加一行注解、加一个区块不打红),要锁死顺序时再显式声明。这是「断言事实而非排版」的机制化表达,对终端输出的结构断言同样适用——发明一套终端节点词表(section/table/row/tree),匹配语义逐条照抄。
2. **值的三态:精确串 / 正则 / 省略。** 同一个语法位置容纳三种严格度,写断言的人按需选,不用在「整句 includes」和「手写正则」之间二选一。
3. **HTML 面直接用现成实现,不自己发明。** Vitest 4.1.4+ 的 `toMatchAriaSnapshot` / ivya 就是这套语义的可复用实现;对导出的静态 HTML 断言语义结构时优先评估直接采用(browser mode,或对 happy-dom 装载的文档跑 ivya——离浏览器可用性需要 spike)。

### 调研过、判断不值得抄的(及理由)

1. **把 aria role 词表原样搬到终端。** 终端输出没有可访问性树,role 语义(heading level、checked、expanded)大半没有对应物;抄的是匹配语义与语法形状,节点词表要按终端排版概念(框线区块、列对齐表格、缩进树)重新定义。
2. **快照 patch/3way 更新模式。** vitest 的 `-u` 已覆盖更新流,不需要复刻 Playwright 的三种模式。

## trycmd / snapbox(Rust)

**来源:** [docs.rs/trycmd](https://docs.rs/trycmd/latest/trycmd/)、[assert-rs/snapbox](https://github.com/assert-rs/snapbox)(cargo 自己在用,活跃维护)。

**是什么:** 声明式 CLI golden 测试。用例是数据文件(`.trycmd`,或 Markdown 里的 ` ```console ` 代码块——README 示例即测试):`$ cmd` 起命令、`? 2` 断言退出码、其后整段是期望输出。容差词表内联在期望里:`[..]` 行内任意字符、`...` 独立行跳过任意行数、`[ROOT]`/`[CWD]`/`[EXE]` 内置路径脱敏变量、`TestCases::insert_var` 自定义变量。更新流:`TRYCMD=overwrite cargo test` 重写 golden,`TRYCMD=dump` 落实际输出供人查。

### 值得抄的

1. **容差词表长在 golden 里,不长在断言代码里。** `[..]`、`...`、脱敏变量让「每次运行都变的值」(耗时、成本、路径、locator)在期望文件里就地声明为不关心,golden 剩下的每个字符都是有意锁定的契约。映射到 vitest:`toMatchFileSnapshot` + 比对前的 scrub 归一管线(strip-ansi → 声明式正则→占位符表,如 `[COST]`/`[LOCATOR]`;Go 生态的 [atago](https://github.com/nao1215/atago) 的 `scrub:` 规则表是同思路的现成参照)。注意 [vitest#5426](https://github.com/vitest-dev/vitest/issues/5426):自定义 snapshot serializer 不作用于 `toMatchFileSnapshot`,归一要在传入 matcher 之前自己做。
2. **overwrite/dump 双模式更新流。** 「重写 golden」与「只落实际输出供人对照」分开,review 时能先看 dump 再决定收不收——vitest `-u` 天然对应前者,后者是失败信息设计的参照。

### 调研过、判断不值得抄的(及理由)

1. **把 golden 当唯一断言词表。** trycmd 面向输出窄而稳的传统 CLI;对渲染面大、化妆调整频繁的报告输出整页上 golden,等于把脆断言从代码搬进数据文件——golden 只适合窄稳表面(`--json` 摘要、JUnit、错误文案)。
2. **shlex 拆分命令的执行模型。** 验收脚本「命令以 shell 原文出现、可直接复制复现」的既有约定更好,不需要 trycmd 的命令解析层。

## CLI / TUI 测试生态横评(cli-testing-library、tui-test、shell-use、atago 等)

**来源:** [crutchcorn/cli-testing-library](https://github.com/crutchcorn/cli-testing-library)、[@microsoft/tui-test](https://www.npmjs.com/package/@microsoft/tui-test)(仓库已重定向到 [microsoft/shell-use](https://github.com/microsoft/shell-use))、[nao1215/atago](https://github.com/nao1215/atago)、[ink-testing-library](https://github.com/vadimdemedes/ink-testing-library)、prysk/cram、shelltestrunner、bats-core、aruba。

**是什么:** 对「有没有现成的 vitest 友好 CLI 验收库」的一轮横评。结论:**这个生态位是空的**——cli-testing-library 是 testing-library 查询模型移植到子进程输出缓冲(`findByText` + 每查询可选 `{stripAnsi, collapseWhitespace, normalizer}`),只有点查询、没有结构断言,单维护者;tui-test 是 Playwright-for-terminals(PTY + xterm.js 网格模型、auto-wait locator、整屏快照),但项目已整体转向 agent 工具 shell-use,且自带 runner 与 vitest 互斥;atago 是 YAML 场景 + 最完整的 scrub 词表(自动脱敏 ANSI/临时路径/UUID/时间戳/端口 + 用户声明的 regex→占位符),但生态极小;ink-testing-library 只服务 Ink 渲染的应用;prysk/shelltestrunner/bats/aruba 是 golden-transcript 或 Gherkin 一族的老前辈,没有容差与结构词表。

### 值得抄的

1. **每查询可选归一化选项**(cli-testing-library 的 `{stripAnsi, collapseWhitespace, normalizer}`)——点查询层的工效学形状。
2. **xterm.js 网格模型是 TUI 断言的正确抽象**(tui-test):看到的是 cursor 移动、重绘之后的**屏幕终态**,不是字节流。仅作认知参照记录:PTY dashboard 的验收维持粗粒度 smoke,不引入网格模型(见下)。
3. **atago 的声明式 scrub 规则表**——golden 归一管线的参照,已并入上一节结论。

### 调研过、判断不值得抄的(及理由)

1. **依赖 tui-test 或自建 xterm.js 网格断言层。** 项目已死转(shell-use v0.0.1-beta);为 PTY smoke 的三条断言(有 ANSI、有框线、到达完成态)引入终端模拟器不成比例——CLI 仓库现有 `script` 命令 + 粗粒度 smoke 的做法维持不变,宽度/几何语义归单元层。
2. **直接采用 cli-testing-library。** 没有结构断言故事,解决不了「排版级耦合」这个核心问题;其价值止于工效学参照。
3. **Gherkin / aruba 式自然语言步骤层。** 间接性没有换来表达力,断言仍要落回底层词表。

## 相关阅读

- [View](feature/reports/view.md) —— 上面几条学到的东西,具体设计在这篇;两次运行对比由成对差异表([`DeltaTable`](feature/reports/library/metric-views.md#deltatable))按 snapshot 维度承担。
- [报告图表组合语法](roadmap/report-chart-composition/README.md) —— 借鉴 recharts 子组件组合模型、为 niceeval 图表类组件设计声明式子组件语法的候选契约,含逐组件语法对比举例。
- [E2E 验收断言 DSL](roadmap/e2e-acceptance-dsl/README.md) —— 借鉴 aria-snapshot 匹配语义与 trycmd 容差词表、为 E2E 验收设计结构断言 DSL 与 vitest 验收库的候选契约。
- [Observability](observability.md#结果可视化niceeval-view) —— `niceeval view` 现有能力全貌,对照着看这篇的"还差什么"更清楚。
- [agent-eval 适配笔记](feature/adapters/reference/agent-eval.md) —— agent-eval 的 adapter 实现(采集 / 转换 / 落地)的源码阅读记录。
- [OTel GenAI 等标准参考](feature/adapters/reference/otel-genai.md) —— "agent 行为怎么记"的行业标准调研,对比 agent-eval 的自定义方案。
- [eve 协议机制](feature/adapters/reference/eve-protocol.md) —— eve 运行时原生事件流的字段与采集机制,StreamEvent 演进的上限参照。
