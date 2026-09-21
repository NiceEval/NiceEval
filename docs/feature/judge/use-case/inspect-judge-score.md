---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 使用现成裁判并复核判分依据

作者要检查回答是否符合参考答案，并确认质量门失败时仍能读到实际分数和裁判依据。
评价标准、材料和质量门分别由 Match、`check` 和 Assertion handle 拥有。

```ts
import { defineAdapter } from "niceeval";

const app = defineAdapter({
  name: "answer-service",
  create: () => ({ answer: () => "北京是中国的首都。" }),
});
export default app.defineScoreEval({
  judge: "judge-model",
  async test(t) {
    const output = t.answer();
    t.factuality({
      input: "中国的首都是哪里？",
      output,
      expected: "中国的首都是北京。",
    }).gate(0.8).score(10);
  },
});
```

Factuality 先判定回答与参考答案的关系，再由代码把类别映射为分数。
分数不是模型对自身判分结果的置信度。
`t.factuality(material)` 等价于 `t.check(material, factuality())`，使用同一 Match 和执行路径。

作者从公开 Assertion detail 读取输入、评价配置、受管模型步骤及最终测量值。
低于质量门的有效测量得到 failed Verdict，同时保留 earned score。
模型调用失败、非法响应或未完成的必要步骤得到 unavailable 或 errored；它们不能伪装成零分或完整成绩。

对上下文忠实度，`faithfulness()` 抽取回答中的陈述，再检查每条陈述是否受到上下文支持。
分数是受支持陈述数除以全部已提取陈述数；详情保留完整分母和逐项判定。
这个比例描述模型对陈述的检查结果，不保证抽取过程穷尽了回答中的一切含义。
由于 TypeSafe System One 不提供 `extract`，`faithfulness()` 在 `TypesafeProvider` 上得到 `unavailable`。
它不会改为整体估分、截断陈述或调用另一个辅助模型。

`closeQA()` 检查回答是否只依据给定上下文。它接收 `{ input, output, context }`；完整有据的回答，或材料不足时
准确拒答，得到 `1`。有据但遗漏必要内容得到 `0.5`。编造、矛盾、答非所问，或可答却拒答得到 `0`。冲突时先取
incorrect，再取 incomplete，最后才取 correct。
