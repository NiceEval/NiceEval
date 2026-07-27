# 完整示例

每个例子都是可直接落盘的报告文件。示例只示范如何组合**数据源 + 原语**；字段与行为的完整契约
仍在各数据源和原语分篇。

## 修失败：待处理清单

常用口径直接用组合组件 `FailureList`：

```tsx
import { Col, FailureList, Text, defineReport } from "niceeval/report";

export default defineReport(
  <Col>
    <FailureList limit={20} />
    <Text>每行的 locator 可直接交给 niceeval show 下钻。</Text>
  </Col>,
);
```

## 考试：固定题集成绩单

题集写进 `scoreboard(...)` 的配置；`Table` 只负责呈现：

```tsx
import { Table, defineReport, examScore, scoreboard } from "niceeval/report";

const exam = scoreboard({
  rows: "agent",
  fullMarks: 100,
  score: examScore,
  groups: [
    {
      name: "security",
      weight: 3,
      evals: ["security/sql-injection", "security/path-traversal"],
    },
    {
      name: "correctness",
      weight: 2,
      evals: ["correctness/retry"],
    },
  ],
});

export default defineReport(<Table source={exam} />);
```

## 口径拆解：损失来自答题还是执行

```tsx
import {
  Table, defineReport, endToEndPassRate, executionReliability, measureRows,
  taskPassRate,
} from "niceeval/report";

const reliability = measureRows({
  rows: "experiment",
  measures: [endToEndPassRate, taskPassRate, executionReliability],
  sort: endToEndPassRate,
});

export default defineReport(<Table source={reliability} filter />);
```

## 对比：基线与候选相差多少

```tsx
import { Table, defineReport, deltaRows } from "niceeval/report";

const memoryDelta = deltaRows({
  by: "experiment",
  conditions: { flag: "memory" },
});

export default defineReport(<Table source={memoryDelta} />);
```

任一侧缺数据时 delta 保持缺失，不当作 0。要固定顺序时把 `conditions` 换成显式数组，其中恰好一项
标 `baseline: true`。

## 扫描：参数档位趋势

`chart(...)` 声明坐标与 series；它与表格数据源使用同一组 `Measure` / `Dimension`：

```tsx
import {
  Chart, chart, defineReport, endToEndPassRate, numericFlag,
} from "niceeval/report";

const budget = numericFlag("budget", { label: "Token budget", unit: "tokens" });
const trend = chart({
  x: { numeric: budget },
  y: { measure: endToEndPassRate },
  series: [{
    key: "pass-rate",
    mark: "line",
    measure: endToEndPassRate,
    by: "agent",
  }],
});

export default defineReport(<Chart source={trend} legend />);
```

## 定位：哪道题在哪个配置上失败

```tsx
import {
  Chart, Col, Table, chart, defineReport, endToEndPassRate, measureMatrix,
} from "niceeval/report";

const matrix = measureMatrix({
  rows: "eval",
  columns: "agent",
  measure: endToEndPassRate,
});
const grouped = chart({
  x: { dimension: "eval" },
  y: { measure: endToEndPassRate },
  series: [{
    key: "pass-rate",
    mark: "bar",
    measure: endToEndPassRate,
    by: "agent",
  }],
});

export default defineReport(
  <Col>
    <Table source={matrix} />
    <Chart source={grouped} legend />
  </Col>,
);
```

## 自定义读数

```tsx
import {
  Table, costUSD, defineMeasure, defineReport, endToEndPassRate, measureRows,
} from "niceeval/report";

const changedLines = defineMeasure({
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

const golf = measureRows({
  rows: "agent",
  measures: [endToEndPassRate, changedLines, costUSD],
  sort: endToEndPassRate,
});

export default defineReport(<Table source={golf} />);
```

## 自定义维度

```tsx
import {
  Table, costUSD, defineReport, endToEndPassRate, measureRows,
} from "niceeval/report";
import type { CustomDimension } from "niceeval/report";

const vendor: CustomDimension = {
  name: "vendor",
  of: (attempt) => attempt.run.model?.startsWith("gpt-") ? "OpenAI" : "Anthropic",
};

export default defineReport(
  <Table source={measureRows({
    rows: vendor,
    measures: [endToEndPassRate, costUSD],
  })} />,
);
```

## 历史：一个实验的逐次 Run

宿主默认注入的是 Sample，不是完整历史。组合组件先从 Record 选择 Runs，再把它显式交给数据源：

```tsx
import {
  Section, Table, Text, costUSD, defineComponent, defineReport,
  endToEndPassRate, measureRows,
} from "niceeval/report";

const historyRows = measureRows({
  rows: "run",
  measures: [endToEndPassRate, costUSD],
});

const History = defineComponent(async ({ experiment }: { experiment: string }, ctx) => {
  const exp = ctx.record.experiments.find((item) => item.id === experiment);
  if (!exp) return <Text>experiment {experiment} has no results yet.</Text>;

  return (
    <Section title={`${experiment} · 历次 Run`}>
      <Table source={historyRows} input={exp.runs} />
    </Section>
  );
});

export default defineReport(<History experiment="compare/bub-gpt-5.4" />);
```

## 自定义子集：按路径前缀分块

```tsx
import {
  Col, Grid, Section, defineComponent, defineReport, filterAttempts, sampleSummary,
} from "niceeval/report";

const GroupBlocks = defineComponent((_props: {}, ctx) => (
  <Col>
    {["agents/codex/", "agents/claude/"].map((prefix) => (
      <Section key={prefix} title={prefix}>
        <Grid
          source={sampleSummary()}
          input={ctx.sample.pipe(filterAttempts(
            (attempt) => attempt.experimentId.startsWith(prefix),
          ))}
        />
      </Section>
    ))}
  </Col>
));

export default defineReport(<GroupBlocks />);
```

## 相关阅读

- [外壳与多页](shell.md) —— 给示例加标题、链接或拆页。
- [内建报告](built-in.md) —— 从默认装配开始改。
- [排版原语与自定义组件](layout.md) —— `defineComponent` 的契约。
- [读数与维度](measures.md) —— `Measure`、`Dimension` 与聚合口径。
