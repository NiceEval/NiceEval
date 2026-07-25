# `Scoreboard`

先接收一份显式固定题集，再把每个行维度在每道题上的分数折成总分和分科得分。组件不从已观测 attempt 的并集猜题集，因此「所有配置都没跑到的题」仍留在分母中并按 0 分计。共用数据形状、维度绑定节点与两面规则见[表格与矩阵](README.md)。

题集与分科都是结构子节点：`<Question>` 是一道题，`<Subject>` 把若干题归成一个分科并给出该科的默认权重。

```tsx
<Scoreboard fullMarks={100} score={examScore}>
  <Rows dimension="agent" />

  <Subject name="security" weight={3}>
    <Question id="security/sql-injection" />
    <Question id="security/path-traversal" />
  </Subject>

  <Subject name="correctness" weight={2}>
    <Question id="correctness/retry" />
  </Subject>
</Scoreboard>
```

题目很多时用普通 JSX `map` 展开，权重仍挂在条目上：

```tsx
<Subject name="security" weight={3}>
  {SECURITY_EVALS.map((id) => <Question key={id} id={id} />)}
</Subject>
```

不需要分科命名时把 `<Question>` 直接放在 `<Scoreboard>` 下，分科取 eval id 的完整父路径（无 `/` 时取完整 id）：

```tsx
<Scoreboard fullMarks={100}>
  <Rows dimension="agent" />
  <Question id="security/sql-injection" weight={3} />
  <Question id="security/path-traversal" weight={3} />
  <Question id="correctness/retry" weight={2} />
</Scoreboard>
```

```ts
interface QuestionProps {
  /** eval id；在整份题集内唯一。 */
  id: string;
  /** 该题权重；省略时取所属 Subject 的 weight，再省略为 1。必须是正有限数。 */
  weight?: number;
}

interface SubjectProps {
  name: string;
  /** 本科题目的默认权重。 */
  weight?: number;
  children: QuestionNode | readonly QuestionNode[];
}

interface ScoreboardData {
  rowDimension: string;
  questions: string[];
  fullMarks: number;
  /** 逐题解析后的权重，按题集声明顺序。 */
  weights: Array<{ evalId: string; subject: string; weight: number }>;
  ignoredEvals: number;
  rows: Array<{
    key: string;
    total: {
      /** fullMarks × earned / possible。 */
      value: number;
      display: LocalizedText;
      /** 题集中该行完全没有 attempt 的题数。 */
      notRun: number;
      /** 有 attempt 但指标为 null（测不了）的题数。 */
      unscorable: number;
      refs: AttemptLocator[];
    };
    subjects: Array<{
      key: string;
      /** 加权后的 [0, 1] 题目分数之和。 */
      earned: number;
      /** 本分科题目的权重之和。 */
      possible: number;
      questions: number;
      notRun: number;
      unscorable: number;
      display: LocalizedText;
      refs: AttemptLocator[];
    }>;
  }>;
}

interface ScoreboardOptions {
  rows: DimensionInput;
  /** 固定题集，逐题带分科与权重；顺序即声明顺序。空题集在计算时按完整用户反馈报错。 */
  questions: readonly { id: string; subject: string; weight: number }[];
  fullMarks?: number;
  score?: Metric;
  evals?: string | readonly string[];
}

function scoreboardData(
  input: ReportInput,
  options: ScoreboardOptions,
): Promise<ScoreboardData>;

type ScoreboardProps = ComponentProps<ScoreboardData, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

`score` 默认 `examScore`，每道题必须产出 `[0, 1]`；同一行中同一个 experiment × eval 的多轮先用该 Metric 的 `perEval` 聚合，同题横跨多个 experiment 时再用 `acrossEvals` 聚合。分数口径上，指标为 `null`（跑了但测不了）与完全未运行都按该题 0 分——固定题集的分母不缩水；但两者分开计数为 `unscorable` 与 `notRun`，成绩单能回答「这 0 分是没去考还是考了判不了」，渲染面把两个计数连同 `refs` 一起显示，不合并成一个笼统的缺失数。题目得分乘各自权重；总分是 `fullMarks × earned / possible`，`fullMarks` 默认 100，分科显示 `earned / possible` 与同尺度百分比。

推定分科名与某个显式 `<Subject name>` 相同时并入该科，权重仍逐题解析——权重是题目的属性，不因归到哪一科而改写。

Scope 中存在题集之外的 eval 时，Scoreboard 忽略它们，把数量写进 `ignoredEvals` 并在注脚显示。零个 `<Question>`、`id` 重复、`fullMarks <= 0`、非正或非有限权重、`<Subject name>` 为空字符串，或 score 超出 `[0, 1]` 时，计算以完整用户反馈失败，不产出歧义成绩单。

## 相关阅读

- [表格与矩阵](README.md) —— 共用数据形状、维度绑定节点与两面规则。
- [`MetricTable`](metric-table.md) / [`MetricMatrix`](metric-matrix.md) / [`DeltaTable`](delta-table.md) / [`StabilityMatrix`](stability-matrix.md) —— 其它表格与矩阵。
