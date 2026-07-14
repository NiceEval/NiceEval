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

`result.json` 的 `assertions` 数组元素，也是 [Severity 与 Verdict](architecture/severity-and-verdict.md) 判定规则的输入。字段契约单点定义在这里，[Results Format](../results/architecture.md#resultjson) 引用而不复写：

```typescript
interface AssertionBase {
  /** 断言标题:t.group 内是该断言自己的摘要,组外是 matcher 摘要或 judge 问题;show/view 失败行的标题。 */
  name: string;
  /** 所属分组路径:外层在前的 t.group 标题数组;无分组省略。纯报告用,不影响判定。 */
  groupPath?: string[];
  severity: "gate" | "soft";
  /** 作者用 .optional() 显式允许该断言缺席;只改变 unavailable 的折叠方式(见 Severity 与 Verdict),不改变 severity 语义。 */
  optional?: true;
  /** matcher / judge 摘要,如 `equals(4)`、`closedQA("…")`;与 name 分开,供 show/view 同时展示分组标题与检查方式。 */
  detail?: string;
  /** 断言在 eval 源码中的调用点,`--eval` 把结果标回源码行的锚。 */
  loc?: { file: string; line: number; column?: number };
}

type AssertionResult =
  | (AssertionBase & {
      outcome: "passed" | "failed";
      /** 归一化得分:值断言 0/1,judge 等打分断言 0..1。 */
      score: number;
      /** soft 断言的 .atLeast(x) 阈值;没有设阈值则省略。 */
      threshold?: number;
      /** 失败证据摘要:期望值 / 实际值的有界文本预览,供 show/view 直接展示。 */
      expected?: string;
      received?: string;
      /** 这条分数看着什么材料算出(judge 输入或被检查值预览);view 展开排查用,默认不展示。 */
      evidence?: string;
    })
  | (AssertionBase & {
      outcome: "unavailable";
      /** 机器可读原因,如 "judge-model-unresolved"、"coverage:actions=partial"。 */
      reason: string;
    });
```

判别键是 `outcome`——`unavailable` 是没有分数的独立态，不存在「`passed: false` 但又不许当失败、`score: 0` 但又不许聚合」的非法组合：普通聚合代码按 `outcome` 分支就不可能把证据缺口算成零分。这份字段全集是穷尽的：show / view / 报告需要的每个展示字段都在表内，不存在「塞进 `name` 再拆」的隐式约定。`expected` / `received` / `evidence` 是有界预览而不是原始值——原始证据在 `events.json` / `diff.json` 等 artifact 里；判定只消费 `severity` / `outcome` / `optional` / `score` / `threshold`。
