# 报告配方

每个配方都是一份可直接落盘的完整报告文件，`niceeval show --report reports/<名字>.tsx` 与 `niceeval view --report ...` 都能渲染。按想回答的问题选配方；字段与行为的穷尽契约在各组件分篇，配方只示范组合方式。外壳与多页的三档递进见[外壳与多页](shell.md)，从内建报告出发的改造见[内建报告](built-in.md)。

## 修失败：待处理失败清单

回答「现在有哪些失败要处理、先看哪条」。最常见的失败清单是成品组件 [`FailureList`](../components/entity-lists.md#failurelist)，一行即可；其它筛选口径才需要组合组件加工 `attemptListData`：

```tsx
// reports/todo.tsx
import { Col, FailureList, Text, defineReport } from "niceeval/report";

export default defineReport(
  <Col>
    <FailureList limit={20} />
    <Text>每行的 locator 可直接交给 niceeval show 下钻。</Text>
  </Col>,
);
```

## 考试：固定题集成绩单

回答「固定题集的总分与分科得分」。没跑到的题按 0 分留在分母里——这是考试语义，不是探索分析：

```tsx
// reports/exam.tsx
import { Question, Rows, Scoreboard, Subject, defineReport, examScore } from "niceeval/report";

export default defineReport(
  <Scoreboard fullMarks={100} score={examScore}>
    <Rows dimension="agent" />
    <Subject name="security" weight={3}>
      <Question id="security/sql-injection" />
      <Question id="security/path-traversal" />
    </Subject>
    <Subject name="correctness" weight={2}>
      <Question id="correctness/retry" />
    </Subject>
  </Scoreboard>,
);
```

## 口径拆解：损失来自答题还是执行

回答「分数低是模型不会做，还是基础设施在报错」。三个通过率指标并排，各自的口径见[指标与维度](metrics.md#内置指标)：

```tsx
// reports/reliability.tsx
import {
  Column, MetricTable, Rows, defineReport,
  endToEndPassRate, executionReliability, taskPassRate,
} from "niceeval/report";

export default defineReport(
  <MetricTable filter>
    <Rows dimension="experiment" sort={endToEndPassRate} />
    <Column metric={endToEndPassRate} />
    <Column metric={taskPassRate} />
    <Column metric={executionReliability} />
  </MetricTable>,
);
```

## 对比：基线与候选相差多少

回答「加了 memory / 换了配置，指标是改善还是退化」。实验矩阵是「同配置开关某个 flag」时用 `<FlagConditions>`——条件由 experiment 配置机械导出，加实验不用改报告；要自定义顺序或比较任意一组 id 时逐个写 `<Condition>`，其中一个标 `baseline`。任一侧缺数据时 delta 保持缺失，不当 0：

```tsx
// reports/ab.tsx
import { Columns, DeltaTable, FlagConditions, defineReport } from "niceeval/report";

export default defineReport(
  <DeltaTable>
    <Columns dimension="experiment">
      <FlagConditions flag="memory" />
    </Columns>
  </DeltaTable>,
);
```

## 扫描：参数档位的趋势

回答「token budget（或并发、延迟档位）变化时指标怎样变化」。x 轴来自 experiment `flags` 里声明的数值，不解析 experiment id 字符串：

```tsx
// reports/scaling.tsx
import {
  Line, LineChart, XAxis, YAxis,
  defineReport, endToEndPassRate, numericFlag,
} from "niceeval/report";

const budget = numericFlag("budget", { label: "Token budget", unit: "tokens" });

export default defineReport(
  <LineChart>
    <XAxis numeric={budget} />
    <YAxis metric={endToEndPassRate} />
    <Line metric={endToEndPassRate} by="agent" />
  </LineChart>,
);
```

## 定位：哪道题在哪个配置上失败

回答「失败集中在哪些题 × 哪些配置」。矩阵查精确交叉格，同维度的分组柱看幅度差异；两者写同一组维度绑定，resolve 记忆化保证只算一次，摆在一起互为放大镜：

```tsx
// reports/matrix.tsx
import {
  Bar, BarChart, Cells, Col, Columns, MetricMatrix, Rows, XAxis, YAxis,
  defineReport, endToEndPassRate,
} from "niceeval/report";

export default defineReport(
  <Col>
    <MetricMatrix>
      <Rows dimension="eval" />
      <Columns dimension="agent" />
      <Cells metric={endToEndPassRate} />
    </MetricMatrix>
    <BarChart>
      <XAxis dimension="eval" />
      <YAxis metric={endToEndPassRate} />
      <Bar metric={endToEndPassRate} by="agent" />
    </BarChart>
  </Col>,
);
```

## 自定义指标：只比通过方案的改动行数

回答「谁用更少的代码交付了能用的结果」。`where` 把失败方案挡在计算外，`null` 表示测不了、不进聚合：

```tsx
// reports/golf.tsx
import {
  MetricTable, costUSD, defineMetric, defineReport, endToEndPassRate,
} from "niceeval/report";

const changedLines = defineMetric({
  name: "changed-lines",
  label: { en: "Changed lines", "zh-CN": "改动行数" },
  unit: "lines",
  better: "lower",
  where: (attempt) => attempt.result.verdict === "passed",
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;
    return Object.keys(diff.files)
      .reduce((sum, path) => sum + (diff.get(path) ?? "").split("\n").length, 0);
  },
});

export default defineReport(
  <MetricTable>
    <Rows dimension="agent" sort={endToEndPassRate} />
    <Column metric={endToEndPassRate} />
    <Column metric={changedLines} />
    <Column metric={costUSD} />
  </MetricTable>,
);
```

## 自定义维度：按厂商折叠

回答「按厂商（而不是逐个模型）看通过率」。分组从结果已有字段派生，不要求 experiment 为一种摆法改配置：

```tsx
// reports/vendor.tsx
import { MetricTable, costUSD, defineReport, endToEndPassRate } from "niceeval/report";
import type { CustomDimension } from "niceeval/report";

const vendor: CustomDimension = {
  name: "vendor",
  of: (a) => (a.snapshot.model?.startsWith("gpt-") ? "OpenAI" : "Anthropic"),
};

export default defineReport(
  <MetricTable>
    <Rows dimension={vendor} />
    <Column metric={endToEndPassRate} />
    <Column metric={costUSD} />
  </MetricTable>,
);
```

## 历史：一个实验的逐次快照走势

回答「这个配置最近几次跑下来是变好还是变坏」。宿主注入的 `scope` 是现刻水位、不是完整历史；要历史就在组合组件里从 `results` 自己取 `exp.snapshots`，作为 `input` 显式交给组件：

```tsx
// reports/history.tsx
import {
  MetricTable, Section, Text,
  costUSD, defineComponent, defineReport, endToEndPassRate,
} from "niceeval/report";

const History = defineComponent(async ({ experiment }: { experiment: string }, ctx) => {
  const exp = ctx.results.experiments.find((e) => e.id === experiment);
  if (!exp) return <Text>experiment {experiment} has no results yet.</Text>;

  return (
    <Section title={`${experiment} · 历次快照`}>
      <MetricTable input={exp.snapshots}>
        <Rows dimension="snapshot" />
        <Column metric={endToEndPassRate} />
        <Column metric={costUSD} />
      </MetricTable>
    </Section>
  );
});

export default defineReport(<History experiment="compare/bub-gpt-5.4" />);
```

## 并列视图：一页里的两种看法

回答「同一批数据，frontier 和成绩单都想要，但不想拆页」。tab 是页内浏览状态；内容多到终端读不动时升级成[页](shell.md)：

```tsx
// reports/dual.tsx
import {
  Question, Rows, Scatter, ScatterChart, Scoreboard, Tab, Tabs, XAxis, YAxis,
  costUSD, defineReport, endToEndPassRate, examScore,
} from "niceeval/report";

export default defineReport(
  <Tabs>
    <Tab title="质量 × 成本">
      <ScatterChart>
        <XAxis metric={costUSD} />
        <YAxis metric={endToEndPassRate} />
        <Scatter points="experiment" by="agent" x={costUSD} y={endToEndPassRate} />
      </ScatterChart>
    </Tab>
    <Tab title="分科得分">
      <Scoreboard score={examScore}>
        <Rows dimension="agent" />
        <Question id="security/sql-injection" />
        <Question id="security/path-traversal" />
        <Question id="correctness/retry" />
      </Scoreboard>
    </Tab>
  </Tabs>,
);
```

## 自定义子集：按路径前缀分块

需要多个摘要时，在报告里显式声明路径前缀：

```tsx
// reports/groups.tsx
import { Col, ScopeSummary, Section, defineComponent, defineReport } from "niceeval/report";

const GroupBlocks = defineComponent((_props: {}, ctx) => {
  const prefixes = ["agents/codex/", "agents/claude/"];

  return (
    <Col>
      {prefixes.map((prefix) => (
        <Section key={prefix} title={prefix}>
          <ScopeSummary input={ctx.scope.filter((s) => s.experimentId.startsWith(prefix))} />
        </Section>
      ))}
    </Col>
  );
});

export default defineReport(<GroupBlocks />);
```

## 相关阅读

- [外壳与多页](shell.md) —— 给任何配方加标题、GitHub 链接或拆页。
- [内建报告](built-in.md) —— 不写树、只加品牌的最小形态。
- [排版原语与自定义组件](layout.md) —— 组合组件与 `defineComponent` 的完整契约。
- [指标与维度](metrics.md) —— 配方里指标与 `flag()` / 维度的口径契约。
- [Results Library](../../results/library.md) —— `results.experiments`、`exp.snapshots` 与 Scope 的读取契约。
