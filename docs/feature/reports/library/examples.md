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

题集写进 `sources.measure.scoreboard(...)` 的配置；`Table` 只负责呈现：

```tsx
import { Table, defineReport, passRate, sources } from "niceeval/report";

const exam = sources.measure.scoreboard({
  dimensions: ["agent"],
  fullMarks: 100,
  score: passRate,
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
  Table, defineReport, executionReliability, passRate, sources, taskPassRate,
} from "niceeval/report";

const reliability = sources.measure.rows({
  dimensions: ["experiment"],
  measures: [passRate, taskPassRate, executionReliability],
  sort: passRate,
});

export default defineReport(<Table source={reliability} filter />);
```

## 对比：基线与候选相差多少

```tsx
import { Table, defineReport, sources } from "niceeval/report";

const memoryDelta = sources.measure.delta({
  by: "experiment",
  conditions: { flag: "memory" },
});

export default defineReport(<Table source={memoryDelta} />);
```

任一侧缺数据时 delta 保持缺失，不当作 0。要固定顺序时把 `conditions` 换成显式数组，其中恰好一项
标 `baseline: true`。

## 扫描：参数档位趋势

先用 `sources.measure.rows(...)` 计算 Dataset，再由 `Chart` 把字段映射到坐标与 series。同一份数据
也能直接交给 `Table`，图表没有第二套 Source：

```tsx
import { Chart, Series, defineReport, numericFlag, passRate, sources } from "niceeval/report";

const budget = numericFlag("budget", { unit: "tokens" });
const trend = sources.measure.rows({
  dimensions: [budget, "agent"],
  measures: [passRate],
});

export default defineReport(
  <Chart source={trend} x="budget" y="passRate" legend>
    <Series id="pass-rate" mark="line" by="agent" />
  </Chart>,
);
```

## 定位：哪道题在哪个配置上失败

```tsx
import { Chart, Col, Series, Table, defineReport, passRate, sources } from "niceeval/report";

const matrix = sources.measure.matrix({
  rows: "eval",
  columns: "agent",
  measure: passRate,
});
const grouped = sources.measure.rows({
  dimensions: ["eval", "agent"],
  measures: [passRate],
});

export default defineReport(
  <Col>
    <Table source={matrix} />
    <Chart source={grouped} x="eval" y="passRate" legend>
      <Series id="pass-rate" mark="bar" by="agent" />
    </Chart>
  </Col>,
);
```

## 自定义读数

```tsx
import { Table, costUSD, defineMeasure, defineReport, passRate, sources } from "niceeval/report";

const changedLines = defineMeasure({
  name: "changed-lines",
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

const golf = sources.measure.rows({
  dimensions: ["agent"],
  measures: [passRate, changedLines, costUSD],
  sort: passRate,
});

export default defineReport(<Table source={golf} />);
```

## 自定义维度

```tsx
import { Table, costUSD, defineReport, passRate, sources } from "niceeval/report";
import type { CustomDimension } from "niceeval/report";

const vendor: CustomDimension = {
  name: "vendor",
  of: (attempt) => attempt.run.model?.startsWith("gpt-") ? "OpenAI" : "Anthropic",
};

export default defineReport(
  <Table source={sources.measure.rows({
    dimensions: [vendor],
    measures: [passRate, costUSD],
  })} />,
);
```

## 历史：一个实验的逐次 Run

历史 Source 仍只接受 Sample，并从 `sample.historyAttempts` 读取完整历史。组合组件通过 Sample 过滤器
收窄 experiment，不把任意 Runs 数组伪装成 Source input：

```tsx
import {
  Section, Table, costUSD, defineComposition, defineReport,
  filterAttempts, passRate, sources,
} from "niceeval/report";

const historyRows = sources.measure.rows({
  dimensions: ["run"],
  measures: [passRate, costUSD],
});

const History = defineComposition(async ({ experiment }: { experiment: string }, ctx) => {
  const input = ctx.sample.pipe(filterAttempts(
    (attempt) => attempt.experimentId === experiment,
  ));

  return (
    <Section title={`${experiment} · 历次 Run`}>
      <Table source={historyRows} input={input} />
    </Section>
  );
});

export default defineReport(<History experiment="compare/bub-gpt-5.4" />);
```

## 自定义子集：按路径前缀分块

```tsx
import { Col, SampleSummary, Section, defineComposition, defineReport, filterAttempts } from "niceeval/report";

const GroupBlocks = defineComposition((_props: {}, ctx) => (
  <Col>
    {["agents/codex/", "agents/claude/"].map((prefix) => (
      <Section key={prefix} title={prefix}>
        <SampleSummary
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
- [排版原语与自定义组件](layout.md) —— `defineComposition` 的契约。
- [读数与维度](measures.md) —— `Measure`、`Dimension` 与聚合口径。
