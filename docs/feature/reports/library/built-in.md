# 内建报告

`niceeval/report/built-in` 是内建视图的家：每个内建视图是一份普通 `defineReport` 成品，有自己的名字，按名字具名导出、一视图一个源文件；入口的**默认导出**恒等于 `standard`——裸 `niceeval show` 与 `niceeval view` 不带 `--report` 时装载的那份。默认报告不是私有实现，也不是省略字段时被召唤的隐式默认，只是「宿主默认拿哪个值」的事实。

```ts
import builtIn, { standard, standardAttemptPage } from "niceeval/report/built-in";

standard; // ReportDefinition：四张 page，其中三张进导航
standardAttemptPage; // ReportPage：以 locator 为输入、不进导航的详情 page
builtIn;  // 默认导出 === standard，宿主装载取这个值
```

当前视图只有 `standard`。新增内建视图的形态已经由这个入口定死：一份新的 `defineReport` 成品、一个新名字、一个新文件、一条新的具名导出——不需要注册表，也不改变装载管线。

`standard` 的全文如下：

```tsx
// niceeval/report/built-in 的 standard 视图，没有任何私有钩子
import {
  AttemptDetail, AttemptList,
  Col, CopyFixPrompt, ExperimentComparison, Hero, ScopeWarnings, SnapshotDiagnostics,
  TraceWaterfall, defineReport,
} from "niceeval/report";

export const standardAttemptPage = {
  id: "attempt",
  title: "Attempt",
  input: "attempt",
  navigation: false,
  content: <AttemptDetail />,
} as const;

export const standard = defineReport({
  pages: [
    {
      id: "report",
      title: { en: "Report", "zh-CN": "报告" },
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <SnapshotDiagnostics />
          <CopyFixPrompt />
          <ExperimentComparison />
        </Col>
      ),
    },
    {
      id: "attempts",
      title: "Attempts",
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <SnapshotDiagnostics />
          <AttemptList filter />
        </Col>
      ),
    },
    {
      id: "traces",
      title: { en: "Traces", "zh-CN": "追踪" },
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <SnapshotDiagnostics />
          <TraceWaterfall />
        </Col>
      ),
    },
    standardAttemptPage,
  ],
});
```

它不住在 `niceeval/report` 里：那是工具箱（`defineReport`、组件、指标、排版原语），内建视图是用这套工具写成的**成品**，与用户的报告文件同层。这是契约，不是实现巧合：裸宿主与 `--report` 一个内容如上的文件完全等价，走同一条 `装载 → resolve → validate → render` 管线。「builtin」不是类型系统或装载逻辑里的类别。

裸 `view` 页面上能看到的一切内容都在这份定义里：前三张 page 形成导航；hero、选择警告、快照诊断和批量修复 prompt 是普通组件；locator 打开第四张 attempt-input page，其中 `AttemptDetail` 也只是普通组合组件。宿主自己渲染的只有机器——page / locator 寻址、导航与 dialog 摆放、浏览器标题等文档单例、语言切换（[边界清单](../architecture.md#宿主保留的只有机器)）。因此**任何用户报告都能达到内建报告的全部能力，也能丢弃它的任何部分**。

## 复用有两条路，语义不同、都显式

- **引用**：`defineReport({ extends: standard, … })` 在整份内建视图上叠自己的外壳（[extends 契约](shell.md#行为约束)）。这是在声明「跟随内建」——页面归 niceeval 所有，升级带来的页面演进随之生效，自己只声明标题、链接、head 这些站点身份。
- **照抄**：按上面的全文写同名组件。这是在钉死当前形态——内建怎么变都不跟，页面完全归自己所有，可以逐页改造。

两条路读文件的人都能看出会渲染什么：`extends: standard` 是一个显式 import 的具名引用，照抄是逐行写出的声明。`extends` 继承完整 pages，包括 `standardAttemptPage`；要改详情就重新声明 pages，并把这张 page 的 `content` 换成公开组件树。所有内容都只住 page，`ReportDefinition` 不是 `ReportNode`，报告级复用只有 `extends` 这一个位置。

## 从内建出发的升级路径

三档改造不换 API 形状：

```tsx
// reports/mine.tsx —— ① 换树：只关心自己的图表，不要站点 chrome
import {
  Col, ExperimentList, MetricScatter,
  costUSD, defineReport, endToEndPassRate,
} from "niceeval/report";

export default defineReport(
  <Col>
    <MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />
    <ExperimentList filter />
  </Col>,
);
```

树入参渲染的就是那棵树：没有附赠的 hero、警告区或证据页——读文件的人必须能看出会渲染什么，宿主不给任何页面加料。

```tsx
// reports/branded.tsx —— ② 内建整站 + 品牌外壳：extends 引用
import { defineReport } from "niceeval/report";
import { standard } from "niceeval/report/built-in";

export default defineReport({
  extends: standard,
  title: "Memory Evals",
  links: [{ label: "GitHub", href: "https://github.com/you/repo" }],
});
```

```tsx
// reports/site.tsx —— ③ 拆页：照抄内建的页，再加自己的页
import {
  AttemptList, Col, ExperimentComparison, Hero, ScopeWarnings, SnapshotDiagnostics,
  Scoreboard, defineReport, examScore,
} from "niceeval/report";

export default defineReport({
  title: "Memory Evals",
  links: [{ label: "GitHub", href: "https://github.com/you/repo" }],
  pages: [
    {
      id: "overview",
      title: { en: "Overview", "zh-CN": "总览" },
      content: <Col><Hero /><ScopeWarnings /><SnapshotDiagnostics /><ExperimentComparison /></Col>,
    },
    {
      id: "exam",
      title: { en: "Exam", "zh-CN": "成绩单" },
      content: <Col><ScopeWarnings /><SnapshotDiagnostics /><Scoreboard rows="agent" questions={[
        "security/sql-injection",
        "correctness/retry",
      ]} fullMarks={100} score={examScore} /></Col>,
    },
    {
      id: "attempts",
      title: "Attempts",
      content: <Col><AttemptList filter /></Col>,
    },
  ],
});
```

② 是最小品牌化形态：`title` 进浏览器标题与 `ctx.report.title`，内建页自带的 `<Hero />` 跟随同一标题并带品牌行。③ 从引用切换到照抄，pages 归自己所有；因为列表里没有 attempt-input page，locator 不会接到隐藏详情。需要详情时把 `standardAttemptPage` 放进 pages，或声明一张相同输入、content 由[公开详情区块](attempt-detail.md)重组的 page。`content` / `pages` / `extends` 必须恰好声明一个（见[外壳与多页](shell.md)）。

## 内建报告显示什么

首页用 `ExperimentComparison` 展示实验整体主读数，其行为契约单点定义在[概览组件](summaries.md#experimentcomparison)；`Hero` / `ScopeWarnings` / `SnapshotDiagnostics` / `CopyFixPrompt` / `TraceWaterfall` 的契约在[站点组件](site-components.md)；Attempts 页的本体是[带过滤的 `AttemptList`](entity-lists.md#attemptlist)。

## 相关阅读

- [外壳与多页](shell.md) —— 配置对象的字段穷尽、`extends` 合并语义与行为约束。
- [站点组件](site-components.md) —— hero、品牌、警告、快照诊断与瀑布的组件契约。
- [Attempt 详情组件](attempt-detail.md) —— `AttemptDetail` 与 `standardAttemptPage` 的重组方式。
- [概览组件](summaries.md) —— `ExperimentComparison` 的契约。
- [Architecture](../architecture.md) —— 装载规范化：内建与 `--report` 的同一条管线。
