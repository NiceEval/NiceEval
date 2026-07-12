# Reports —— 自己搭报告页的积木

> 状态:指标、双面渲染、报告宿主与本文的 `ExperimentList` / `EvalList` / `AttemptList` 实体列表均已实现;它们取代了旧 `ExperimentTable` / `CaseList` 与 `MetricTable.expand` 的重叠职责(已删除,无兼容层)。`AttemptLocator`(不透明短字符串)是唯一的 attempt 级引用类型——`MetricCell.refs`、`AttemptListItem.locator`、`ctx.attemptHref` / `ctx.attemptCommand` 均已按此重写;`niceeval/report` 包内(计算函数、组件、text/web 渲染、内置默认报告)全部完成迁移。两个宿主继续共用 `selectCurrentResults` 产出的同一份 Selection,`--report` 只替换报告定义。`niceeval view` 的证据室(`src/view/app/` 的 attempt 路由与 `AttemptModal`)同样消费 `#/attempt/@<locator>` 单段格式,报告页与 view 靠同一个 locator 身份契约打通(见 [View](view.md))。

跑完一轮实验之后,「怎么看结果」不该只有 `niceeval view` 那三个固定 tab。你想把同一批结果摆成一张**考试成绩单**(每个 eval 是一道题,gate 判对错、soft 给分、按科目算总分),摆成一张 **benchmark 榜**(谁写出来的代码能用、谁写得更短、谁更便宜),或者摆成一张**质量 × 成本 frontier**(每个配置一个点,同 agent 不同档位连成线,右上角 = 又好又便宜)——这三种「看法」用的是同一份落盘 artifact,差别只在组合方式。

今天做不到:落盘 artifact 虽然结构化,但没有读取契约,想算个自定义指标只能手工爬目录(那段痛苦的样子见 [Results Lib](results-lib.md) 开头);就算读到了,分组、聚合、null 处理、画图仍是全套手写。

本提案只给**两档积木**,没有中间格式:

```text
 第二档:数据(niceeval/results 读 + niceeval/report 算)  第一档:React 组件(niceeval/report/react,跑在哪都行)
 ---------------------------------------------------    --------------------------------------------------
 .niceeval/<run>/… ──openResults──▶ 实验/结果快照/Selection    <MetricTable/> <MetricScatter/> <DeltaTable/> …共七个
 defineMetric × Dimension                      ──▶  props = 算好的可序列化数据(终值 + 渲染提示)
 MetricTable.data()/MetricScatter.data()… 折出终值    (排序、覆盖率角标、连线、点格子下钻)
 (两级聚合、null 语义、去重全在这侧)
```

- **第一档:React 组件。** 报告页就是你应用里的一页:import 组件,像搭积木一样拼 JSX。组件只认「算好的可序列化数据」,零 IO、可进 `"use client"`,所以 RSC、Vite SPA、静态导出都能用。
- **第二档:parser 与强定义。** `openResults`(来自结果读写库 [Results Lib](results-lib.md) 的读取面)把落盘 artifact 变成「实验 → 快照 → eval → attempt」的类型化数据;`defineMetric` 加挂在组件上的 `data` 计算函数把它折成组件要的数据。组件表达不了的看法,直接拿数据自己算。

两档之间是一条**可序列化边界**:算与画分离,数据是普通 JSON——可以在 RSC 里当场 `await`,也可以在 CI 里落成 `public/report.json` 喂给任何 SPA。**import 边界即运行时边界**:`niceeval/results` 与 `niceeval/report` 的计算函数碰文件系统,只能进服务端/脚本;`niceeval/report/react` 纯渲染。可达百 MB 的 diff 永远不该在渲染路径上被读,这条边界就是为它划的。

