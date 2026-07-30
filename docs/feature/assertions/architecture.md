# Assertions —— 架构

值 matcher、作用域检查与 Judge 最终都进入同一个 Assertion collector。
collector 只产出 `AssertionResult[]`；执行状态与断言怎样折叠成 Verdict 由 [Verdict](../verdict/README.md) 定义。

```text
value / scope / judge / sandbox / efficiency
                    │
                    ▼
           Assertion collector
                    │
                    ▼
           AssertionResult[] ─────┐
                                  ├──► Verdict
Runner execution state + strict ──┘
```

## 设计主题

- [作用域绑定](architecture/scopes.md)
- [证据与完整性](architecture/evidence.md)

Severity 与四态折叠不属于本层，见 [Verdict](../verdict/architecture.md)。

**Assertion（输入态）** 是 matcher、作用域断言与 Judge 这些「怎么查」的表达。
例如 [`custom-assertions`](library/custom-assertions.md) 里的 `function jsonValid(): Assertion`。
collector 把每次检查折叠成的「查出了什么」是 **`AssertionResult`（记录态）**。
`Verdict` 表达整个 Attempt 的互斥结果。
多个 Attempt 的报告聚合通过率和平均耗时，不制造第五种 Verdict。

## 断言记录（AssertionResult）

`result.json` 的 `assertions` 数组元素，也是 [Severity 与 Verdict](../verdict/architecture.md) 判定规则的输入。
字段契约单点定义在这里，[Record Format](../record/architecture.md#resultjson) 引用而不复写：

```typescript
interface ProjectSourceFrame {
  kind: "project";
  /** 相对项目根的路径。 */
  file: string;
  line: number;
  column?: number;
}

interface PackageSourceFrame {
  kind: "package";
  package: string;
}

type SourcePathFrame = ProjectSourceFrame | PackageSourceFrame;

interface SourceLoc {
  /** 声明位置，相对项目根。 */
  file: string;
  line: number;
  column?: number;
  /** 从 eval 入口到声明处，由外到内；不含声明处自身，无可用链时为空数组。 */
  callers: SourcePathFrame[];
}

interface AssertionBase {
  /** 断言标题:t.group 内是该断言自己的摘要,组外是 matcher 摘要或 judge 问题;show/view 失败行的标题。 */
  name: string;
  /** 所属分组路径:外层在前的 t.group 标题数组;无分组省略。报告分块与对比得分点的维度键,不影响判定。 */
  groupPath?: string[];
  severity: "gate" | "soft";
  /** 作者链过 .stopOnFailure();仅在本条 failed 时停止后续 test 代码,与 severity 正交。 */
  stopOnFailure?: true;
  /** 作者用 .optional() 显式允许该断言缺席;只改变 unavailable 的折叠方式(见 Severity 与 Verdict),不改变 severity 语义。 */
  optional?: true;
  /** matcher / judge 摘要,如 `equals(4)`、`closedQA("…")`;与 name 分开,供 show/view 同时展示分组标题与检查方式。 */
  detail?: string;
  /** 断言在 eval 源码中的声明位置与调用路径，`--source` 据此装配源码调用树。 */
  loc?: SourceLoc;
}

type AssertionResult =
  | (AssertionBase & {
      outcome: "passed" | "failed";
      /** 归一化得分:值断言 0/1,judge 等打分断言 0..1。 */
      score: number;
      /** .atLeast(x) / .gate(x) 设的通过线;纯记录 soft 与默认线时省略。 */
      threshold?: number;
      /** 失败证据摘要:期望值 / 实际值的有界文本预览,供 show/view 直接展示。 */
      expected?: string;
      received?: string;
      /** 这条分数看着什么材料算出(judge 输入或被检查值预览);view 展开排查用,默认不展示。 */
      evidence?: string;
      /**
       * `.points(n)` 挂在这条断言上的挣分:`n × score`(0/1 断言通过挣 n、不过挣 0;打分断言按
       * 连续分比例挣)。只在计分制 eval 里链过 `.points()` 时出现;省略表示这条断言不参与计分
       * (通过制 eval 的全部断言,或计分制 eval 里没链 `.points()` 的断言)。与 `score` 是两个读数——
       * `score` 判定用,`points` 计分用,互不派生(见[计分粒度](library/score-points.md))。
       */
      points?: number;
    })
  | (AssertionBase & {
      outcome: "unavailable";
      /** 机器可读原因,如 "judge-model-unresolved"、"judge-call-failed"、"coverage:actions=partial"。 */
      reason: string;
      /**
       * 评不了的一层人读细节:judge 调用失败时是状态码 / 异常摘要,证据通道不完整时是缺的通道与
       * 实际覆盖度。`reason` 回答「归哪一类」,它回答「这一条具体怎么了」——没有它,一个
       * `judge-call-failed` 分不出是网关拒了鉴权还是请求体不合协议,而两者的下一步完全不同。
       */
      evidence?: string;
    });

/**
 * `t.score(label, n)` 的直接给分记录,与 `AssertionResult` 分属两个数组——它不是一条被评估的
 * 断言,没有 severity、没有 outcome,不参与判定或质量分,只贡献分数面:
 */
interface ScoreEntry {
  /** 作者传入的 label,原样进报告。 */
  label: string;
  /** 直接给分,n >= 0(见[计分粒度](library/score-points.md))。 */
  points: number;
  /** 所属分组路径,同 AssertionBase.groupPath;规则一致(外层在前的 t.group 标题数组)。 */
  groupPath?: string[];
  /** 调用点，同 AssertionBase.loc。 */
  loc?: SourceLoc;
}
```

`loc` 整体仍可省略：运行时无法取得栈时，记录进入源码视图的 unmapped 区。
只要 `loc` 存在，`callers` 就是必选数组；单文件 eval 与调用链缺失都写空数组，避免多个构造点各自解释“没填”含义。
`package` 帧只保存包名，不把第三方源码纳入 Record。

判别键是 `outcome`。
`unavailable` 是没有分数的独立态，不存在「`passed: false` 但又不许当失败」或「`score: 0` 但又不许聚合」的非法组合。
普通聚合代码按 `outcome` 分支，不会把证据缺口算成零分。

这份字段全集是穷尽的。
show、view 与报告需要的每个展示字段都在表内，不存在「放入 `name` 再拆」的隐式约定。
`expected`、`received` 与 `evidence` 是有界预览，而不是原始值。
原始证据保存在 `events.json`、`diff.json` 等 artifact 里。
判定只消费 `severity`、`outcome`、`optional`、`score` 与 `threshold`；`points` 不参与判定。

`points` 与 `ScoreEntry` 是计分制(`defineScoreEval`)才会出现的分数面数据;通过制 eval 的 `AssertionResult` 永不带 `points`,其 attempt 记录也永不携带 `ScoreEntry`。
两者共用同一套 `groupPath` 折叠约定, 分数面的逐层求和规则见[计分粒度](library/score-points.md#折叠树判定面分数面质量分)。

计分制记录里 `severity`、`points` 与 `stopOnFailure` 分别回答硬不硬、挣不挣分、停不停：得分点是 `severity: "soft"` + 有 `points`，硬要求是 `severity: "gate"`，前置再显式带 `stopOnFailure: true`。
观测是 `severity: "soft"` + 无 `points`。
质量分因此按「soft 且没有 `points`」取子集聚合。
得分点已经在分数面被读过一次，不再进入质量分。
