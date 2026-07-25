# Scoring —— 架构

Scoring 将执行状态、记录的 Assertions 与 skip 信号折叠成 Verdict。matcher、作用域断言和 judge 最终都进入同一个 Assertion collector。

```text
value / scope / judge / sandbox / efficiency
                    │
                    ▼
              Assertion[]
                    │
        execution error + skip + strict
                    │
                    ▼
                 Verdict
```

## 设计主题

- [作用域绑定](architecture/scopes.md)
- [Severity 与 Verdict](architecture/severity-and-verdict.md)
- [证据与完整性](architecture/evidence.md)

命名边界：**Assertion（输入态）** 是 matcher / 作用域断言 / judge 这些「怎么查」的表达（如 [`custom-assertions`](library/custom-assertions.md) 里 `function jsonValid(): Assertion`）；collector 把每次检查折叠成的「查出了什么」是 **`AssertionResult`（记录态）**。`Verdict` 表达整个 attempt 的互斥结果。多次 runs 的报告聚合通过率和平均耗时，不制造第五种 Verdict。

## 断言记录（AssertionResult）

`result.json` 的 `assertions` 数组元素，也是 [Severity 与 Verdict](architecture/severity-and-verdict.md) 判定规则的输入。字段契约单点定义在这里，[Record Format](../record/architecture.md#resultjson) 引用而不复写：

```typescript
interface AssertionBase {
  /** 断言标题:t.group 内是该断言自己的摘要,组外是 matcher 摘要或 judge 问题;show/view 失败行的标题。 */
  name: string;
  /** 所属分组路径:外层在前的 t.group 标题数组;无分组省略。报告分块与对比得分点的维度键,不影响判定。 */
  groupPath?: string[];
  severity: "gate" | "soft";
  /** 作者用 .optional() 显式允许该断言缺席;只改变 unavailable 的折叠方式(见 Severity 与 Verdict),不改变 severity 语义。 */
  optional?: true;
  /** matcher / judge 摘要,如 `equals(4)`、`closedQA("…")`;与 name 分开,供 show/view 同时展示分组标题与检查方式。 */
  detail?: string;
  /** 断言在 eval 源码中的调用点,`--source` 把结果标回源码行的锚。 */
  loc?: { file: string; line: number; column?: number };
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
       * `score` 判定用,`points` 计分用,互不派生(见[计分粒度](../experiments/score-points.md))。
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
  /** 直接给分,n >= 0(见[计分粒度](../experiments/score-points.md))。 */
  points: number;
  /** 所属分组路径,同 AssertionBase.groupPath;规则一致(外层在前的 t.group 标题数组)。 */
  groupPath?: string[];
  /** 调用点,同 AssertionBase.loc。 */
  loc?: { file: string; line: number; column?: number };
}
```

判别键是 `outcome`——`unavailable` 是没有分数的独立态，不存在「`passed: false` 但又不许当失败、`score: 0` 但又不许聚合」的非法组合：普通聚合代码按 `outcome` 分支就不可能把证据缺口算成零分。这份字段全集是穷尽的：show / view / 报告需要的每个展示字段都在表内，不存在「塞进 `name` 再拆」的隐式约定。`expected` / `received` / `evidence` 是有界预览而不是原始值——原始证据在 `events.json` / `diff.json` 等 artifact 里；判定只消费 `severity` / `outcome` / `optional` / `score` / `threshold`,`points` 不参与判定。

`points` 与 `ScoreEntry` 是计分制(`defineScoreEval`)才会出现的分数面数据;通过制 eval 的 `AssertionResult` 永不带 `points`,其 attempt 记录也永不携带 `ScoreEntry`。两者共用同一套 `groupPath` 折叠约定,分数面的逐层求和规则见[计分粒度](../experiments/score-points.md#折叠树判定面分数面质量分)。

计分制记录里 `severity` 与 `points` 的组合就是那条断言的角色,不需要第三个字段:得分点是 `severity: "soft"` + 有 `points`(不传播判定),前置是 `severity: "gate"`(中止,`points` 视有没有链 `.points()` 而定),观测是 `severity: "soft"` + 无 `points`。质量分因此按「soft 且没有 `points`」取子集聚合——得分点已经在分数面被读过一次,不再进质量分。