> 与早先草案的差异:第一版有 `defineReport` + `reports/` 目录 + `ReportDoc` 文件格式 + `niceeval report` CLI,现已全部砍掉。报告页的宿主永远是用户自己的应用,为它发明「配置文件 → 文档格式 → 渲染 CLI」三层中转,每层都是学习成本,表达力反而不如 JSX(说明文字曾需要一个 `markdown()` 块——在 JSX 里那就是一行 `<p>`)。零代码看结果的需求归 `niceeval view`;本提案只服务「要自己的页面」的用户。(2026-07 补:报告页可以经 `--report` 直接递给官方宿主 `show` / `view` 渲染——无发现、无格式、无新命令,与被砍的三层中转不是一个东西,见[报告页交给官方命令渲染](#报告页交给官方命令渲染definereport-与双面组件)。新方案还把报告基座命名回 `defineReport`:被砍的是「目录发现 / 文档格式 / 专门 CLI」三层中转**形态**,不是这个名字;flag 叫 `--report`,文件默认导出就该同词,不再另造「page」一词。)

## 与现有件的关系

| 件 | 时机 | 职责 |
|---|---|---|
| **Reporter**(`Console()` / `Artifacts()` / `JUnit()`…) | 运行**中**,流式回调 | 把结果送出去:打控制台、落盘、上报平台 |
| **Results Format**(`.niceeval/<run>/`) | 运行**后**,静态 artifact | 唯一持久化事实来源([Results Format](results-format.md)) |
| **Results Lib**([提案](results-lib.md)) | 运行中写,运行后读 | 结果数据的专门库:类型的家 + writer(`Artifacts()` 的落盘实现)+ reader(类型化句柄/快照/选择器)。本提案的第二档吃它的读取面 |
| **Report(本提案)** | 运行后,按需 | 指标 × 计算函数 × React 组件,把落盘 artifact 组合成**你自己应用里的报告页** |
| **`niceeval view`** | 运行后,按需 | 内置前端,零代码的通用看法——「报告槽(默认填充 `CostPassRateComparison`,`--report` 整槽替换)+ 证据室」,见 [View · 用 Reports 积木重建 view](view.md#用-reports-积木重建-view) |

Report 不新增任何落盘事实——它只消费 Results Format 已有的东西。反过来这也是设计约束:**一个指标能不能算,取决于 artifact 里有没有对应数据**; artifact 缺了(比如 remote agent 没有 `diff.json`),指标对该 attempt 返回 `null`,聚合时跳过,不编数。

> 命名说明:runtime 回调通道叫 **Reporter**,本提案的包叫 `niceeval/report`。砍掉 `reports/` 目录与 CLI 后,两词同屏的场合只剩 import 语句,混淆面已小;文档里仍永远用全名,不缩写成"报告器/报告"混用。

## 第一档:React 组件 —— 报告页是你应用里的一页

先看完整的一页(Next.js RSC;不用 Next 的姿势见 [DX 模拟](#dx-模拟)场景二):

```tsx
// app/evals/page.tsx —— code-golf:谁写出能用的代码,谁写得短,谁便宜
import { openResults } from "niceeval/results";
import { defineMetric, passRate, costUSD, durationMs } from "niceeval/report";
import { RunOverview, MetricTable, MetricMatrix, MetricScatter } from "niceeval/report/react";

const codeLines = defineMetric({
  name: "code-lines",
  label: "代码行数",
  better: "lower",
  unit: "lines",
  where: (a) => a.result.verdict === "passed",   // 只比能用的代码(见「指标与聚合」)
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;
    return Object.values(diff.generatedFiles)
      .reduce((n, src) => n + src.split("\n").length, 0);
  },
});

export default async function EvalsPage() {
  const results = await openResults(".niceeval");
  const selection = results.latest({ experiments: "compare/" });

  return (
    <main>
      <h1>Code Golf:能用 × 短 × 便宜</h1>
      <RunOverview data={await RunOverview.data(selection)} />
      {/* 页头 KPI 条:何时跑的、几个配置、几道题、总成本;Selection 的残缺警告随行,直接显示在条内 */}
      <MetricScatter data={await MetricScatter.data(selection, {
        points: "experiment",       // 每个点 = 一个配置的聚合
        series: "agent",            // 同 agent 的点连线(不同 reasoningEffort 档位)
        x: costUSD,
        y: passRate,
      })} />
      <MetricTable data={await MetricTable.data(selection, {
        rows: "agent",
        columns: [passRate, codeLines, costUSD, durationMs],
        sort: passRate,
      })} />
      <MetricMatrix
        data={await MetricMatrix.data(selection, { rows: "eval", columns: "agent", cell: passRate })}
        attemptHref={(locator) => `/attempts/${locator}`}   // 点格子 → 你自己的下钻页
      />
    </main>
  );
}
```

换一种看法 = 换积木摆法,数据源一个字不动:把 `MetricTable` 换成 `Scoreboard`、`cell` 从 `passRate` 换成 `examScore`,同一批 artifact 就从 benchmark 榜变成考试成绩单(场景二)。说明文字、布局、品牌色都是你页面里的普通 JSX——这正是第一版 `markdown()` 块被砍的原因。

首批七个组件。边界不是抽象的「刻意少」,而是**让第一个真实消费者的报告页完整成立**:场景三里 coding-agent-memory-evals 的线上报告要回答「记忆开关值不值」,这七个缺一个都拼不完整,多的暂时都不加:

```typescript
// niceeval/report/react —— 纯渲染,零 IO,可进 "use client"
// 每个组件同时挂自己的 data 计算函数(RunOverview.data / MetricTable.data …),
// 算与画配对靠组件名后打点即可发现,契约见「计算函数与数据契约」
function RunOverview(props: { data: OverviewData; className?: string }): JSX.Element;
        // 页头 KPI 条:何时跑的、几个配置、几道题、通过率、总成本 —— 每张报告页的「这批数据是什么」

function ExperimentList(props: { items: ExperimentListItem[]; className?: string }): JSX.Element;
function EvalList(props: { items: EvalListItem[]; className?: string }): JSX.Element;
function AttemptList(props: {
  items: AttemptListItem[];
  total?: number;                              // items 被 slice 时如实显示剩余数量
  className?: string;
}): JSX.Element;

function MetricTable(props: {
  data: TableData;
  attemptHref?: (locator: AttemptLocator) => string;  // 传了,格子可点、下钻去处你定;不传,纯展示
  className?: string;
}): JSX.Element;

function MetricMatrix(props: {
  data: MatrixData;
  attemptHref?: (locator: AttemptLocator) => string;
  className?: string;
}): JSX.Element;

function Scoreboard(props: { data: ScoreboardData; className?: string }): JSX.Element;

function MetricScatter(props: {
  data: ScatterData;
  pointHref?: (row: ScatterData["rows"][number]) => string;   // 点一个点 → 该配置的下钻页
  className?: string;
}): JSX.Element;

function DeltaTable(props: {
  data: DeltaData;                            // 成对对比:B 相对 A 每个指标的 Δ,涨跌配色随 better
  className?: string;
}): JSX.Element;

```

组件内置的行为全是纯展示逻辑:

- **RunOverview**:通过率、成本、耗时这排数字下面标注数据来源(几个快照、何时跑的);`RunOverview.data(selection)` 收 Selection,warnings 随行直接显示在条内——诚实不靠使用者记得接线(若把 warnings 做成要手动透传的独立参数,忘了就静默丢失,这正是收 Selection 的动机)。
- **GroupSummary**:紧凑摘要块,只渲染 `GroupSummaryData` 算好的 `MetricCell` / 计数,不现场重算比例——通过率(eval 级折叠口径)、experiment/eval/attempt 数、failed 计数;`errored` 在组内为 0 时省略这一片段的展示,但数据字段 `verdicts.errored` 本身不受影响,不会因为渲染取舍丢数据;总成本走 null-safe 求和,全缺渲染成缺数据,不画 `$0`;有 `lastRunAt` 就多渲染一行,没有就不渲染。
- **ExperimentList**:每项一个 experiment,固定展示身份、配置、Eval 判定构成和官方汇总指标;展开到这个 experiment 的 Eval。`ExperimentList.data(selection)` 返回普通数组,过滤由报告作者对数组调用 `.filter()`。
- **EvalList**:每项一个 `experimentId + evalId`,固定展示判定、Attempt 数、分数、成本、耗时与失败原因;展开到 Attempt。`EvalList.data(selection)` 返回普通数组。
- **AttemptList**:每项一个 Attempt,固定展示判定、断言、error、Judge 评语和证据引用。它不预设只看失败;报告作者过滤 `AttemptListItem[]`,用 `.slice()` 限量,`total` 让渲染面如实报告剩余数量。
- **MetricTable**:按 `sort` 预排,方向随指标的 `better`;`samples < total` 的格子带覆盖率角标;一组全 `null` 渲染成缺数据。它只表达任意维度 × 任意指标,不展开 experiment / Eval / Attempt 实体层级。
- **MetricMatrix**:稀疏渲染(没有样本的格子空着);`cell.refs` + `attemptHref` 让「哪道题谁挂了,一眼看穿」之后的下一步——「给我看那次 attempt」——就在手边。
- **Scoreboard**:总分 + 分科小计,`missing`(没跑、按 0 计的题数)如实展示在科目行,固定分母的口径不藏。
- **MetricScatter**:轴向随 `better`——`lower` 的轴反向画,「好」的角落恒在右上(成本轴 $20 → $0 就是这么来的);同系列的点按 x 排序连线,系列名标在线旁;x 或 y 为 `null` 的点不画,底部注脚如实报「n 个点缺数据」;hover tooltip 显示 `display` 与 `samples/total`(增强 runtime 提供,无 JS 退化为 SVG `<title>`)。**可画点不足时组件自己表态,不返回空、也不由调用方省略整块图**:0 个可画点(x 或 y 全 `null`)渲染「无数据」态、点明是哪两个指标没有可用数据;恰好 1 个可画点渲染「至少两个实验才能比较」态(比较类图单点没有可对比对象);2 个及以上正常成图。text 面与 web 面表达同一个事实,不会某一面静默消失。
- **DeltaTable**:每行一对配置(如「bub:裸 vs +AGENTS.md」),每列一个指标,格子里 A、B、Δ 三个值;Δ 的涨跌好坏由 `better` 判定,任一侧缺数据时 Δ 显示为缺,不硬算。

四条跨组件的契约保证:

- **静态为底,渐进增强,两面同口径。** 每个组件的 web 面在 `renderToStaticMarkup` 下必须产出完整可读的 HTML——不 hydrate、无客户端状态:排序靠计算时的 `sort` 预排,下钻是普通 `<a>`,展开折叠用 `<details>`,图上的点自带 SVG `<title>`。在这份静态 HTML 之上,包内随发一份渐进增强 runtime(`src/report/react/enhance.js`,发布为 `niceeval/report/react/enhance.js`):纯 vanilla、零依赖、幂等,只作用于 `.nre` DOM 与 `data-nre-*` 属性,提供三样浏览态交互——表头点击排序(`th` 带 `data-nre-sort`,`td` 带 `data-sort-value`)、`MetricTable` 行过滤(`filter` prop 渲染 `<input data-nre-filter>`,runtime 隐藏不匹配行)、scatter / line 点的 hover tooltip。宿主(view 的 server 与 `--out` 导出)把 runtime 与 styles.css 一并内联;text 面(`show`)不受影响。增强只做浏览态、不改口径:数据与基准顺序由计算侧的 `sort` 钉死,text 面、无 JS 环境与网页初始态读到同一份内容,点表头重排只是读者手里的临时视图、刷新即回基准态——「人看到的和 agent 读到的一致」约束的是口径同源,不是零脚本;view 的默认首页就是这套组件渲染的报告槽,几十行的实验榜单没有排序过滤在浏览上不成立(裁决出处见 [memory](../memory/report-zero-js-to-progressive-enhancement.md))。静态导出是一等公民,不是降级模式(场景三)。
- **跨块配色一致,色板与 view 统一。** 系列/维度键到调色板的映射是稳定散列:同一个 agent 在 scatter 的线、DeltaTable 的行、matrix 的列头永远同色,不需要 Provider 或手工配置;系列色板就是 view 的六色 CVD 安全色板,报告槽与证据室同一套颜色语言。
- **样式随包发布,令牌与 view 同源。** `niceeval/report/react/styles.css` 一并发布:`nre-*` 稳定类名 + 这一份 CSS,静态页零依赖成立;要定制就在它之后加载自己的覆盖。样式令牌与 view 同一体系(`light-dark()` 深浅色自适应),但全部定义自带在 `.nre` 作用域内——不 import view、不依赖宿主变量;styles.css 与 `colors.ts` 的取值逐个对应,改色先改 `colors.ts` 再同步 CSS。
- **组件不做数据操作。** 过滤、重新聚合、换口径都是计算侧的事(改参数重算);组件只有展示态交互(含增强 runtime 的浏览态排序与过滤——它们不改数据,刷新即回初始态)。想固定「只看某个 agent」的口径,就多算几份数据条件渲染,不给组件加口径开关。

## 第二档:结果库的读取面(契约在 Results Lib)

结果数据的读与写抽成了专门的库 `niceeval/results`,完整契约在 [Results Lib](results-lib.md);本提案只消费它的读取面,这里备忘入口:`openResults(".niceeval")` 给出「实验 → 快照(单次跑的实验)→ eval → attempt」的类型化层次,外加 `skipped`(读不了的落盘,不静默)与低层的 `runDirs`(忠实磁盘);attempt 级重 artifact(`events` / `trace` / `o11y` / `diff` / `sources`)全部懒加载,缺了返回 `null`;`results.latest()` 返回 **Selection**(快照 + 结构化 warnings 绑在一起),残缺快照的警告替你算好。本文的计算函数统一收 `Selection | Snapshot[]`,其余部分都建立在这些数据之上。

## 指标与聚合:「算什么」的积木

### Metric —— 一个 attempt 算出一个值

指标是纯函数:吃一个 `AttemptHandle`,吐一个值(或 `null` 表示「此 attempt 测不了这个指标」),外加名字、两级聚合方式和渲染提示。

```typescript
import { defineMetric } from "niceeval/report";

// 自定义指标:生成代码总行数(code-golf 的「谁短」)
const codeLines = defineMetric({
  name: "code-lines",                 // MetricColumn.key 与列头的来源;同一次计算里重名是错误
  label: "代码行数",                   // 列头;省略时用 name;可按 locale 给多份(见「locale:渲染面的语言」)
  description: "通过的 attempt 的生成代码总行数",
  better: "lower",                    // 渲染提示:越低越好(排序方向、轴向、涨跌配色用)
  unit: "lines",
  where: (a) => a.result.verdict === "passed",  // 不满足 → null。少这行,榜单会奖励「写得短的坏代码」
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;           // 没有 diff 的 attempt 不计入,不记 0
    return Object.values(diff.generatedFiles)
      .reduce((n, src) => n + src.split("\n").length, 0);
  },
  aggregate: { perEval: "mean", across: "mean" },   // 两级聚合(见下节);这就是默认值,可省略
});
```

`where` 只是把「先看 verdict 再计值」变成声明,语义等价于在 `value` 开头 return null。单独设字段,是因为这一步最容易忘:code-golf 的本意是「**能用** × 短」,忘了它,写了半个函数就崩掉的 agent 会赢下「最短代码」。

内置指标与自定义指标是**同一个类型**,没有特权:

```typescript
import { passRate, durationMs, tokens, costUSD, examScore } from "niceeval/report";
```

### 聚合是两级的:attempt → 题,题 → 组

「每格 attempt 数相等」是幻觉:`earlyExit` 默认开——过了就停,errored 也停,只有 failed 会跑满 `runs`([Runner](runner.md))。失败的题天然比通过的题样本多。把组里所有 attempt 平铺求均值,分数就和重试策略纠缠在一起:

```text
eval A 首次即过 → 样本 [1]        eval B 三连挂 → 样本 [0, 0, 0]
平铺 mean = 1/4 = 0.25            题内先折、再跨题平均 = (1 + 0)/2 = 0.5
```

0.5 回答「这套题它做对几成」;0.25 是重试策略的伪影,改一下 `earlyExit` 或 `runs` 数字就变。所以聚合钉成两级,默认宏平均:

```typescript
type Aggregator = "mean" | "sum" | "min" | "max" | ((values: number[]) => number);

interface MetricAggregate {
  perEval?: Aggregator;   // 第一级:同一 (eval × 快照) 的多 attempt → 一个题级值,默认 "mean"
  across?: Aggregator;    // 第二级:分组内的题级值 → 格子终值,默认 "mean"
}
```

「k 次里最好一次」因此不是特例,就是一次普通组合:

```typescript
const passAtK = defineMetric({
  name: "pass@k",
  description: "k 个 attempt 里至少通过一次的题占比",
  better: "higher",
  unit: "%",
  value: (a) =>
    a.result.verdict === "skipped" ? null : a.result.verdict === "passed" ? 1 : 0,
  aggregate: { perEval: "max", across: "mean" },   // 题内取最好一次,跨题取占比
});
```

自定义维度把同一道题的 attempt 分进不同组时,第一级折叠发生在各组内部。

### null 不是 0:每个指标对四个 verdict 表态

`null` = 「此 attempt 测不了这个指标」,不进聚合;`0` = 「测了,结果是零」,照常进。哪个 verdict 落哪边必须由指标作者显式决定,内置指标先表态:

| 内置指标(name) | skipped | errored | failed | passed | better |
|---|---|---|---|---|---|
| `passRate`(`pass-rate`) | null | 0 | 0 | 1 | higher |
| `examScore`(`exam-score`) | null | 0 | 0 | soft 均分(无 soft 则 1) | higher |
| `durationMs`(`duration`) | null | 实测 | 实测 | 实测 | lower |
| `tokens`(`tokens`) | null | 实测;无 usage 则 null | 同左 | 同左 | lower |
| `costUSD`(`cost`) | null | 同上 | 同左 | 同左 | lower |
| `turns`(`turns`) | null | 实测;o11y 缺失则 null | 同左 | 同左 | lower |

(默认聚合全部是 `mean / mean`。)两个容易搞反的点:

- **examScore 先按 verdict 分派,再看断言。** errored 的 attempt 断言是空数组——只按「gate 全过才得分」的字面实现,空数组会让条件空真成立,崩溃反而得满分。交白卷是 0 分:不是缺数据,更不是满分。
- **报告不重新判卷。** examScore 只认落盘的 `verdict`:`--strict` 下被翻成 failed 的 attempt 得 0,哪怕它的 soft 分不低。判定口径与 run 时一致;想换口径去改 run,不在报告里另起炉灶。

### 两档内置指标:瘦身字段 vs artifact

`turns` 和其余五个不是同一等级。`passRate` / `examScore` / `durationMs` / `tokens` / `costUSD` 只读 `attempt.result` 上的瘦身字段——这些字段随 `summary.json` 必到,任何 producer、任何 `copySnapshots` 的 `artifacts` 选择都算得出,内置默认报告 [CostPassRateComparison](#costpassratecomparison内置默认报告) 只用这一档(它的成本 × 通过率散点与 `ExperimentList` 只读瘦身条目的边界因此原样成立)。`turns` 读 `attempt.o11y()`——懒加载的 artifact,`copySnapshots` 不传 `o11y` 就拿不到(参见 [Results Lib「复制与瘦身」](results-lib.md#复制与瘦身)对 `artifacts` 默认值的说明)。这不是 bug:`turns` 的 `value` 在 o11y 缺失时如实返回 `null`,和其余指标缺数据时的行为完全一致——渲染成 `—`,不假装是 `0`。

**报告作者的心智负担**:摆 `turns` 之前,先确认数据管线里 o11y 会不会随行到你要渲染的那份结果——本地 `.niceeval/` 天然齐全;`copySnapshots` 发布场景要显式把 `"o11y"` 加进 `artifacts`(它只有几 KB,不是 `diff` 那种可达百 MB 的重 artifact,默认清单没带纯粹是没人用过,不是刻意排除)。这条心智负担只有摆 artifact 档指标时才背上,`CostPassRateComparison` 和其余五个内置指标不受影响。

新增内置指标的判据,不是「niceeval 已经算出这个数」:`totalToolCalls` / `compactions` / `thinkingBlocks` 同样是 o11y 里现成的字段,没有跟着 `turns`一起进内置——真被验证需要之前,guide 里给一份 `defineMetric` 配方(`where` + `await a.o11y()`)让项目自己包一层,比无差别地把 `O11ySummary` 镜像进内置指标表更克制。

`examScore` 仍是「考试」看法的核心积木:gate 是判卷线,soft 是给分点——这套语义 [Scoring](scoring.md) 里本来就有,指标只是把它折成一个数。`tokens` 只加 `inputTokens + outputTokens`:缓存读写量大但便宜,计进去会把缓存热的 agent 画成 token 大户;花钱多少本来就有 `costUSD` 负责。

显示格式由 `unit` 驱动内置格式化(`"%"` → `87%`、`"ms"` → `1.2s`、`"$"` → `$0.31`、其余 → `1.2k lines` 式缩写);要更细的控制,给 metric 传 `display?: (value: number) => string`。

### Dimension —— attempt 分到哪一组

维度决定表格的行(或矩阵的行列、散点的点)。内置维度就是 `EvalResult` 已有的身份字段;自定义维度是一个函数:

```typescript
type Dimension =
  | "agent" | "model" | "experiment" | "eval" | "evalGroup" | "snapshot"
  | { name: string; of: (attempt: AttemptHandle) => string };

// "evalGroup" = eval id 的第一段:"algebra/quadratic" → "algebra"(考试里的「科目」)
// "snapshot"  = "<experimentId> @ <startedAt>",把两次快照并排成行,与 view 的 Compare 同口径
```

维度槽实际收的是 `DimensionInput = Dimension | FlagRef`,与 [flags 与新摆法](#flags-与新摆法)的 `flag()` 构成三路分工,判据是变量住在哪:分组能从 attempt 已有数据**派生**的走自定义维度——定义只住在报告文件里,报告层的摆法需求不反向要求 experiment 改配置;变量是 experiment 本身要**声明**的配置(scaling 档位、数值轴、要在 experiment 定义处一眼看到的档位)才进 `flags`。数值轴(`MetricLine` 的 `x`)只收 `FlagRef`:刻度必须来自声明的数值,派生的组名当不了刻度。自定义维度只能派生、不能补造:区分条件若只体现在 experiment 命名里,`of` 就退化成解析名字——那正是该把变量搬进 `flags` 的信号。

## 计算函数与数据契约

计算函数是「Selection → 一份组件数据」,跑在 Node 侧,产物是**算好的、可序列化的**普通 JSON——终值加渲染提示,不含公式。这与 `niceeval view`「一次性烘焙进静态产物」的哲学一致([View](view.md)):前端(不管是不是我们的组件)只做渲染。

**计算函数挂在对应组件上**,不做顶层独立导出。这个决定消掉四个问题:`Scoreboard` / `scoreboard` 只差大小写的双胞胎导入不存在(autocomplete 选错一个,类型报错离出错点很远);`table` / `line` / `delta` 这些泛化名不占顶层导出;「哪个函数配哪个组件」不用查表——组件名后打个点,autocomplete 就是文档;`MetricBars.data` 是 `MetricMatrix.data` 的别名,多对一的配对关系也显式化。挂上去的仍是普通 TS 函数,「零件复用进用户应用」不受影响。所有 `data` 函数第一参数收 `Selection | Snapshot[]`。

```typescript
await MetricTable.data(selection, {
  rows: "agent",                      // 行维度
  columns: [passRate, codeLines],     // 每列一个指标
  sort: passRate,                     // 构建时排序,方向随 better;两面同口径,预排即终排
  evals: "algebra/",                  // 可选:eval id 前缀过滤,同 CLI 语义
});                                   // → TableData

await MetricMatrix.data(selection, {
  rows: "eval", columns: "agent", cell: examScore,
  evals: "algebra/",                  // 可选:eval id 前缀过滤,同 CLI 语义(与 MetricTable.data 一致)
});                                   // → MatrixData

await Scoreboard.data(selection, {
  rows: "agent",                      // 给谁打分;维度槽与 MetricTable.data 统一叫 rows
  subjects: "evalGroup",              // 按什么分科
  weights: { "algebra/": 2 },         // eval id 前缀 → 每题分值;未列默认 1;前缀重叠时最长的生效
  fullMarks: 100,                     // 折算满分
  score: examScore,                   // 每题得分指标;缺省即 examScore,可换自定义(如「答对但超预算扣分」)
});                                   // → ScoreboardData

await MetricScatter.data(selection, {
  points: "experiment",               // 点维度:每个点 = 该组 attempt 的聚合
  series: "agent",                    // 可选:同系列的点连成线;省略 = 纯散点
  x: costUSD,                         // 两个指标各占一轴,走同一台两级聚合引擎
  y: passRate,
});                                   // → ScatterData

await RunOverview.data(selection);    // → OverviewData:页头 KPI + 数据来源;Selection 的 warnings 随行,
                                      //   不要求调用方手动透传

await GroupSummary.data(selection);   // → GroupSummaryData:一组 experiment(典型用法是先用
                                      //   Selection.filter 只删不换收窄到某个实验组)的紧凑统计——
                                      //   experiment/eval/attempt 数、eval 级折叠计票、通过率、
                                      //   总成本、最后运行时间;不收第二参数,口径不可配置

await DeltaTable.data(selection, {
  pairs: [                            // 每行一对:B 相对 A
    { a: "compare/bub-gpt-5.4", b: "compare/bub-gpt-5.4--agents-md", label: "bub" },
    { a: "compare/codex-gpt-5.4", b: "compare/codex-gpt-5.4--agents-md", label: "codex" },
  ],
  metrics: [passRate, costUSD, durationMs],
});                                   // → DeltaData

const experiments = await ExperimentList.data(selection); // → ExperimentListItem[]
const evals = await EvalList.data(selection);              // → EvalListItem[]
const attempts = await AttemptList.data(selection, {
  redact: (s) => s.replaceAll(repoRoot, ""),               // 发布消毒发生在数据计算时
});                                                         // → AttemptListItem[]

<ExperimentList items={experiments.filter((x) => x.agent === "bub")} />
<EvalList items={evals.filter((x) => x.verdict !== "passed")} />
<AttemptList
  items={attempts.filter((x) => x.verdict === "failed").slice(0, 20)}
  total={attempts.filter((x) => x.verdict === "failed").length}
/>
```

**实体列表与指标表不重叠。** `ExperimentList` / `EvalList` / `AttemptList` 展示固定实体事实并负责逐级下钻;`MetricTable` 展示可配置维度 × 指标值,没有 `expand`。过滤实体列表时先调用 `.data(selection)` 得到普通数组,再使用 JavaScript `.filter()` / `.slice()`;组件不复制查询 DSL。`Selection.filter()` 仍只负责删减快照并保留 warnings,不承担 Eval 或 Attempt 过滤。

**MetricScatter 就是「质量 × 成本 frontier」的积木**:[Experiments](experiments.md) 的一文件一配置意味着 `compare/bub-low`、`compare/bub-medium`、`compare/bub-high` 各是一个实验——`points: "experiment"` 让每个档位成为一个点,`series: "agent"` 把同 agent 的档位连成线,`better` 驱动的轴向让右上角恒为「又好又便宜」。点的 x/y 就是两个 `MetricCell`:按点维度分组后走同一台两级聚合引擎,所以 `samples` / `total` / `refs` 一应俱全,hover 与下钻不用另做一套。

**GroupSummary 是一组 experiment 的紧凑统计,通过率走 eval 级折叠口径,与 `OverviewData.totals.passRate` 的两级聚合是两个不同公式,服务两个不同问题。** `OverviewData.totals.passRate`(以及 `MetricTable.data(..., columns: [passRate])`)走两级聚合引擎(`computeCell`),回答「整体质量几分」——一道题内某几次 attempt 部分通过,按小数份额计入,不是二元投票。`GroupSummaryData.passRate` 走 eval 级折叠(`foldEvalVerdict`:同一 eval 的多轮 attempt 里任一轮通过则这道题记通过,否则取最严重的判定——failed 比 errored 严重,errored 比 skipped 严重),折完再数票:`passed / (passed + failed + errored)`,`skipped` 的 eval 不进分母,分母为 0(组内没有任何已跑的 eval)时 `value` 为 `null`,不编 0%。这就是「这组题多少算过」的口径,与「整体质量几分」不是同一件事,组件也不允许互相替代。折叠 eval 数时按完整身份键(`experimentId` + eval id)去重,避免组内两个 experiment 各自的同名 eval(都叫 `"algebra/a"`)被误合并成一道题。组的 `totalCostUSD` 同理是第三个口径:组内可测 attempt 成本(`attemptCostUSD`)的 null-safe 求和,一次 attempt 都没报成本时是 `null`;这与指标列 `costUSD`(两级聚合的均值,「平均成本」)是两件事,渲染面不共用同一个字段或文案。

**Scoreboard 的公式是逐题分值制,分母对所有被打分者恒定:**

```text
题分值 = 命中的权重(默认 1)       题得分 = score 指标的题级值(perEval 折叠后)
总分   = fullMarks × Σ(题得分 × 题分值) / Σ(题分值)      Σ 遍历选中范围内全部题
```

某个 agent 没跑到的题挣 0 分,但**留在分母里**,科目小计里如实报 `missing` 数。分母若随人变,总分就没有可比性——这不违反「缺数据不补 0」:考试的契约本来就是「没答不得分」,诚实体现在把 missing 摆出来,而不是给每个人各配一张满分不同的卷子。科目题多分就多,与真实考卷一致;要「科目等权」,给轻科目的题配大权重即可。

数据契约(即组件的 props 类型,从 `niceeval/report` 导出):

```typescript
interface TableData<K extends string = string> {
  dimension: string;                  // 行维度名,如 "agent"
  columns: MetricColumn[];
  rows: { key: string; cells: Record<K, MetricCell>; meta?: TableRowMeta<K> }[];
                                      // meta 只在 rows: "experiment" 时随行携带,其它维度不携带
}

interface TableRowMeta<K extends string = string> {  // meta 在场时,渲染面补 Model / Agent / Verdicts 列——榜单不丢「这行是谁」
  // 下五项(agent…lastRunAt)是 rows: "experiment" 专属:experiment 行天然有唯一的 agent/model
  // 身份、eval 级折叠计票与「覆盖多少题/多少次尝试/最近何时跑的」;其它行维度不携带。
  agent?: string;
  model?: string;
  verdicts?: { passed: number; failed: number; errored: number; skipped: number };  // eval 级折叠计票(foldEvalVerdict 口径)
  evals?: number;                     // 这一行覆盖的 eval 数(去重后,与 verdicts 四项之和一致)
  attempts?: number;                  // 这一行覆盖的 attempt 总数(原始计数);大于 evals 说明存在多轮重试
  lastRunAt?: string;                 // 这一行覆盖范围内快照 startedAt 的最大值(ISO 8601,字符串可比大小)
}

interface MatrixData {
  rows: string;                       // 行维度名,如 "eval"
  columns: string;                    // 列维度名,如 "agent"
  metric: MetricColumn;
  cells: { row: string; column: string; cell: MetricCell }[];   // 稀疏:没有样本的格子不出现
}

interface ScoreboardData {
  dimension: string;                  // 被打分的维度名,如 "agent"(与 TableData.dimension 同例;计算函数的选项槽叫 rows)
  fullMarks: number;
  weights: { prefix: string; weight: number }[];   // 实际生效的权重表 —— 成绩单可审计
  rows: {
    key: string;
    total: { value: number; display: string };     // 已折算到 fullMarks
    subjects: {
      key: string;                    // 科目(subjects 维度的值)
      earned: number;                 // 加权得分
      possible: number;               // 科目分值合计
      evals: number;                  // 题数
      missing: number;                // 无任何样本、按 0 计的题数 —— 固定分母的如实注脚
    }[];
  }[];
}

interface ScatterData {
  points: string;                     // 点维度名,如 "experiment"
  series?: string;                    // 系列维度名,如 "agent"
  x: MetricColumn;                    // better: "lower" → 组件反向画轴,「好」的角落恒在右上
  y: MetricColumn;
  rows: {
    key: string;                      // 点的键,如 "compare/bub-high"
    series?: string;                  // 所属系列,如 "bub"
    x: MetricCell;
    y: MetricCell;                    // 任一为 null 的点组件不画,注脚如实报数
  }[];
}

interface OverviewData {
  snapshots: { experimentId: string; agent: string; model?: string; startedAt: string }[];
  totals: {
    evals: number; attempts: number;
    passed: number; failed: number; errored: number; skipped: number;   // 四个 attempt 原始判定计票(一个 attempt 一票),独立于 passRate,驱动页头的判定计数展示
    passRate: MetricCell;             // 通过率的唯一官方口径:computeCell(passRate, items),与 MetricTable.data(..., columns: [passRate]) 同一台两级聚合引擎——不是从上面四个计票现算
    costUSD: number | null;           // 任一 attempt 报了成本才有;全缺 = null,不编 0
    durationMs: number;
  };
  warnings: SelectionWarning[];       // Selection 的警告随行(结构化,含渲染好的 message),RunOverview 直接渲染
}

interface GroupSummaryData {
  experiments: number;                // 组内 experiment 数(去重后的 experimentId 个数)
  evals: number;                      // 组内 eval 数,按完整身份键(experimentId + eval id)去重
  attempts: number;                   // 组内 attempt 总数(原始计数,一轮 attempt 一票,不折叠)
  verdicts: { passed: number; failed: number; errored: number; skipped: number };
                                      // eval 级折叠计票(foldEvalVerdict 口径),与 TableRowMeta.verdicts 同源
  passRate: MetricCell;               // eval 级折叠计票的 passed / (passed + failed + errored),skipped 不进
                                      // 分母,分母为 0 时 value 为 null;与 OverviewData.totals.passRate 的
                                      // 两级聚合是两个不同口径,见上文「GroupSummary 是一组 experiment…」
  totalCostUSD: number | null;        // 组内可测成本(attemptCostUSD)求和;一次 attempt 都没报成本 = null,不编 0
  lastRunAt?: string;                 // 组内快照 startedAt 的最大值(ISO 8601);组内没有任何 item 时缺席
}

interface DeltaData {
  columns: MetricColumn[];
  rows: {
    key: string;                      // pair 的 label,如 "bub"
    a: { experimentId: string };      // 基线侧
    b: { experimentId: string };      // 对比侧
    cells: Record<string, {
      a: MetricCell;
      b: MetricCell;
      delta: number | null;           // b.value - a.value;任一侧 null → null,不硬算
      display: string;                // 已带符号("+12%" / "-$0.8"),涨跌好坏由 better 判定
    }>;
  }[];
}

// 三个实体列表按「experiment → experimentId × eval → attempt」逐级下钻,`AttemptListItem`
// 是三者共用的叶子形状——`ExperimentListEvalRow.attempts` 与 `EvalListItem.attempts` 直接复用
// 同一个类型,不是各自的精简版;报告作者可以把这两处的数组原样传给 `<AttemptList items={...} />`。

interface AttemptListItem {
  evalId: string;
  experimentId: string;
  attempt: number;
  agent: string;
  verdict: Verdict;
  error?: string;
  assertions: AssertionResult[];
  durationMs: number;
  costUSD?: number;
  locator: AttemptLocator;
  // 证据能力标记:有没有保存的 Eval 源码 / 执行事件 / OTel 计时 / diff。类型与
  // `AttemptEvidence.capabilities`(见「中性数据准备」)完全一致——这里复用同一个类型,
  // 不重新声明四个布尔位的门槛。计算函数从 `EvalResult` 已有的瘦身摘要位(`hasSources` /
  // `hasEvents` / `hasTrace`)与一次 `attempt.diff()` 懒加载算出,不对每个 item 调用完整的
  // `loadAttemptEvidence`(那还会额外装配 Eval 源码标注与 ExecutionTree,这里只要四个布尔位)。
  capabilities: AttemptEvidenceCapabilities;
}

// `ExperimentList` 一项里,一个 Eval 的展开行:折叠判定(foldEvalVerdict)、失败原因摘要
// (与 `reasonFor` 同一口径:error → skipReason → 未通过的 gate 断言,soft 断言永不进入)、
// 这道题内 attempt 的平均耗时/成本(两级聚合引擎在单一 eval 分组上退化成组内均值),以及
// 这道题的全部 Attempt(按 attempt 序号升序,供进一步展开到 AttemptList)。
interface ExperimentListEvalRow {
  evalId: string;
  verdict: Verdict;                   // 折叠判定(任一 attempt 通过则通过,否则取最严重的)
  reason?: string;
  duration: MetricCell;               // 这道题内 attempt 的平均耗时
  cost: MetricCell;                   // 这道题内 attempt 的平均成本
  attempts: AttemptListItem[];        // 这道题的全部 Attempt,按 attempt 序号升序
}

// `ExperimentList.data(selection)` 的一项 = 一个 experiment:身份(experimentId/agent/model)、
// 声明的 flags、Eval 判定构成(foldEvalVerdict 计票,与 view 榜单同一口径)、官方两级聚合
// 汇总指标(passRate/cost/duration/tokens,直接来自 computeCell,不现场重算),以及展开到
// 这个 experiment 每道 Eval 的 evalRows(按 eval id 升序)。
interface ExperimentListItem {
  experimentId: string;
  agent: string;
  model?: string;
  flags?: Record<string, unknown>;
  verdicts: { passed: number; failed: number; errored: number; skipped: number };
  passRate: MetricCell;                // 官方两级聚合口径,与 MetricTable.data(..., columns: [passRate]) 同一台引擎
  cost: MetricCell;
  duration: MetricCell;
  tokens: MetricCell;
  evals: number;                       // 覆盖的 eval 数(去重后,与 verdicts 四项之和一致)
  attempts: number;                    // 覆盖的 attempt 总数(原始计数,含多轮重试)
  lastRunAt: string;                   // 所含快照中最近的 startedAt
  evalRows: ExperimentListEvalRow[];   // 展开到这个 experiment 的 Eval,按 eval id 升序
}

// `EvalList.data(selection)` 的一项 = 一个 experimentId + evalId(同一个 Eval 跑在两个
// experiment 上是两条不同结果,不合并)。判定、分数(examScore 的两级聚合)、这道题内
// attempt 的平均耗时/成本,失败原因摘要(与 ExperimentListEvalRow.reason 同一口径),
// 外加展开到这道题全部 Attempt 的 attempts(按 attempt 序号升序)。
interface EvalListItem {
  evalId: string;
  experimentId: string;
  verdict: Verdict;
  reason?: string;
  score: MetricCell;                   // examScore 的两级聚合;单一 eval 分组下即这道题的题级分数
  duration: MetricCell;
  cost: MetricCell;
  attempts: AttemptListItem[];         // 展开到这道题的全部 Attempt,按 attempt 序号升序
}

interface MetricColumn {
  key: string;                        // = metric.name,与 cells 的键对应
  label: string | Partial<Record<ReportLocale, string>>;   // 数据层原样携带,渲染面按 locale 解析
  unit?: string;
  better?: "higher" | "lower";        // 渲染提示:排序方向、轴向、涨跌配色
}

interface MetricCell {
  value: number | null;               // 聚合后的值;null = 该组没有任何有效样本
  display: string;                    // 已格式化("87%" / "1.2k lines" / "$0.31"),前端可直接渲染
  samples: number;                    // 有效 attempt 数(值为 null 的不计入)
  total: number;                      // 组内 attempt 总数;samples < total = 有 attempt 测不了这个指标
  refs?: AttemptLocator[];            // 这个格子由哪些 attempt 算出 —— 回到证据的引用
}

type AttemptLocator = string;         // 不透明短字符串(如 "@1x7f3q"),由 {experimentId, 快照 startedAt,
                                       // evalId, attempt 序号} 四元组确定性派生;不是数组下标,也不是
                                       // 目录路径。reader 打开结果根目录时建好 locator → AttemptHandle
                                       // 的索引;查不到、格式不对或撞键都是结构化报错,不回退猜测
                                       // (完整编码与索引契约见 Results Lib)。
```

这些**不是持久化格式,只是组件 props**——没有 `format` / `schemaVersion` 信封,也不打版本戳(裁决记录 3)。要落盘喂 SPA(场景二)就自己包一层 JSON,想加 `generatedAt` 加就是了。兼容性跟随 npm 版本:计算侧和渲染侧本来就是同一个包的两个子路径,同一个应用里天然同版本;唯一的**硬要求**是分离部署(CI 脚本算数据、另一个仓库的前端渲染)时把两边锁在同一个 niceeval 版本。

## DX 模拟

### 场景一:Next.js RSC —— 见[第一档](#第一档react-组件--报告页是你应用里的一页)开头

算与画同页,`await` 就地发生;数据换新 = 重跑 `niceeval exp`,页面刷新即最新。

### 场景二:任意 SPA —— CI 落 JSON,前端 fetch

计算跑在出结果的地方(CI),页面在哪都行(Vite、已有内部面板、无 Node 的静态托管):

```typescript
// scripts/build-report-data.ts —— CI 里 niceeval exp 之后执行
import { writeFile } from "node:fs/promises";
import { openResults } from "niceeval/results";
import { examScore } from "niceeval/report";
import { Scoreboard, MetricMatrix } from "niceeval/report/react";

const results = await openResults(".niceeval");
const selection = results.latest({ experiments: "midterm/" });

await writeFile("public/midterm.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  warnings: selection.warnings,
  board: await Scoreboard.data(selection, {
    rows: "agent", subjects: "evalGroup", weights: { "algebra/": 2 }, fullMarks: 100,
  }),
  byEval: await MetricMatrix.data(selection, { rows: "eval", columns: "agent", cell: examScore }),
}));
```

```tsx
// 前端(任何 React 应用)—— 组件纯渲染,client 侧可用
import { Scoreboard, MetricMatrix } from "niceeval/report/react";

const doc = await fetch("/midterm.json").then((r) => r.json());

<Scoreboard data={doc.board} />
<MetricMatrix data={doc.byEval} attemptHref={(locator) => `/attempts/${locator}`} />
```

和场景一是同一批 artifact、同一套组件,只是可序列化边界从「RSC 内存里」挪到了「一个 JSON 文件」。

### 场景三:零框架静态导出 —— 以 coding-agent-memory-evals 为原型

真实仓库 coding-agent-memory-evals 今天的静态导出是三段式:脚本 A 按 mtime 挑「最新 run」、按白名单手拷 artifact 进 `site/data/run/`(提交进仓库,否则 CI 上没有数据、会悄悄生成空报告);脚本 B 调 `niceeval view --out` 生成通用查看器,再**用字符串标记从生成的 HTML 里扒出内嵌 JSON**、正则消毒构建机路径、塞回去;Vercel 静态托管 `site/`。三处都在重新发明布局知识——而且页面只能是 view 的三个通用 tab,这套件真正要回答的「记忆开关值不值」根本摆不出来。

重构后,整条流水线是「读 → 算 → `renderToStaticMarkup`」,不需要任何前端框架:

```tsx
// scripts/snapshot.ts —— 跑完 eval 在本机执行:把最新快照瘦身提交进仓库
// (沿用该仓库的铁律:线上构建只吃提交的数据,CI 上没有 .niceeval,绝不悄悄出空报告)
import { openResults, copySnapshots } from "niceeval/results";

const local = await openResults(".niceeval");
const picked = local.latest({ experiments: "compare/" });
// o11y 带上:报告里的 turns、repeated-failed-cmds 都读它,漏了这一项发布出去就是整列「—」。
await copySnapshots(picked, "site/data/run", { artifacts: ["sources", "events", "trace", "o11y"] });
```

```tsx
// scripts/build-site.tsx —— tsx 直跑;报告页是纯函数,从提交的快照静态渲染一次成型
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { openResults } from "niceeval/results";
import { passRate, costUSD, durationMs } from "niceeval/report";
import { RunOverview, DeltaTable, MetricScatter, MetricMatrix, AttemptList } from "niceeval/report/react";

const results = await openResults("site/data/run");
const selection = results.latest();

const PAIRS = ["bub-gpt-5.4", "codex-gpt-5.4", "claude-dp-v4"].map((c) => ({
  a: `compare/${c}`, b: `compare/${c}--agents-md`, label: c,
}));
const attemptHref = (locator) => `view/#/attempt/${locator}`;   // 证据室:同站托管的 view
const attempts = await AttemptList.data(selection, { redact: (s) => s.replaceAll(process.cwd(), "") });
const failures = attempts.filter((x) => x.verdict === "failed" || x.verdict === "errored");

const page = renderToStaticMarkup(
  <main>
    <h1>Memory 开关值不值</h1>
    <RunOverview data={await RunOverview.data(selection)} />
    <DeltaTable data={await DeltaTable.data(selection, { pairs: PAIRS, metrics: [passRate, costUSD, durationMs] })} />
    <MetricScatter data={await MetricScatter.data(selection, { points: "experiment", series: "agent", x: costUSD, y: passRate })} />
    <MetricMatrix data={await MetricMatrix.data(selection, { rows: "eval", columns: "experiment", cell: passRate })} attemptHref={attemptHref} />
    <AttemptList items={failures.slice(0, 20)} total={failures.length} />
  </main>,
);
writeFileSync("site/index.html", `<!doctype html><link rel="stylesheet" href="styles.css">${page}`);

// 证据室:transcript / 代码视图 / trace 仍归 view —— 目录导出放子路径,报告页深链进去
// `niceeval view --out site/view site/data/run`(现有 CLI,脚本里 execFile 即可)
```

分工:**报告页是前门**(这套件自己的问题、自己的摆法),**view 是证据室**(attempt 级 transcript / 代码 / trace)。构建机路径消毒收进 `AttemptList.data` 的 `redact` 钩子;展示范围由普通数组过滤决定。

### 场景四:深接入 —— 组件表达不了的,拿句柄自己算

分布类的看法(直方图)不是折叠,计算函数给不了;直接下到结果库的读取面,示例见 [Results Lib · 直接吃读取面](results-lib.md#直接吃读取面一个真实脚本)。

## 报告页交给官方命令渲染:defineReport 与双面组件

> 2026-07 迭代,取代本节此前的「数据块 + kind 分发」草案。`defineReport` 基座、双面组件、渲染前解析 selection-form 组件的 resolve 阶段、树校验与两个渲染入口(`renderReportToText` / `renderReportToStaticHtml`)已实现;两个宿主的 `--report` 装载都已接线(装载入口 `loadReportFile` 在中性模块 `src/report/load.ts`,`show` 接线在 `src/show/index.ts`、`view` 接线在 `src/view/data.ts`,按下方矩阵落实)。砍第一版 `defineReport` 时的结论「报告页永远住在用户自己的应用里」修正为:**报告页直接交给官方命令 `show` / `view` 渲染**——打开结果、挑快照、渲染页面的那一侧下文称「宿主」,`show` 是终端宿主,`view` 是网页宿主;用户应用只是零件复用的去处。中间经历过一版「报告 = 返回 kind 判别联合的函数」:类型最安全(判别联合天然编译期穷尽),但它把 `--report` 的表达力封死在官方积木的组合上——要自己的展示形态就得整页搬回自己的应用,排版也没有着落。定稿选组件树:换摆法、换口径、换形态三个层次都留在同一个文件、同一对宿主里;类型上的差距用字面量键泛型和渲染前树校验补齐(见「类型义务」)。公开叙事的准绳是 `docs-site/zh/guides/custom-reports.mdx` 与 `report-components.mdx`,本节记内部决策与实现要点。

### 命名与形状决策一览

设计定稿时对着落选方案拍的板,每条一句话理由;实现按定稿一次性收敛,不留兼容层:

| 定稿 | 落选 | 一句话理由 |
|---|---|---|
| `openResults` + 实验/快照分层 | `openExperiments`;平铺 `runs`+`snapshots` | 与模块名、返回物、示例变量名对齐;「results 三次」的病根在层次不在入口名 |
| `copySnapshots` | `copyRun` | 收快照就叫快照,别推翻自己刚教的 snapshot ≠ run |
| `results.latest()` 返回 `Selection`(结构化 warnings) | 返回 `{ snapshots, warnings }` 裸对 | warnings 可程序判断且随 Selection 自动进下游,诚实不靠使用者记得透传 |
| `RunOverview.data` / `MetricTable.data` /… 挂组件上 | 顶层独立函数 `overview` / `table` /… | 消灭 `Scoreboard`/`scoreboard` 大小写双胞胎与泛化顶层导出;配对打点即发现 |
| `defineReport` | `definePage` | 与 `--report` 同词,消灭「page/report」双词 |
| `flags` / `flag()` | `params` / `param()`(2026-07-10 当日早先定稿,同日翻案) | 语义就是 A/B 的 feature flag;撞词靠行文约定:裸词 flags = 实验 flags,命令行开关一律写「CLI flag」或字面 `--xxx`(2026-07-10) |
| `defineComponent({ web, text })` | `abstract class ReportComponent` | 归队 `define*` 家族;两个纯函数面用字面量正好 |
| 成绩单维度槽 `rows` | `of` | 与 `MetricTable.data` 的维度槽统一 |
| 渐进增强 runtime(浏览态排序 / 过滤 / tooltip,无 JS 内容完整) | 零客户端 JS,列头不可点 | 口径同源由计算侧 `sort` 预排保证,浏览态交互不分叉口径;view 默认首页的榜单没有排序过滤在浏览上不成立([memory](../memory/report-zero-js-to-progressive-enhancement.md)) |
| 内置默认报告 `CostPassRateComparison`(两组件扁平摆) | `defaultReport` 值 + `<DefaultReport />` 锚点 + 按目录前缀 Section 分组 | 报告按展示内容命名(成本 × 通过率图 + 实验明细表);「默认」只是宿主选择、不进名字;分组降为自定义报告的积木,不再是内置出厂决定 |
| 现刻水位选择器 `selectCurrentResults`(中性 results 层) | show 专属 `composeShowSelection`;view import `src/show/` | 两个宿主共用一个默认口径,选择属于中性读取/报告编排层;view 不该依赖 `src/show/` 才能挑默认 Selection |
| 报告 chrome 文案走内部字典 `src/report/locale.ts` | 复用 `src/i18n/` | `src/i18n/` 是 CLI 专属文案层(进程语境),报告组件要进任意 React 宿主与浏览器语境([memory](../memory/report-locale-rendering.md)) |
| `Selection.filter()`(只删不换) | 裸 `.filter()` 丢 warnings;更全的 Selection 代数 | 挑选身份在删减下封闭即可;替换式重挑本来就该回 `results`(2026-07-10) |
| `copySnapshots` 补记 `knownEvalIds` | 只补文档立场「发布后自求多福」 | 诚实契约不靠使用者记得;发布目录上警告由同一机制重算(2026-07-10) |
| 渲染前 resolve 阶段解析 selection-form 组件 | AsyncLocalStorage / 全局 current data / built-in 专属 `resolveDefaultReport` | data 计算是树上一步纯函数变换,不用隐藏通道偷 Selection;primitive 中性,不按组件名分支 |
| 宿主渲染入口统一渲染 `selection.warnings` 横幅 | 要求每份报告自己摆 `RunOverview` 才不丢警告 | 警告是宿主级保证,不依赖报告树含哪个组件;内置报告不含 `RunOverview` 也不静默丢警告(重复展示胜过静默丢失) |
| 散点恰好 1 个可画点 → 「至少两个实验才能比较」态 | 画孤立单点图;或组件返回空 | 比较类图单点没有可对比对象,明说原因比画孤点或让图消失都诚实;text/web 同一事实 |
| `skipped("incomplete")`,不做恢复 journal | 重开 writer 补 `finish()` | 判定只活在 summary;恢复要新增判定日志落盘,格式代价大于收益(2026-07-10) |
| 时间轴对比走 `DeltaTable` 快照键 | 专门的时间轴对比组件 | 键与 `"snapshot"` 维度同格式,view Compare 对齐同一个键,两套「对比」语义不分叉(2026-07-10) |
| 持久化字段改名递增 schemaVersion(flags→params→flags,现为 3) | 读取边界归一旧字段名 | 归一就是小型迁移,「不解析、不迁移、不猜」无例外;旧结果由 producer 提示旧版本工具看(2026-07-10) |
| 官方组件样式面 = `nre-*` + `className` + `<Style>` | slots / render props | 半自定义走 `defineComponent` 整个换,不在官方组件上开中间层(2026-07-10) |

### 一份报告 = 一个报告文件

报告基座 `defineReport`:宿主打开结果目录(含 `--run` 指定历史)、用 `selectCurrentResults` 挑好现刻水位 Selection,注入上下文;报告函数摆积木(需要时也可 `await` 自己折数据),返回一棵组件树:

```tsx
// reports/exam.tsx —— 一份定义,两扇门共用
import { defineReport, Col, Section, MetricScatter, ExperimentList, Scoreboard, costUSD, passRate } from "niceeval/report";

export default defineReport(async ({ selection }) => {
  const experiments = await ExperimentList.data(selection);
  return <Col>
    <MetricScatter selection={selection} points="experiment" series="agent" x={costUSD} y={passRate} />
    <ExperimentList items={experiments} />
    <Section title="考试成绩单">
      <Scoreboard data={await Scoreboard.data(selection, { rows: "agent", subjects: "evalGroup" })} />
    </Section>
  </Col>;
});
```

```bash
niceeval show --report reports/exam.tsx    # 同一棵树走 text 面
niceeval view --report reports/exam.tsx    # 同一棵树走 web 面,深链直达证据室
```

```typescript
interface ReportContext {
  /** 宿主用 selectCurrentResults 合成的现刻水位 Selection:对每个 experiment × eval 取跨该
   *  实验历史快照的最新判定,拼成合成快照 + 结构化挑选警告。这与 results.latest()(每实验
   *  单一最新快照,一次局部重跑就可能残缺)不是一回事——现刻水位跨历史补齐,局部补跑不会
   *  让报告退化成残缺快照。内置默认报告与 --report 吃同一份。 */
  selection: Selection;
  /** 现刻水位口径不合用时,全量数据自己挑(results.latest() 或手挑 Snapshot[],见 Results Lib)。 */
  results: ResultsCollection;
}
function defineReport(build: (ctx: ReportContext) => ReportNode | Promise<ReportNode>): ReportDefinition;
```

上下文从三样(`snapshots` / `warnings` / `results`)收敛为两样:快照与警告本来就是同一次挑选的两半,拆开注入等于逼报告作者自己保证它们来自同一次调用;收成 `selection` 后,报告作者看到的就是一个 `Selection`——与独立脚本里 `results.latest()` 返回的同一种形状,少学一个形状。区别只在这份 Selection 由宿主用 `selectCurrentResults` 合成(现刻水位,跨历史逐 eval 补齐),不是 `results.latest()` 的单快照结果:两者形状相同、口径不同。

### 宿主输入的组合语义(2026-07-10 拍板)

`--report` 不改 CLI 模型:位置参数仍选「看哪些 eval」,flag 仍选「怎么看」,它们先作用在挑选上、报告拿到已收窄的 Selection——同一个报告文件因此在任何范围下语义一致,不用自己长范围参数:

| CLI 输入 | 与 `--report` 组合 |
|---|---|
| 位置参数(eval id 前缀) | **生效**:收窄注入 Selection 覆盖的 eval;覆盖警告的分母 = 已知并集 ∩ 范围(不然「只看 weather/」会被 algebra 的缺口刷屏) |
| `--run <目录>` | **生效**:结果根换成该目录,Selection 在其上挑(与 `show` / `view` 裸跑同语义) |
| `--experiment <id>` | **生效**:Selection 只留该实验(`selectCurrentResults` 的 experiment 前缀过滤) |
| `--history` | **报错互斥**:它是内置的趋势视图;趋势口径在报告里用 `exp.snapshots` 自己摆 |
| `--eval` / `--execution` / `--diff` | 证据切面是宿主本体:出现即走证据室,不渲染报告槽(与默认报告同规则) |

两条硬边界,都从「可达百 MB 的 diff 不进渲染路径」推出来:**计算只发生在两个异步阶段**——报告函数体(`build`,读句柄、`await` 折数据)与渲染前的 resolve 阶段(框架对 selection-form 组件调 `.data()`,见「数据绑定与 resolve 解析阶段」);**渲染面是纯同步函数**(零 IO、零 await——React 静态渲染本身是同步的,text 面对齐同一约束,同一棵树才能既走 dev server 又被烘进静态导出)。

内置默认报告 `CostPassRateComparison` 无特权:它是普通 `ReportDefinition`,数据全部来自公开计算函数,页面上每个数字用户都能用同样几行原样重算。它渲染的口径就是宿主注入的那份现刻水位 Selection——跟随命令行范围(位置前缀 / `--run` / `--experiment`),不是报告函数体内用 `results` 自挑的口径。`niceeval view` ≡ `niceeval view --report <CostPassRateComparison>`;`niceeval show` 裸跑渲染它的 text 面。**报告槽只有一个,默认只是出厂填充**:不做 tab、不做注册表,「默认 + 自己的」在报告文件的 tsx 里组合——要「官方摆法 + 自选口径」,就 import 同一批组件(`MetricScatter` / `ExperimentList` …)自己摆。view 的结构是「报告槽 + 证据室」:报告槽整个归 `--report`,证据室(AttemptModal / Traces)是宿主本体,组件经证据引用深链进去([View](view.md));`show` 同构,证据切面(`--eval` / `--execution` / `--diff`)是宿主本体。

### CostPassRateComparison:内置默认报告

内置默认报告定名 `CostPassRateComparison`,作为值从 `niceeval/report` 导出,类型就是 `ReportDefinition`——与用户 `defineReport` 的产物同型,没有私有通道,数据全部来自公开计算函数,页面上每个数字用户都能用同样几行原样重算。裸跑 `niceeval show` 渲染它的 text 面,`niceeval view` 把它填进报告槽渲染 web 面:裸跑 ≡ `--report <CostPassRateComparison>`,「默认」只是报告槽的出厂填充,不是特权。名字按展示内容取:`CostPassRate` 点出图的两个轴是 estimated cost 与 pass rate,`Comparison` 表明它同时给图和明细表来比较 experiments;名字不含 `Default` / `Official` / `BuiltIn` / `View`。

文件是 `src/report/built-ins/cost-pass-rate-comparison.tsx`,整份正文只有 `defineReport` 与两个组件:

```tsx
export const CostPassRateComparison = defineReport(async ({ selection }) => {
  const experiments = await ExperimentList.data(selection);
  return <Col>
    <MetricScatter selection={selection} points="experiment" series="agent" x={costUSD} y={passRate} />
    <ExperimentList items={experiments} />
  </Col>;
});
```

- **一张扁平散点 + 一份实验列表,横跨整份 Selection。** `MetricScatter` 每点一个 experiment;`ExperimentList.data(selection)` 生成完整 experiment 数组,默认报告不额外过滤。实验列表逐项展开到 Eval,再经证据引用进入 Attempt。
- **散点的空态由组件自己表态,不由报告侧判断**:报告永远摆出一块 `MetricScatter`,由组件决定如何呈现数据不足(0 / 1 / 2+ 可画点规则见上文「第一档」的 MetricScatter 说明),从不静默消失。
- **警告不靠报告树携带**:内置报告没有 `RunOverview`,但 `ctx.selection.warnings` 由宿主渲染入口在报告输出前统一渲染成横幅(见「宿主级警告横幅」),partial-coverage / stale-snapshot / unfinished-snapshot 不会因为默认报告不含 `RunOverview` 而丢失。

分组仍是库能力,只是内置默认报告不再用它。`experimentGroupOf`(从 `niceeval/report` 公开导出)、`GroupSummary`、`Section` 都还在——自定义报告要按 experiment 组切分,用 `Selection.filter`(只删不换)把 Selection 收窄到某个组,再摆 `<Section title={组名}><GroupSummary data={await GroupSummary.data(scoped)} /> … </Section>`,与从前内置默认报告的分组形态一致。删掉的只是「内置默认报告默认帮你分组」这一个出厂决定,不是分组积木本身。

### 数据绑定与 resolve 解析阶段

`MetricScatter` 的 props 是判别联合,两臂互斥:

- **selection-form**:有 `selection` 字段外加 `points` / `series` / `x` / `y`,`data` 字段必须缺席。
- **data-form**:有算好的 `ScatterData`,`selection` 与全部计算选项必须缺席。

三个实体列表不走 selection-form:`.data(selection)` 明确产出普通数组,作者过滤后传 `items`。这让过滤过程留在普通 TypeScript 里,不会藏进 resolve 阶段。

渲染管线因此多一个异步解析阶段,四步定序:

```text
definition.build(ctx)  →  resolveReportTree(node)  →  validateReportTree(node)  →  render(text 或 web)
```

- **`build(ctx)`**:报告函数体,允许 IO / `await`——挑数据、摆积木,返回组件树。selection-form 的节点此刻 props 里还是 `selection` + 选项。
- **`resolveReportTree(node)`**:递归遍历报告树。双面组件的 faces 声明了可选的 `resolve(props)` 时,`await` 它、把解析出的 data-form props 换进节点;纯函数组件照旧调用展开;数组 / Fragment 的儿子们经 `Promise.all` 并行解析,原始节点顺序不变。selection-form 组件的 `resolve` 调的就是该组件既有的 `.data(selection, options)`,不复制公式;data-form 组件没有 `resolve`(或 `resolve` 原样返回),跳过计算。这是唯一允许 IO / `await` 的第二处,且只存在于框架——报告文件里不出现 `Promise.all` 或 `.data()`。
- **`validateReportTree(node)`**:渲染前树校验(字符串 intrinsic 报错,见「元素树与两个宿主」),跑在已解析的树上。
- **`render`**:text 面遍历 / web 面 `renderToStaticMarkup`,纯同步、零 IO——渲染面只看 data-form props,可达百 MB 的 artifact 永不进渲染路径。

`resolve` 是中性 primitive,不写 `MetricScatter` / `MetricTable` 名字判断;任何双面组件都能声明它来提供 selection-form。宿主(`show` / `view`)与两个渲染入口 `renderReportToText` / `renderReportToStaticHtml` 都跑这条同一管线,所以裸跑默认报告与 `--report` 走完全相同的解析与渲染,text / web 两面拿到同一份解析后的 data。

**什么时候用哪一臂**:

- **selection-form** 用在报告文件里——经 `defineReport` 交给 `niceeval show` / `view`(或直接调 `renderReportToText` / `renderReportToStaticHtml`)渲染,宿主的 resolve 阶段替你算 data。这是内置默认报告和绝大多数自定义报告的写法。
- **data-form** 用在没有宿主 resolve 阶段的地方:把组件直接嵌进你自己已经在渲染的 React 应用(RSC / SPA,见「DX 模拟」场景一、二),或数据是预计算 / 缓存 / 跨进程边界序列化来的(CI 落 `report.json` 再 fetch 渲染,场景三)。这些路径按定义没有框架的 resolve pass,组件必须拿到算好的 `data`;`docs-site` 自定义报告页里的「零件复用进自己应用」示例就是这一类,只能直接给 data。

### 宿主级警告横幅

`renderReportToText` 与 `renderReportToStaticHtml` 在渲染报告树之前,无条件把 `ctx.selection.warnings` 渲染成一小段警告横幅,摆在报告输出最前面——对每一份报告都如此,内置或自定义都一样。这是宿主级保证,不是报告作者的职责:内置 `CostPassRateComparison` 不含 `RunOverview`,partial-coverage / stale-snapshot / unfinished-snapshot 仍出现在页面顶部,不会因为报告树里没有哪个组件读 warnings 就静默丢失。

代价是可能重复:自定义报告若在自己的树里也摆了 `RunOverview`(它渲染 `overview.warnings`)或自己读 `selection.warnings`,警告会显示两遍。这是有意接受的取舍——重复展示胜过静默丢失;要只显示一遍,自定义报告不摆 `RunOverview` 即可,宿主横幅仍保证警告在场。

### locale:渲染面的语言

官方组件的 chrome 文案(verdict 词、缺数据说明、composed-from 标注、坐标轴提示这类组件自带文案)按 locale 渲染:

```typescript
type ReportLocale = "en" | "zh-CN";   // 默认 "en"

renderReportToStaticHtml(report, { …, locale: "zh-CN" });
renderReportToText(report, { …, locale: "zh-CN" });
```

- locale 是**渲染面参数**,两个渲染入口的 options 收它,经 `WebContext` / `TextContext` 携带进每个面;数据层不按语言分裂——同一份组件数据可以被渲染成任意语言。
- chrome 文案的字典是 report 内部的 `src/report/locale.ts`。不复用 `src/i18n/`:那是 CLI 专属文案层(命令行 help、错误提示,Node 进程语境),报告组件要在任意 React 宿主与浏览器语境里成立——两层的受众、词表与运行环境都不同,合并只会互相牵制(裁决出处见 [memory](../memory/report-locale-rendering.md))。
- 指标 `label` 的类型是 `string | Partial<Record<ReportLocale, string>>`:数据层(`MetricColumn.label`)原样携带,渲染面按 locale 解析;缺当前语言时回退 `"en"`,再回退字典里任一非空值,全空退指标 `name`。
- `display` 不本地化:它是 `unit` 驱动的 format 产物(`"87%"` / `"$0.31"`),在计算侧生成、跨语言一致——数字的显示是口径的一部分,不随语言漂。
- 宿主怎么用:`view` 把报告槽渲染两遍(en 与 zh-CN)烘成两个 `<template>`,壳按当前界面语言摆放,切语言不重算数据;`show` 把 CLI 界面语言传给 `renderReportToText`。

### 元素树与两个宿主

报告函数返回的树不是「React 树」,只是 `{ type, props }` 节点——标准 react jsx-runtime 产的元素恰好就是这个形状(两个宿主遍历/校验到的树都是 resolve 阶段之后的:双面组件的 props 已被解析成 data-form,见「数据绑定与 resolve 解析阶段」):

- **text 宿主(`show`)**:直接遍历节点。type 是双面组件(`defineComponent` 的产物)→ 调它的 `text(props, ctx)`;是普通函数(用户拿函数组合页面片段)→ 调用展开;Fragment / 数组 → 依次;**字符串 intrinsic(`<div>`)→ 报错**。全程不需要 react-dom。
- **web 宿主(`view`)**:用宿主自己 import 的 react 把节点转成真元素,`renderToStaticMarkup` 吐静态 HTML,烘进查看器的报告槽。`defineComponent` 的基础实现不 import react,产物以可调用组件的形状兼容 React 渲染——react / react-dom 维持 optional peer,只有 web 宿主真正 import。

「页面树里只放双面组件」是**运行时校验,不是编译期**:标准 JSX 下 TS 把一切 JSX 表达式统一成 `JSX.Element`,类型上区分不了 `<div>` 和 `<Col>`;自定义 jsxImportSource 能做到,但要用户改 tsconfig 或加 per-file pragma,还会跟 web 面里的真 React JSX 打架,不做。两个宿主在渲染前跑同一遍树校验,错误指名组件路径(`Raw HTML <div> has no terminal face; use <Text>, layout primitives, or a defineComponent component.`)——不做单侧宽容,否则对着 view 写的页面到 show 才炸。

一处如实的依赖代价:报告文件是 .tsx,tsx 编译产物 import `react/jsx-runtime`,所以**写自定义报告的项目要装 react**(写 web 面本来也需要 `@types/react`);裸跑 `show` / `view` 不受影响,内置默认报告不经用户项目的 jsx。

### 双面组件:一个定义,两个纯函数面

早稿是 `abstract class ReportComponent<P>`,定稿改工厂函数:全家族都是 `define*`,唯独扩展组件要 `class … extends` 是体系里的异类;两个渲染面本质就是两个纯函数,一个对象字面量正好。「少实现一个面编译不过」的强度不降——`web` / `text` 两个渲染面必填,`resolve` 选填(声明了就提供 selection-form,见「数据绑定与 resolve 解析阶段」):

```typescript
function defineComponent<P, R = P>(faces: {
  /** 可选:selection-form → data-form 的异步解析,框架在渲染前的 resolve 阶段跑。
      纯 data-form 组件省略它(P 即 R);声明了它,props 才可以是 selection-form。 */
  resolve?(props: P): Promise<R>;
  /** 真 React JSX 在这个面里;只看已解析的 data-form props(R),纯同步、零 IO。 */
  web(props: R, ctx: WebContext): ReactNode;
  text(props: R, ctx: TextContext): string;
}): ReportComponent<P>;   // 产物可直接用在 JSX 里:<PassBars rows={rows} />
interface TextContext {
  /** 可用列宽;Row 分栏后变窄。 */
  width: number;
  /** 渲染语言,chrome 文案与 label 解析用(见「locale:渲染面的语言」)。 */
  locale: ReportLocale;
  /** 容器组件渲染 children 用,宽度显式传递。 */
  render(node: ReportNode, width?: number): string;
  /** 下钻命令,通证据室:niceeval show @<locator>。 */
  attemptCommand(locator: AttemptLocator): string;
}
interface WebContext {
  /** 渲染语言,chrome 文案与 label 解析用。 */
  locale: ReportLocale;
  /** 证据室深链,同 view 的 attempt 路由。 */
  attemptHref(locator: AttemptLocator): string;
}
```

现有七个 react 组件(`src/report/react/`)收编为对应双面组件的 web 面,text 面新写;`niceeval/report/react` 的导出保留,供「零件复用」进用户自己的应用(两个导出点上组件都带自己的 `data` 函数)。**配对从 vitest 表升级成结构义务**:`faces` 两键必填,少实现一个面编译不过;双面验收测试(renderToStaticMarkup + text 快照)守护两面对同一份数据给出一致判读——排序方向随 `better`、`samples < total` 角标、缺数据 `—` 不补 0、截断如实报剩余数量。早先草案里的公开导出面 `niceeval/report/text` 不再需要:文本渲染住在组件的 text 面里,公开面只有组件。

排版原语 `Row` / `Col` / `Section` / `Text` 就是四个内置双面组件,没有特殊机制:`Row` 的 text 面用 `ctx.render(child, 子宽)` 逐列渲染再拼行,宽度不足降级纵向;web 面是横向排布。用户自定义组件与官方组件走同一个 `defineComponent`、同一对 ctx,通到同一间证据室。

自定义组件的网页样式:静态导出不打包用户代码,className 引用的 CSS 用内置原语 `<Style>{css}</Style>` 随树带走(web 面吐 `<style>` 标签,text 面渲染为空)。自定义组件不打包、不注册任何客户端 JS,交互限普通链接与 `<details>`,与官方组件同一条「不 hydrate、无 JS 也完整」契约;渐进增强 runtime 是属性驱动的(只认 `.nre` DOM 与 `data-nre-*`),自定义 web 面吐出同样的标记就享有同样的浏览态行为,不吐就全静态,两种情况页面都完整。这维持了砍 `defineReport` 时拒绝「即时构建 / hydration / 样式冲突」重机械的立场:用户模块本来就被 tsx 加载进计算进程,静态渲染 web 面只是多调一个纯函数,没有打包机械。

### flags 与新摆法

scaling 类报告(并行 agent 数 × 模拟延迟 × 得分)的变量不该编码进 experiment id 再靠解析字符串抠回来。`ExperimentDef` 的 `flags?: Record<string, string | number | boolean>` 由 runner 原样透传进持久化字段 `ExperimentRunInfo.flags`;报告侧 `flag(name, opts)` 把声明值当维度(`series` / `rows` / `columns` / `points` 槽,按值分组)或轴(`x` 槽,要求数值并驱动刻度)。未声明该 flag 的 experiment 不猜:分组如实归「未配置」,作轴不画点、注脚报数。

**命名裁决记录**(2026-07-10,同日两裁):本节初稿曾以「与 CLI flag(`--report`、`--transcript`)撞词」为由,把已发布的运行时链路 `experiment.flags → ctx.flags → t.flags` 成套改名 `params`(持久化字段随之改名,schemaVersion 2)。同日用户翻案改回 `flags`(schemaVersion 3):这个字段的语义就是产品 A/B 测试里的 feature flag——一个 experiment 是一组 flag 取值,A/B 域的 multivariate flag 本来就装任意 JSON,「flags 暗示布尔」只在 CLI 域成立;撞词靠行文约定解决:裸词 flags 指实验 flags,命令行开关一律写「CLI flag」或字面 `--xxx`。两次改名共同确立的原则不变:持久化字段改名是破坏性变更,递增 schemaVersion,旧落盘按版本规则进 `skipped("incompatible-version")`,不归一、不迁移——读取边界给旧名做别名就是一次小型迁移,「不解析、不迁移、不猜」无例外;旧结果不丢,`skipped` 携带的 producer 提示 `npx niceeval@<version> view` 正是为这种场景存在。版本序列见 [Results Format](results-format.md)。首批随本提案补两个摆法:趋势线 `MetricLine`、分组条形 `MetricBars`(`.data` 为矩阵数据别名),与七个现有产物承担同一套双面义务。

### 类型义务(本提案的落地前置)

公开页承诺「类型化」「编译器背书」,三处目前兑现不了,随本提案一起还:

1. **格子键从字符串裸奔改字面量联合。** `defineMetric` 对 `name` 做 const 泛型,`MetricTable.data` / `DeltaTable.data` 对 columns 元组做泛型,`TableData<K>` 的 `cells: Record<K, MetricCell>`——拼错列名要编译不过,而不是运行时 `undefined.value` 崩。数据要跨可序列化边界,所以不做 `row.cell(metric)` 这类方法访问器;示例一律写 `r.cells[passRate.name]`,键锚在指标对象上,不裸写字符串。`sort: passRate` 已按对象身份传,格子访问与它对齐。
2. **`MetricCell.refs` 必填**(允许空数组)。「每个数字点进去就是证据」是页面的核心承诺,可选字段会让深链静默缺失。
3. **`EvalResult` 两拆**(持久化瘦身条目 / view 运行时装饰)。早稿是三拆,多出的「写入输入」变体(大字段内联的完整 EvalResult)随 writer 改签名作废:`writeAttempt(result, artifacts)` 的第一参是 attempt 级条目——reader 的 `attempt.result` 中,快照级字段(agent / model / startedAt / producer,由 `writer.snapshot()` 一次声明)以外的全部;第二参是懒加载 artifact 的类型——「writeAttempt 参数 + snapshot() 声明 = reader 读回的全部」由类型拼合成立,不需要中间形状。归 [Results Lib](results-lib.md) 的类型迁移步,与本提案同批排期。

### 与被砍的第一版 `defineReport` 的区别

第一版死于三层中转,现在一层中转都没有。名字复用是有意的:被砍的是**形态**(目录发现 / 文档格式 / 专门 CLI),不是名字;`--report` 收的文件默认导出与 flag 同词,才不用「page」另造一词:

| 被砍的形态 | 现在的形态 |
|---|---|
| `reports/` 目录自动发现 | 无发现,路径显式经 `--report` 递入 |
| `ReportDoc` 文档格式 | 无新格式,普通 .tsx 模块以 `defineReport` 默认导出 |
| `niceeval report` 专门 CLI | 无新命令面,现有 `show` / `view` 宿主 |

`--report` 走 flag 不走位置参数,CLI 模型(位置参数 = eval id 前缀)不破([CLI](cli.md));模块加载复用跑用户 `.ts` 配置 / eval 文件的同一 tsx 机制,宿主负责 `openResults`(含 `--run`)并注入上下文,报告文件自己不碰路径——同一个文件在两个宿主、任意结果目录下语义一致。

## 边界与不变量

- **core 中立不破。** 指标函数是用户代码,想读什么 artifact 读什么;但计算函数与组件只认 `Metric` / `Dimension` 接口,不出现 `agent === "codex"` 这类分支。「考试」「benchmark」「frontier」都不是 core 概念,只是积木摆法。
- **Report 不写事实。** 唯一事实来源仍是 Results Format;组件数据是派生物,删了随时可重算,因此不需要迁移机制。
- **null ≠ 0。** `null` = 此 attempt 测不了这个指标,不进聚合;`0` = 测了,结果是零,照常进。每个指标(含内置)对四个 verdict 逐一表态;`MetricCell` 用 `samples` / `total` 如实报覆盖率,一组全 `null` 渲染成缺数据,绝不补 0(与[成本设计](observability.md#换算成本价格表从哪来)「未知模型不瞎猜」同一原则)。scoreboard 的固定分母是显式的考试契约、不是这条的例外:没答的题 0 分挣,`missing` 如实报。
- **报告不重新判卷。** 指标只消费落盘的 `verdict` 与断言,不推翻 run 时的判定口径;换口径的正确位置是重跑,不是报告。
- **选择诚实。** 残缺快照、被跳过的 run、发生过的去重,全部以 `warnings` / `skipped` 返回给调用方,不静默;组件对 `samples < total`、全 `null` 的格子和缺数据的点如实渲染。宿主渲染入口(`renderReportToText` / `renderReportToStaticHtml`)另在报告输出前统一渲染 `selection.warnings` 横幅(见「宿主级警告横幅」),任何报告——无论它的树里含不含 `RunOverview`——都不会静默吞掉挑选警告。
- **跨快照聚合先去重。** 计算函数在聚合前按 [Results Lib 的身份键](results-lib.md#身份键与去重)去重——`--resume` 会让同一 attempt 存在于多份落盘,细节与键的定义见那边。
- **快照身份保留在结果库。** 合并与聚合永远发生在计算函数里,可被用户的选择与聚合配置覆盖。
- **数据 ↔ 两面成对。** 每种数据产物必须同时有 web 面与 text 面——`defineComponent` 的 `faces` 两键必填,配对是结构义务而非配对表;双面验收测试守护两面判读一致。缺一面就不能发新组件(否则 `--report` 在两个宿主下不对称)。

## 迭代问题裁决记录

早先挂在这里的「待定 DX 问题」已全部裁决(2026-07-10),每条记决定与理由:

1. **时间轴 delta:不做新组件,`DeltaTable` 收快照键。** `pairs` 的 `a` / `b` 除 experiment id 外也收快照键 `<experimentId> @ <startedAt>`(与 `"snapshot"` 维度同一格式)。时间轴对比本来就要旧快照,`latest()` 里没有——配手挑的 `Snapshot[]`(如 `[exp.latest, exp.snapshots[1]]`)按快照键配对。view 的 Compare 落地时对齐这同一个键,两套「对比」语义不分叉。
2. **`refs` 完整携带,不设上限。** 「每个数字点进去就是证据」不打折;单格样本数有限,全历史矩阵的规模由消费方用 Selection 控制,不由组件截断。
3. **组件数据不打版本戳。** 同应用内计算与渲染同包同版本,天然无偏斜;分离部署(CI 算数据、另一仓库渲染)把两侧锁在同一 niceeval 版本是**硬要求**,不是建议——版本戳解决不了偏斜,只能把它报出来,锁版本让它不发生。
4. **官方组件不开 slots / render props。** 样式面只有三样:稳定 `nre-*` 类名、`className` 透传、`<Style>`。半自定义的正确姿势是 `defineComponent` 整个换——在官方组件上开渲染口子就是造中间层,格子渲染、点标签策略这类需求都归自定义组件。
5. **view 的 attempt 级深链:改判给 `AttemptLocator`。** 随 `AttemptLocator` 重设计改判为不透明的 `#/attempt/@<locator>` 单段路由(见 [View · 用 Reports 积木重建 view](view.md#用-reports-积木重建-view)),已实现。「报告页是前门、view 是证据室」的分工闭环不变,变的只是深链参数的编码。
6. **`view --report` 的装载语义。** dev server 模式:报告文件变更**整页重算**,不做细粒度热重载——计算全部住在报告函数体里,整页重算是唯一与这条边界一致的语义。`--out` 模式:报告树在计算侧 `renderToStaticMarkup` 成 HTML 烘进报告槽,证据室沿用 `__NICEEVAL_VIEW_DATA__` 的数据契约不动。两个宿主共用同一套装载语义,实现顺序(show 先行)不影响这两条。
7. **`missing-startedAt` 不透出到组件数据。** `writer.snapshot()` 的 `startedAt` 必填,官方产出与走写入面的第三方转换永不缺;缺失只可能来自 legacy 落盘,计算函数「不去重、如实保留重复」的兜底即终稿,不给各 `data` 产物加 warnings 通道(`dedupeAttempts` 直调时警告仍随返回值走)。

## 相关阅读

- [Results Lib](results-lib.md) —— 结果读写库:类型的家、writer、openResults、实验/快照层次、选择器、身份键。
- [Results Format](results-format.md) —— 唯一持久化事实来源。
- [Runner](runner.md) —— earlyExit 与重试的调度行为:两级聚合的动因。
- [Observability](observability.md) —— usage / cost / o11y 摘要这些指标原料从哪来。
- [View](view.md) —— 内置前端;报告槽的默认填充是内置 `CostPassRateComparison`,快照口径与 Compare 计划与本提案对齐。
- [Experiments](experiments.md) —— 可对比组与 reasoningEffort 档位:scatter 的点从哪来。
- [Scoring](scoring.md) —— gate / soft 断言语义,`examScore` 的依据。
