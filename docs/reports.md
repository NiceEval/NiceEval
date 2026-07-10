# Reports —— 自己搭报告页的积木(设计提案,未实现)

> 状态:设计已定稿;`src/report/` 里已有一版实现(独立计算函数 + 纯 react 组件,源码入口见 [Source Map](source-map.md#results-lib-与-reports)),与本文有差距,按本文一次性收敛、不留兼容层,命名决策见[「命名与形状决策一览」](#命名与形状决策一览)。公开叙事的准绳是 `docs-site/zh/guides/` 的自定义报告 / 报告组件两页;脚下的数据层——结果的读与写——拆在 [Results Lib](results-lib.md)。文末待定问题仍开放。

跑完一轮实验之后,「怎么看结果」不该只有 `niceeval view` 那三个固定 tab。你想把同一批结果摆成一张**考试成绩单**(每个 eval 是一道题,gate 判对错、soft 给分、按科目算总分),摆成一张 **benchmark 榜**(谁写出来的代码能用、谁写得更短、谁更便宜),或者摆成一张**质量 × 成本 frontier**(每个配置一个点,同 agent 不同档位连成线,右上角 = 又好又便宜)——这三种「看法」用的是同一份落盘工件,差别只在组合方式。

今天做不到:落盘工件虽然结构化,但没有读取契约,想算个自定义指标只能手工爬目录(那段痛苦的样子见 [Results Lib](results-lib.md) 开头);就算读到了,分组、聚合、null 处理、画图仍是全套手写。

本提案只给**两档积木**,没有中间格式:

```text
 第二档:数据(niceeval/results 读 + niceeval/report 算)  第一档:React 组件(niceeval/report/react,跑在哪都行)
 ---------------------------------------------------    --------------------------------------------------
 .niceeval/<run>/… ──openResults──▶ 实验/快照/选集    <MetricTable/> <MetricScatter/> <DeltaTable/> …共七个
 defineMetric × Dimension                      ──▶  props = 算好的可序列化数据(终值 + 渲染提示)
 MetricTable.data()/MetricScatter.data()… 折出终值    (排序、覆盖率角标、连线、点格子下钻)
 (两级聚合、null 语义、去重全在这侧)
```

- **第一档:React 组件。** 报告页就是你应用里的一页:import 组件,像搭积木一样拼 JSX。组件只认「算好的可序列化数据」,零 IO、可进 `"use client"`,所以 RSC、Vite SPA、静态导出都能用。
- **第二档:parser 与强定义。** `openResults`(来自结果读写库 [Results Lib](results-lib.md) 的读取面)把落盘工件变成「实验 → 快照 → eval → attempt」的类型化数据;`defineMetric` 加挂在组件上的 `data` 计算函数把它折成组件要的数据。组件表达不了的看法,直接拿数据自己算。

两档之间是一条**可序列化边界**:算与画分离,数据是普通 JSON——可以在 RSC 里当场 `await`,也可以在 CI 里落成 `public/report.json` 喂给任何 SPA。**import 边界即运行时边界**:`niceeval/results` 与 `niceeval/report` 的计算函数碰文件系统,只能进服务端/脚本;`niceeval/report/react` 纯渲染。可达百 MB 的 diff 永远不该在渲染路径上被读,这条边界就是为它划的。

> 与早先草案的差异:第一版有 `defineReport` + `reports/` 目录 + `ReportDoc` 文件格式 + `niceeval report` CLI,现已全部砍掉。报告页的宿主永远是用户自己的应用,为它发明「配置文件 → 文档格式 → 渲染 CLI」三层中转,每层都是学习成本,表达力反而不如 JSX(说明文字曾需要一个 `markdown()` 块——在 JSX 里那就是一行 `<p>`)。零代码看结果的需求归 `niceeval view`;本提案只服务「要自己的页面」的用户。(2026-07 补:报告页可以经 `--report` 直接递给官方宿主 `show` / `view` 渲染——无发现、无格式、无新命令,与被砍的三层中转不是一个东西,见[报告页交给官方命令渲染](#报告页交给官方命令渲染definereport-与双面组件设计提案未实现)。新方案还把报告基座命名回 `defineReport`:被砍的是「目录发现 / 文档格式 / 专门 CLI」三层中转**形态**,不是这个名字;flag 叫 `--report`,文件默认导出就该同词,不再另造「page」一词。)

## 与现有件的关系

| 件 | 时机 | 职责 |
|---|---|---|
| **Reporter**(`Console()` / `Artifacts()` / `JUnit()`…) | 运行**中**,流式回调 | 把结果送出去:打控制台、落盘、上报平台 |
| **Results Format**(`.niceeval/<run>/`) | 运行**后**,静态工件 | 唯一持久化事实来源([Results Format](results-format.md)) |
| **Results Lib**([提案](results-lib.md)) | 运行中写,运行后读 | 结果数据的专门库:类型的家 + writer(`Artifacts()` 的落盘实现)+ reader(类型化句柄/快照/选择器)。本提案的第二档吃它的读取面 |
| **Report(本提案)** | 运行后,按需 | 指标 × 计算函数 × React 组件,把落盘工件组合成**你自己应用里的报告页** |
| **`niceeval view`** | 运行后,按需 | 内置前端,零代码的通用看法——合流后就是「官方积木搭的默认报告页 + 证据室」,路线见 [View · 用 Reports 积木重建 view](view.md#用-reports-积木重建-view设计提案) |

Report 不新增任何落盘事实——它只消费 Results Format 已有的东西。反过来这也是设计约束:**一个指标能不能算,取决于工件里有没有对应数据**;工件缺了(比如 remote agent 没有 `diff.json`),指标对该 attempt 返回 `null`,聚合时跳过,不编数。

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
  where: (a) => a.result.outcome === "passed",   // 只比能用的代码(见「指标与聚合」)
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
      {/* 页头 KPI 条:何时跑的、几个配置、几道题、总成本;选集的残缺警告随行,直接显示在条内 */}
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
        attemptHref={(ref) => `/attempts/${ref.run}/${ref.result}`}   // 点格子 → 你自己的下钻页
      />
    </main>
  );
}
```

换一种看法 = 换积木摆法,数据源一个字不动:把 `MetricTable` 换成 `Scoreboard`、`cell` 从 `passRate` 换成 `examScore`,同一批工件就从 benchmark 榜变成考试成绩单(场景二)。说明文字、布局、品牌色都是你页面里的普通 JSX——这正是第一版 `markdown()` 块被砍的原因。

首批七个组件。边界不是抽象的「刻意少」,而是**让第一个真实消费者的报告页完整成立**:场景三里 coding-agent-memory-evals 的线上报告要回答「记忆开关值不值」,这七个缺一个都拼不完整,多的暂时都不加:

```typescript
// niceeval/report/react —— 纯渲染,零 IO,可进 "use client"
// 每个组件同时挂自己的 data 计算函数(RunOverview.data / MetricTable.data …),
// 算与画配对靠组件名后打点即可发现,契约见「计算函数与数据契约」
function RunOverview(props: { data: OverviewData; className?: string }): JSX.Element;
        // 页头 KPI 条:何时跑的、几个配置、几道题、通过率、总成本 —— 每张报告页的「这批数据是什么」

function MetricTable(props: {
  data: TableData;
  attemptHref?: (ref: AttemptRef) => string;  // 传了,格子可点、下钻去处你定;不传,纯展示
  className?: string;
}): JSX.Element;

function MetricMatrix(props: {
  data: MatrixData;
  attemptHref?: (ref: AttemptRef) => string;
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

function CaseList(props: {
  data: CaseListData;                         // 失败案例清单:报告回答完「多少」,这里回答「为什么」
  attemptHref?: (ref: AttemptRef) => string;
  className?: string;
}): JSX.Element;
```

组件内置的行为全是纯展示逻辑:

- **RunOverview**:通过率、成本、耗时这排数字下面标注数据来源(几个快照、何时跑的);`RunOverview.data(selection)` 收选集,warnings 随行直接显示在条内——诚实不靠使用者记得接线(若把 warnings 做成要手动透传的独立参数,忘了就静默丢失,这正是收选集的动机)。
- **MetricTable**:按 `sort` 预排,方向随指标的 `better`(higher 降序、lower 升序,「好」的一头在上);`samples < total` 的格子带覆盖率角标;一组全 `null` 渲染成「缺数据」,绝不画 0。
- **MetricMatrix**:稀疏渲染(没有样本的格子空着);`cell.refs` + `attemptHref` 让「哪道题谁挂了,一眼看穿」之后的下一步——「给我看那次 attempt」——就在手边。
- **Scoreboard**:总分 + 分科小计,`missing`(没跑、按 0 计的题数)如实展示在科目行,固定分母的口径不藏。
- **MetricScatter**:轴向随 `better`——`lower` 的轴反向画,「好」的角落恒在右上(成本轴 $20 → $0 就是这么来的);同系列的点按 x 排序连线,系列名标在线旁;x 或 y 为 `null` 的点不画,底部注脚如实报「n 个点缺数据」;hover 显示 `display` 与 `samples/total`。
- **DeltaTable**:每行一对配置(如「bub:裸 vs +AGENTS.md」),每列一个指标,格子里 A、B、Δ 三个值;Δ 的涨跌好坏由 `better` 判定,任一侧缺数据时 Δ 显示为缺,不硬算。
- **CaseList**:失败与出错的 attempt 逐条列出——失败断言、error 摘要、judge 评语(`evidence`),每条带 `attemptHref` 下钻;`truncated` 如实报「还有 n 条没列」。

四条跨组件的契约保证:

- **不 hydrate 也完整,两面同口径。** 每个组件在 `renderToStaticMarkup` 下必须产出完整可读的 HTML:排序靠计算时的 `sort` 预排,hover 信息退化为 `title`,下钻是普通 `<a>`,展开折叠用 `<details>`。2026-07 裁决:砍掉「列头可点重排」这类单面才有的口径操作——它和「静态导出零客户端 JS」只能活一个,而且 web 面一旦长出 text 面没有的口径开关,「人看到的和 agent 读到的一致」就开始分叉;要换排序,改一行 `sort` 重算,两扇门看到同一份顺序。静态导出是一等公民,不是降级模式(场景三)。
- **跨块配色一致。** 系列/维度键到调色板的映射是稳定散列:同一个 agent 在 scatter 的线、DeltaTable 的行、matrix 的列头永远同色,不需要 Provider 或手工配置。
- **样式随包发布。** `niceeval/report/react/styles.css` 一并发布:`nre-*` 稳定类名 + 这一份 CSS,静态页零依赖成立;要定制就在它之后加载自己的覆盖。
- **组件不做数据操作。** 过滤、重新聚合、换口径都是计算侧的事(改参数重算);组件只有展示态交互。想在页面上「只看某个 agent」,就多算几份数据条件渲染,不给组件加过滤器。

## 第二档:结果库的读取面(契约在 Results Lib)

结果数据的读与写抽成了专门的库 `niceeval/results`,完整契约在 [Results Lib](results-lib.md);本提案只消费它的读取面,这里备忘入口:`openResults(".niceeval")` 给出「实验 → 快照(单次跑的实验)→ eval → attempt」的类型化层次,外加 `skipped`(读不了的落盘,不静默)与低层的 `runDirs`(忠实磁盘);attempt 级重工件(`events` / `trace` / `o11y` / `diff` / `sources`)全部懒加载,缺了返回 `null`;`results.latest()` 返回 **Selection**(快照 + 结构化 warnings 绑在一起),残缺快照的警告替你算好。本文的计算函数统一收 `Selection | Snapshot[]`,其余部分都建立在这些数据之上。

## 指标与聚合:「算什么」的积木

### Metric —— 一个 attempt 算出一个值

指标是纯函数:吃一个 `AttemptHandle`,吐一个值(或 `null` 表示「此 attempt 测不了这个指标」),外加名字、两级聚合方式和渲染提示。

```typescript
import { defineMetric } from "niceeval/report";

// 自定义指标:生成代码总行数(code-golf 的「谁短」)
const codeLines = defineMetric({
  name: "code-lines",                 // MetricColumn.key 与列头的来源;同一次计算里重名是错误
  label: "代码行数",                   // 列头;省略时用 name
  description: "通过的 attempt 的生成代码总行数",
  better: "lower",                    // 渲染提示:越低越好(排序方向、轴向、涨跌配色用)
  unit: "lines",
  where: (a) => a.result.outcome === "passed",  // 不满足 → null。少这行,榜单会奖励「写得短的坏代码」
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;           // 没有 diff 的 attempt 不计入,不记 0
    return Object.values(diff.generatedFiles)
      .reduce((n, src) => n + src.split("\n").length, 0);
  },
  aggregate: { perEval: "mean", across: "mean" },   // 两级聚合(见下节);这就是默认值,可省略
});
```

`where` 只是把「先看 outcome 再计值」变成声明,语义等价于在 `value` 开头 return null。单独设字段,是因为这一步最容易忘:code-golf 的本意是「**能用** × 短」,忘了它,写了半个函数就崩掉的 agent 会赢下「最短代码」。

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
  description: "k 次尝试里至少通过一次的题占比",
  better: "higher",
  unit: "%",
  value: (a) =>
    a.result.outcome === "skipped" ? null : a.result.outcome === "passed" ? 1 : 0,
  aggregate: { perEval: "max", across: "mean" },   // 题内取最好一次,跨题取占比
});
```

自定义维度把同一道题的 attempt 分进不同组时,第一级折叠发生在各组内部。

### null 不是 0:每个指标对四个 outcome 表态

`null` = 「此 attempt 测不了这个指标」,不进聚合;`0` = 「测了,结果是零」,照常进。哪个 outcome 落哪边必须由指标作者显式决定,内置指标先表态:

| 内置指标(name) | skipped | errored | failed | passed | better |
|---|---|---|---|---|---|
| `passRate`(`pass-rate`) | null | 0 | 0 | 1 | higher |
| `examScore`(`exam-score`) | null | 0 | 0 | soft 均分(无 soft 则 1) | higher |
| `durationMs`(`duration`) | null | 实测 | 实测 | 实测 | lower |
| `tokens`(`tokens`) | null | 实测;无 usage 则 null | 同左 | 同左 | lower |
| `costUSD`(`cost`) | null | 同上 | 同左 | 同左 | lower |

(默认聚合全部是 `mean / mean`。)两个容易搞反的点:

- **examScore 先按 outcome 分派,再看断言。** errored 的 attempt 断言是空数组——只按「gate 全过才得分」的字面实现,空数组会让条件空真成立,崩溃反而得满分。交白卷是 0 分:不是缺数据,更不是满分。
- **报告不重新判卷。** examScore 只认落盘的 `outcome`:`--strict` 下被翻成 failed 的 attempt 得 0,哪怕它的 soft 分不低。判决口径与 run 时一致;想换口径去改 run,不在报告里另起炉灶。

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

## 计算函数与数据契约

计算函数是「选集 → 一份组件数据」,跑在 Node 侧,产物是**算好的、可序列化的**普通 JSON——终值加渲染提示,不含公式。这与 `niceeval view`「一次性烘焙进静态产物」的哲学一致([View](view.md)):前端(不管是不是我们的组件)只做渲染。

**计算函数挂在对应组件上**,不做顶层独立导出。这个决定消掉四个问题:`Scoreboard` / `scoreboard` 只差大小写的双胞胎导入不存在(autocomplete 选错一个,类型报错离出错点很远);`table` / `line` / `delta` 这些泛化名不占顶层导出;「哪个函数配哪个组件」不用查表——组件名后打个点,autocomplete 就是文档;`MetricBars.data` 是 `MetricMatrix.data` 的别名,多对一的配对关系也显式化。挂上去的仍是普通 TS 函数,「零件复用进用户应用」不受影响。所有 `data` 函数第一参数收 `Selection | Snapshot[]`。

```typescript
await MetricTable.data(selection, {
  rows: "agent",                      // 行维度
  columns: [passRate, codeLines],     // 每列一个指标
  sort: passRate,                     // 构建时排序,方向随 better;两面同口径,预排即终排
  evals: "algebra/",                  // 可选:eval id 前缀过滤,同 CLI 语义
});                                   // → TableData

await MetricMatrix.data(selection, { rows: "eval", columns: "agent", cell: examScore });  // → MatrixData

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

await RunOverview.data(selection);    // → OverviewData:页头 KPI + 数据来源;选集的 warnings 随行,
                                      //   不要求调用方手动透传

await DeltaTable.data(selection, {
  pairs: [                            // 每行一对:B 相对 A
    { a: "compare/bub-gpt-5.4", b: "compare/bub-gpt-5.4--agents-md", label: "bub" },
    { a: "compare/codex-gpt-5.4", b: "compare/codex-gpt-5.4--agents-md", label: "codex" },
  ],
  metrics: [passRate, costUSD, durationMs],
});                                   // → DeltaData

await CaseList.data(selection, {
  outcomes: ["failed", "errored"],    // 默认就是这两类
  limit: 20,                          // 超出如实报 truncated,不静默截断
  redact: (s) => s.replaceAll(repoRoot, ""),   // 自由文本(error / 断言 detail / judge evidence)的发布消毒钩子
});                                   // → CaseListData
```

**MetricScatter 就是「质量 × 成本 frontier」的积木**:[Experiments](experiments.md) 的一文件一配置意味着 `compare/bub-low`、`compare/bub-medium`、`compare/bub-high` 各是一个实验——`points: "experiment"` 让每个档位成为一个点,`series: "agent"` 把同 agent 的档位连成线,`better` 驱动的轴向让右上角恒为「又好又便宜」。点的 x/y 就是两个 `MetricCell`:按点维度分组后走同一台两级聚合引擎,所以 `samples` / `total` / `refs` 一应俱全,hover 与下钻不用另做一套。

**Scoreboard 的公式是逐题分值制,分母对所有被打分者恒定:**

```text
题分值 = 命中的权重(默认 1)       题得分 = score 指标的题级值(perEval 折叠后)
总分   = fullMarks × Σ(题得分 × 题分值) / Σ(题分值)      Σ 遍历选中范围内全部题
```

某个 agent 没跑到的题挣 0 分,但**留在分母里**,科目小计里如实报 `missing` 数。分母若随人变,总分就没有可比性——这不违反「缺数据不补 0」:考试的契约本来就是「没答不得分」,诚实体现在把 missing 摆出来,而不是给每个人各配一张满分不同的卷子。科目题多分就多,与真实考卷一致;要「科目等权」,给轻科目的题配大权重即可。

数据契约(即组件的 props 类型,从 `niceeval/report` 导出):

```typescript
interface TableData {
  dimension: string;                  // 行维度名,如 "agent"
  columns: MetricColumn[];
  rows: { key: string; cells: Record<string, MetricCell> }[];
}

interface MatrixData {
  rows: string;                       // 行维度名,如 "eval"
  columns: string;                    // 列维度名,如 "agent"
  metric: MetricColumn;
  cells: { row: string; column: string; cell: MetricCell }[];   // 稀疏:没有样本的格子不出现
}

interface ScoreboardData {
  rows: string;                       // 被打分的维度名,如 "agent";维度槽统一叫 rows
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
    passed: number; failed: number; errored: number; skipped: number;
    costUSD: number | null;           // 任一 attempt 报了成本才有;全缺 = null,不编 0
    durationMs: number;
  };
  warnings: SelectionWarning[];       // 选集的警告随行(结构化,含渲染好的 message),RunOverview 直接渲染
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

interface CaseListData {
  rows: {
    eval: string;
    experimentId: string;
    agent: string;
    outcome: "failed" | "errored";
    error?: string;                   // errored 的错误摘要(已过 redact)
    failedAssertions: { name: string; score: number; detail?: string; evidence?: string }[];
    durationMs: number;
    costUSD?: number;
    ref: AttemptRef;                  // 每条案例都能回到证据
  }[];
  truncated: number;                  // limit 之外还有几条,如实报
}

interface MetricColumn {
  key: string;                        // = metric.name,与 cells 的键对应
  label: string;
  unit?: string;
  better?: "higher" | "lower";        // 渲染提示:排序方向、轴向、涨跌配色
}

interface MetricCell {
  value: number | null;               // 聚合后的值;null = 该组没有任何有效样本
  display: string;                    // 已格式化("87%" / "1.2k lines" / "$0.31"),前端可直接渲染
  samples: number;                    // 有效 attempt 数(值为 null 的不计入)
  total: number;                      // 组内 attempt 总数;samples < total = 有 attempt 测不了这个指标
  refs?: AttemptRef[];                // 这个格子由哪些 attempt 算出 —— 回到证据的引用
}

interface AttemptRef {
  run: string;                        // run 目录名(相对结果根目录)
  result: number;                     // 该 run summary.results[] 的下标
}
```

这些**不是持久化格式,只是组件 props**——没有 `format` / `schemaVersion` 信封。要落盘喂 SPA(场景二)就自己包一层 JSON,想加 `generatedAt` 加就是了。兼容性跟随 npm 版本:计算侧和渲染侧本来就是同一个包的两个子路径,同一个应用里天然同版本;唯一要留意的是**分离部署**(CI 脚本算数据、另一个仓库的前端渲染)时把两边锁在同一个 niceeval 版本——要不要为此给数据打轻量版本戳,见文末待定问题。

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
<MetricMatrix data={doc.byEval} attemptHref={(ref) => `/attempts/${ref.run}/${ref.result}`} />
```

和场景一是同一批工件、同一套组件,只是可序列化边界从「RSC 内存里」挪到了「一个 JSON 文件」。

### 场景三:零框架静态导出 —— 以 coding-agent-memory-evals 为原型

真实仓库 coding-agent-memory-evals 今天的静态导出是三段式:脚本 A 按 mtime 挑「最新 run」、按白名单手拷工件进 `site/data/run/`(提交进仓库,否则 CI 上没有数据、会悄悄生成空报告);脚本 B 调 `niceeval view --out` 生成通用查看器,再**用字符串标记从生成的 HTML 里扒出内嵌 JSON**、正则消毒构建机路径、塞回去;Vercel 静态托管 `site/`。三处都在重新发明布局知识——而且页面只能是 view 的三个通用 tab,这套件真正要回答的「记忆开关值不值」根本摆不出来。

重构后,整条流水线是「读 → 算 → `renderToStaticMarkup`」,不需要任何前端框架:

```tsx
// scripts/snapshot.ts —— 跑完 eval 在本机执行:把最新快照瘦身提交进仓库
// (沿用该仓库的铁律:线上构建只吃提交的数据,CI 上没有 .niceeval,绝不悄悄出空报告)
import { openResults, copySnapshots } from "niceeval/results";

const local = await openResults(".niceeval");
const picked = local.latest({ experiments: "compare/" });
await copySnapshots(picked, "site/data/run", { artifacts: ["sources", "events", "trace"] });
```

```tsx
// scripts/build-site.tsx —— tsx 直跑;报告页是纯函数,从提交的快照静态渲染一次成型
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { openResults } from "niceeval/results";
import { passRate, costUSD, durationMs } from "niceeval/report";
import { RunOverview, DeltaTable, MetricScatter, MetricMatrix, CaseList } from "niceeval/report/react";

const results = await openResults("site/data/run");
const selection = results.latest();

const PAIRS = ["bub-gpt-5.4", "codex-gpt-5.4", "claude-dp-v4"].map((c) => ({
  a: `compare/${c}`, b: `compare/${c}--agents-md`, label: c,
}));
const attemptHref = (ref) => `view/#/attempt/${ref.run}/${ref.result}`;   // 证据室:同站托管的 view

const page = renderToStaticMarkup(
  <main>
    <h1>Memory 开关值不值</h1>
    <RunOverview data={await RunOverview.data(selection)} />
    <DeltaTable data={await DeltaTable.data(selection, { pairs: PAIRS, metrics: [passRate, costUSD, durationMs] })} />
    <MetricScatter data={await MetricScatter.data(selection, { points: "experiment", series: "agent", x: costUSD, y: passRate })} />
    <MetricMatrix data={await MetricMatrix.data(selection, { rows: "eval", columns: "experiment", cell: passRate })} attemptHref={attemptHref} />
    <CaseList data={await CaseList.data(selection, { limit: 20 })} attemptHref={attemptHref} />
  </main>,
);
writeFileSync("site/index.html", `<!doctype html><link rel="stylesheet" href="styles.css">${page}`);

// 证据室:transcript / 代码视图 / trace 仍归 view —— 目录导出放子路径,报告页深链进去
// `niceeval view --out site/view site/data/run`(现有 CLI,脚本里 execFile 即可)
```

分工:**报告页是前门**(这套件自己的问题、自己的摆法),**view 是证据室**(attempt 级 transcript / 代码 / trace)。`copySnapshots` 是结果库的发布原语([Results Lib](results-lib.md#复制与瘦身copysnapshots)),取代手写的 mtime 挑选 + 白名单拷贝;「最新 run 可能残缺」的坑由选集带着警告随行、`RunOverview` 直接展示;构建机路径消毒收进 `CaseList.data` 的 `redact` 钩子。原来两个脚本里所有「懂格式」的代码,一行都不剩。

### 场景四:深接入 —— 组件表达不了的,拿句柄自己算

分布类的看法(直方图)不是折叠,计算函数给不了;直接下到结果库的读取面,示例见 [Results Lib · 直接吃读取面](results-lib.md#直接吃读取面一个真实脚本)。

## 报告页交给官方命令渲染:defineReport 与双面组件(设计提案,未实现)

> 2026-07 迭代,取代本节此前的「数据块 + kind 分发」草案。砍第一版 `defineReport` 时的结论「报告页永远住在用户自己的应用里」修正为:**报告页直接交给官方命令 `show` / `view` 渲染**——打开结果、挑快照、渲染页面的那一侧下文称「宿主」,`show` 是终端宿主,`view` 是网页宿主;用户应用只是零件复用的去处。中间经历过一版「报告 = 返回 kind 判别联合的函数」:类型最安全(判别联合天然编译期穷尽),但它把 `--report` 的表达力封死在官方积木的组合上——要自己的展示形态就得整页搬回自己的应用,排版也没有着落。定稿选组件树:换摆法、换口径、换形态三个层次都留在同一个文件、同一对宿主里;类型上的差距用字面量键泛型和渲染前树校验补齐(见「类型义务」)。公开叙事的准绳是 `docs-site/zh/guides/custom-reports.mdx` 与 `report-components.mdx`,本节记内部决策与实现要点。

### 命名与形状决策一览

设计定稿时对着落选方案拍的板,每条一句话理由;实现按定稿一次性收敛,不留兼容层:

| 定稿 | 落选 | 一句话理由 |
|---|---|---|
| `openResults` + 实验/快照分层 | `openExperiments`;平铺 `runs`+`snapshots` | 与模块名、返回物、示例变量名对齐;「results 三次」的病根在层次不在入口名 |
| `copySnapshots` | `copyRun` | 收快照就叫快照,别推翻自己刚教的 snapshot ≠ run |
| `results.latest()` 返回 `Selection`(结构化 warnings) | 返回 `{ snapshots, warnings }` 裸对 | warnings 可程序判断且随选集自动进下游,诚实不靠使用者记得透传 |
| `RunOverview.data` / `MetricTable.data` /… 挂组件上 | 顶层独立函数 `overview` / `table` /… | 消灭 `Scoreboard`/`scoreboard` 大小写双胞胎与泛化顶层导出;配对打点即发现 |
| `defineReport` | `definePage` | 与 `--report` 同词,消灭「page/report」双词 |
| `params` / `param()` | `flags` / `flag()` | 不与 CLI flag 撞词;它本来就是「变量/参数」 |
| `defineComponent({ web, text })` | `abstract class ReportComponent` | 归队 `define*` 家族;两个纯函数面用字面量正好 |
| 成绩单维度槽 `rows` | `of` | 与 `MetricTable.data` 的维度槽统一 |
| 列头不做点击重排,两面同口径 | 网页面可点重排 | 与「静态导出零客户端 JS」只能活一个;人与 agent 读到的顺序不分叉 |

### 一份报告 = 一个报告文件

报告基座 `defineReport`:宿主打开结果目录(含 `--run` 指定历史)、按官方口径挑好选集,注入上下文;报告函数折数据、摆积木,返回一棵组件树:

```tsx
// reports/exam.tsx —— 一份定义,两扇门共用
import { defineReport, Col, Section, DefaultReport, Scoreboard } from "niceeval/report";

export default defineReport(async ({ selection }) => (
  <Col>
    <DefaultReport />
    {/* 官方水位原样铺进来,不要就删这行 */}
    <Section title="考试成绩单">
      <Scoreboard data={await Scoreboard.data(selection, { rows: "agent", subjects: "evalGroup" })} />
    </Section>
  </Col>
));
```

```bash
niceeval show --report reports/exam.tsx    # 同一棵树走 text 面
niceeval view --report reports/exam.tsx    # 同一棵树走 web 面,深链直达证据室
```

```typescript
interface ReportContext {
  /** results.latest() 挑好的选集:现刻水位快照 + 结构化挑选警告,同官方榜单口径。 */
  selection: Selection;
  /** 默认挑法不合口径时,全量数据自己挑(见 Results Lib)。 */
  results: ResultsCollection;
}
function defineReport(build: (ctx: ReportContext) => ReportNode | Promise<ReportNode>): ReportDefinition;
```

上下文从三样(`snapshots` / `warnings` / `results`)收敛为两样:快照与警告本来就是同一次挑选的两半,拆开注入等于逼报告作者自己保证它们来自同一次调用;收成 `selection` 后与独立脚本里 `results.latest()` 的写法完全同构,少学一个形状。

两条硬边界,都从「可达百 MB 的 diff 不进渲染路径」推出来:**计算全部发生在报告函数体里**(读句柄、`await` 折数据只在这里合法);**渲染面是纯同步函数**(零 IO、零 await——React 静态渲染本身是同步的,text 面对齐同一约束,同一棵树才能既走 dev server 又被烘进静态导出)。

`<DefaultReport />` 是零 props 的纯声明组件,与「渲染面纯同步」不冲突,靠的是一个数据事实:官方水位(overview、榜单、失败清单)**只读瘦身条目,不碰任何懒加载工件**,宿主对着已挑好的选集总是把这份数据备好、经上下文注入,代价可忽略。曾考虑做成 ctx 上的异步函数 `{await defaultReport()}`,被否(2026-07-10):报告里的官方水位应该是声明式的一块,不是一次调用。默认无特权仍然成立——它的数据来自公开计算函数,页面上每个数字用户都能用同样几行原样重算。`niceeval view` ≡ `niceeval view --report <内置默认报告>`;`show` 裸跑的榜单与 `exp` 收尾块的汇总表是同一份内置报告(或其子块)的 text 面。**报告槽只有一个,默认只是出厂填充**:不做 tab、不做注册表,「默认 + 自己的」在报告文件的 tsx 里组合。view 的结构是「报告槽 + 证据室」:报告槽整个归 `--report`,证据室(AttemptModal / Traces)是宿主本体,组件经证据引用深链进去([View](view.md));`show` 同构,证据切面(`--transcript` / `--trace` / `--diff`)是宿主本体。

### 元素树与两个宿主

报告函数返回的树不是「React 树」,只是 `{ type, props }` 节点——标准 react jsx-runtime 产的元素恰好就是这个形状:

- **text 宿主(`show`)**:直接遍历节点。type 是双面组件(`defineComponent` 的产物)→ 调它的 `text(props, ctx)`;是普通函数(用户拿函数组合页面片段)→ 调用展开;Fragment / 数组 → 依次;**字符串 intrinsic(`<div>`)→ 报错**。全程不需要 react-dom。
- **web 宿主(`view`)**:用宿主自己 import 的 react 把节点转成真元素,`renderToStaticMarkup` 吐静态 HTML,烘进查看器的报告槽。`defineComponent` 的基础实现不 import react,产物以可调用组件的形状兼容 React 渲染——react / react-dom 维持 optional peer,只有 web 宿主真正 import。

「页面树里只放双面组件」是**运行时校验,不是编译期**:标准 JSX 下 TS 把一切 JSX 表达式统一成 `JSX.Element`,类型上区分不了 `<div>` 和 `<Col>`;自定义 jsxImportSource 能做到,但要用户改 tsconfig 或加 per-file pragma,还会跟 web 面里的真 React JSX 打架,不做。两个宿主在渲染前跑同一遍树校验,错误指名组件路径(`Raw HTML <div> has no terminal face; use <Text>, layout primitives, or a defineComponent component.`)——不做单侧宽容,否则对着 view 写的页面到 show 才炸。

一处如实的依赖代价:报告文件是 .tsx,tsx 编译产物 import `react/jsx-runtime`,所以**写自定义报告的项目要装 react**(写 web 面本来也需要 `@types/react`);裸跑 `show` / `view` 不受影响,内置默认报告不经用户项目的 jsx。

### 双面组件:一个定义,两个纯函数面

早稿是 `abstract class ReportComponent<P>`,定稿改工厂函数:全家族都是 `define*`,唯独扩展组件要 `class … extends` 是体系里的异类;两个渲染面本质就是两个纯函数,一个对象字面量正好。「少实现一个面编译不过」的强度不降——`faces` 的两个键都是必填属性:

```typescript
function defineComponent<P>(faces: {
  /** 真 React JSX 在这个面里;返回静态可渲染的 ReactNode。 */
  web(props: P, ctx: WebContext): ReactNode;
  text(props: P, ctx: TextContext): string;
}): ReportComponent<P>;   // 产物可直接用在 JSX 里:<PassBars rows={rows} />
interface TextContext {
  /** 可用列宽;Row 分栏后变窄。 */
  width: number;
  /** 容器组件渲染 children 用,宽度显式传递。 */
  render(node: ReportNode, width?: number): string;
  /** 下钻命令,通证据室。 */
  attemptCommand(ref: AttemptRef): string;
}
interface WebContext {
  /** 证据室深链,同 view 的 attempt 路由。 */
  attemptHref(ref: AttemptRef): string;
}
```

现有七个 react 组件(`src/report/react/`)收编为对应双面组件的 web 面,text 面新写;`niceeval/report/react` 的导出保留,供「零件复用」进用户自己的应用(两个导出点上组件都带自己的 `data` 函数)。**配对从 vitest 表升级成结构义务**:`faces` 两键必填,少实现一个面编译不过;双面验收测试(renderToStaticMarkup + text 快照)守护两面对同一份数据给出一致判读——排序方向随 `better`、`samples < total` 角标、缺数据 `—` 不补 0、截断如实报剩余数量。早先草案里的公开导出面 `niceeval/report/text` 不再需要:文本渲染住在组件的 text 面里,公开面只有组件。

排版原语 `Row` / `Col` / `Section` / `Text` 就是四个内置双面组件,没有特殊机制:`Row` 的 text 面用 `ctx.render(child, 子宽)` 逐列渲染再拼行,宽度不足降级纵向;web 面是横向排布。用户自定义组件与官方组件走同一个 `defineComponent`、同一对 ctx,通到同一间证据室。

自定义组件的网页样式:静态导出不打包用户代码,className 引用的 CSS 用内置原语 `<Style>{css}</Style>` 随树带走(web 面吐 `<style>` 标签,text 面渲染为空)。交互限普通链接与 `<details>`,与官方组件同一条「不 hydrate 也完整」契约——这维持了砍 `defineReport` 时拒绝「即时构建 / hydration / 样式冲突」重机械的立场:用户模块本来就被 tsx 加载进计算进程,静态渲染 web 面只是多调一个纯函数,没有打包机械。

### params 与新摆法

scaling 类报告(并行 agent 数 × 模拟延迟 × 得分)的变量不该编码进 experiment id 再靠解析字符串抠回来。`ExperimentDef` 增加 `params?: Record<string, string | number | boolean>`,runner 原样透传进持久化字段 `ExperimentRunInfo.params`;报告侧 `param(name, opts)` 把声明值当维度(`series` / `rows` / `columns` / `points` 槽,按值分组)或轴(`x` 槽,要求数值并驱动刻度)。未声明该 param 的 experiment 不猜:分组如实归「未配置」,作轴不画点、注脚报数。命名:不叫 `flags` / `flag()`,因为与 CLI flag(`--report`、`--transcript`)撞词——同一个产品里两个「flag」,公开页自己都在用「flag 选怎么跑」指 CLI;它本来就是「变量/参数」,定稿 `params`。**改名的真实波及面**(2026-07-10 复核修正,早先低估):`flags` 不只是持久化字段,`experiment.flags → ctx.flags → t.flags` 是已实现、已发布的运行时链路,`docs-site/zh/guides/write-experiment.mdx`、`connect-your-agent.mdx`、`write-send.mdx` 三篇都公开教过。改名因此是一次成套动作:`ExperimentDef.params` / `ctx.params` / `t.params` / `ExperimentRunInfo.params` 一起翻,一次性收敛、不留兼容层(与 Results Lib 的收敛姿势一致);是否需要为此递增 schemaVersion 归 [Results Format](results-format.md) 裁决。**阶段性差异**:上述三篇指南目前如实描述已发布的 `flags` API,先不动;实现落到 `params` 时同批翻,报告侧文档(`custom-reports.mdx` / `report-components.mdx`)已按 `params` 定稿。首批随本提案补两个摆法:趋势线 `MetricLine`、分组条形 `MetricBars`(`.data` 为矩阵数据别名),与七个现有产物承担同一套双面义务。

### 类型义务(本提案的落地前置)

公开页承诺「类型化」「编译器背书」,三处目前兑现不了,随本提案一起还:

1. **格子键从字符串裸奔改字面量联合。** `defineMetric` 对 `name` 做 const 泛型,`MetricTable.data` / `DeltaTable.data` 对 columns 元组做泛型,`TableData<K>` 的 `cells: Record<K, MetricCell>`——拼错列名要编译不过,而不是运行时 `undefined.value` 崩。数据要跨可序列化边界,所以不做 `row.cell(metric)` 这类方法访问器;示例一律写 `r.cells[passRate.name]`,键锚在指标对象上,不裸写字符串。`sort: passRate` 已按对象身份传,格子访问与它对齐。
2. **`MetricCell.refs` 必填**(允许空数组)。「每个数字点进去就是证据」是页面的核心承诺,可选字段会让深链静默缺失。
3. **`EvalResult` 两拆**(持久化瘦身条目 / view 运行时装饰)。早稿是三拆,多出的「写入输入」变体(大字段内联的完整 EvalResult)随 writer 改签名作废:`writeAttempt(result, artifacts)` 两个参数分别就是 reader 的 `attempt.result` 与懒加载工件的类型,「参数类型 = reader 返回类型」由签名直接成立,不再需要一个中间形状。归 [Results Lib](results-lib.md) 的类型迁移步,与本提案同批排期。

### 与被砍的第一版 `defineReport` 的区别

第一版死于三层中转,现在一层中转都没有。名字复用是有意的:被砍的是**形态**(目录发现 / 文档格式 / 专门 CLI),不是名字;`--report` 收的文件默认导出与 flag 同词,才不用「page」另造一词:

| 被砍的形态 | 现在的形态 |
|---|---|
| `reports/` 目录自动发现 | 无发现,路径显式经 `--report` 递入 |
| `ReportDoc` 文档格式 | 无新格式,普通 .tsx 模块以 `defineReport` 默认导出 |
| `niceeval report` 专门 CLI | 无新命令面,现有 `show` / `view` 宿主 |

`--report` 走 flag 不走位置参数,CLI 模型(位置参数 = eval id 前缀)不破([CLI](cli.md));模块加载复用跑用户 `.ts` 配置 / eval 文件的同一 tsx 机制,宿主负责 `openResults`(含 `--run`)并注入上下文,报告文件自己不碰路径——同一个文件在两个宿主、任意结果目录下语义一致。

## 边界与不变量

- **core 中立不破。** 指标函数是用户代码,想读什么工件读什么;但计算函数与组件只认 `Metric` / `Dimension` 接口,不出现 `agent === "codex"` 这类分支。「考试」「benchmark」「frontier」都不是 core 概念,只是积木摆法。
- **Report 不写事实。** 唯一事实来源仍是 Results Format;组件数据是派生物,删了随时可重算,因此不需要迁移机制。
- **null ≠ 0。** `null` = 此 attempt 测不了这个指标,不进聚合;`0` = 测了,结果是零,照常进。每个指标(含内置)对四个 outcome 逐一表态;`MetricCell` 用 `samples` / `total` 如实报覆盖率,一组全 `null` 渲染成缺数据,绝不补 0(与[成本设计](observability.md#换算成本价格表从哪来)「未知模型不瞎猜」同一原则)。scoreboard 的固定分母是显式的考试契约、不是这条的例外:没答的题 0 分挣,`missing` 如实报。
- **报告不重新判卷。** 指标只消费落盘的 `outcome` 与断言,不推翻 run 时的判决口径;换口径的正确位置是重跑,不是报告。
- **选择诚实。** 残缺快照、被跳过的 run、发生过的去重,全部以 `warnings` / `skipped` 返回给调用方,不静默;组件对 `samples < total`、全 `null` 的格子和缺数据的点如实渲染。
- **跨快照聚合先去重。** 计算函数在聚合前按 [Results Lib 的身份键](results-lib.md#身份键与去重)去重——`--resume` 会让同一 attempt 存在于多份落盘,细节与键的定义见那边。
- **快照身份保留在结果库。** 合并与聚合永远发生在计算函数里,可被用户的选择与聚合配置覆盖。
- **数据 ↔ 两面成对。** 每种数据产物必须同时有 web 面与 text 面——`defineComponent` 的 `faces` 两键必填,配对是结构义务而非配对表;双面验收测试守护两面判读一致。缺一面就不能发新组件(否则 `--report` 在两个宿主下不对称)。

## 待定的 DX 问题(迭代入口)

1. **时间轴 delta。** 成对 delta(`DeltaTable`)进了首批,但它比的是「两个配置」;「这次 vs 上次」(同一配置两个快照)先用 `"snapshot"` 维度顶着,真正的时间轴对比组件等 view 的 Compare 落地后对齐口径,免得两套「对比」语义分叉。
2. **`refs` 的体积上限。** 设计上完整携带(单格样本数有限),但全历史矩阵可能膨胀;若实测超标再定截断规则(每格上限 + `truncated` 标记),不预设。
3. **组件数据要不要版本戳。** 同应用内计算与渲染同包同版本,没有偏斜;分离部署靠锁版本约束。若真实用户撞上偏斜,再考虑给 `TableData` 等加一个轻量 `producer` 戳,先不加。
4. **样式定制深度。** 首批只承诺稳定 class 名(`nre-*`)+ `className` 透传;要不要 slots / render props(比如自定义格子渲染、scatter 点标签防重叠策略),看第一批用户把组件嵌进真实面板时卡在哪。
5. **view 的 attempt 级深链:已落地。** `#/attempt/<run>/<result>` 路由与 loader 注入的 `attemptRef` 已实现(`src/view/app/lib/attempt-route.ts`),路由参数就是 `AttemptRef`——「报告页是前门、view 是证据室」的分工闭环;留此条记录出处。
6. **`view --report` 的装载细节。** dev server 模式(报告模块变更要不要热重算)与 `--out` 静态导出模式(block 数据烘进壳,同 `__NICEEVAL_VIEW_DATA__` 的官方数据契约)各自怎么装,等 show 侧的文本宿主先落地再定,避免两个宿主各长一套装载语义。

## 相关阅读

- [Results Lib](results-lib.md) —— 结果读写库:类型的家、writer、openResults、实验/快照层次、选择器、身份键。
- [Results Format](results-format.md) —— 唯一持久化事实来源。
- [Runner](runner.md) —— earlyExit 与重试的调度行为:两级聚合的动因。
- [Observability](observability.md) —— usage / cost / o11y 摘要这些指标原料从哪来。
- [View](view.md) —— 内置前端;快照口径、Compare 计划与散点图都与本提案对齐。
- [Experiments](experiments.md) —— 可对比组与 reasoningEffort 档位:scatter 的点从哪来。
- [Scoring](scoring.md) —— gate / soft 断言语义,`examScore` 的依据。
