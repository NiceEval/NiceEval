# 内建报告

裸 `niceeval show` 与 `niceeval view` 不带 `--report` 时装载的默认报告，不是私有实现，也不是省略字段时被召唤的隐式默认——它是独立入口 `niceeval/report/built-in` 的**默认导出**，一份普通 `defineReport`，内容只有一行：

```tsx
// niceeval/report/built-in —— 包里自带的一个报告文件，没有任何私有钩子
import { ExperimentComparison, defineReport } from "niceeval/report";

export default defineReport(<ExperimentComparison />);
```

它不住在 `niceeval/report` 里：那是工具箱（`defineReport`、组件、指标、排版原语），内建报告是用这套工具写成的**成品**，与用户的报告文件同层。这是契约，不是实现巧合：裸宿主与 `--report` 一个内容如上的文件完全等价，走同一条 `装载 → resolve → validate → render` 管线；外壳行为——确定的标题回退、页脚的 `Powered by niceeval` 行、Runs 与 Traces 证据页恒随导航——对内建与自定义定义一致生效。「builtin」不是类型系统或装载逻辑里的类别，只是「宿主默认拿哪个值」的事实。

任何用户报告都能达到内建报告的全部能力——内建的全部内容就是工具箱里人人可用的 `ExperimentComparison` 组件，要复用它不需要 import 内建入口，直接写 `<ExperimentComparison />`。反过来，报告 API 的验收标准之一就是内建自己必须写得顺——内建写不出来或写着别扭，说明 API 缺了东西；「内容一行」正是这条标准的落点。

## 从内建出发的升级路径

三档改造不换 API 形状：

```tsx
// reports/mine.tsx —— ① 换树：树入参换成自己的报告树
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

```tsx
// reports/branded.tsx —— ② 保留内建内容，只加品牌外壳：显式写出组件，不靠省略
import { ExperimentComparison, defineReport } from "niceeval/report";

export default defineReport({
  title: "Memory Evals",
  links: [{ label: "GitHub", href: "https://github.com/you/repo" }],
  content: <ExperimentComparison />,
});
```

```tsx
// reports/site.tsx —— ③ 拆页：内建内容作首页，再加自己的页
import { ExperimentComparison, Scoreboard, defineReport, examScore } from "niceeval/report";

export default defineReport({
  title: "Memory Evals",
  links: [{ label: "GitHub", href: "https://github.com/you/repo" }],
  pages: [
    { id: "overview", title: { en: "Overview", "zh-CN": "总览" }, content: <ExperimentComparison /> },
    {
      id: "exam",
      title: { en: "Exam", "zh-CN": "成绩单" },
      content: <Scoreboard rows="agent" questions={[
        "security/sql-injection",
        "correctness/retry",
      ]} fullMarks={100} score={examScore} />,
    },
  ],
});
```

② 是最小品牌化形态：一个字段加一个组件，得到「内建内容 + 自己的标题与 GitHub 链接」。`content` 与 `pages` 必须恰好声明一个（见[外壳与多页](shell.md)）——「都不写就默认内建」这种隐式取值不存在，读文件的人必须能看出会渲染什么。

## 内建报告显示什么

内置 `ExperimentComparison` 的行为契约——可比组分区、text/web 两面差异、端到端成功率口径——单点定义在[概览组件](summaries.md#experimentcomparison)；宿主注入 Scope 的选择规则见 [Architecture](../architecture.md#scope-是计算入口)。

## 相关阅读

- [外壳与多页](shell.md) —— 配置对象的字段穷尽与行为约束。
- [概览组件](summaries.md) —— `ExperimentComparison` 的契约。
- [Architecture](../architecture.md) —— 装载规范化：内建与 `--report` 的同一条管线。
