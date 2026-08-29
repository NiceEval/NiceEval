# Decision

## 裁决

为三层分析方案采纳
[PLAN-1](PLAN-1/README.md)：领域 package 用 pure assembler 解释关系，host 验证 SameSample 输入与穷尽 population。

这是 Roadmap 目标的选型裁决。该方向被产品采用前，产品没有独立的公共 Relations authoring contract；本裁决不能
被实现当作已经进入当前 Feature 的 API。

## 为什么选择 PLAN-1

- relation 只消费 closed projections，不延长 reader 或 snapshot 生命周期；
- durable anchor、cardinality 与领域错误分类留在真正拥有事实语义的 package；
- host 仍强制相同 Sample、population alignment 与完整 cell 数；
- unmatched、ambiguous、input states 与 relation coverage 保留为成功数据；
- Derivation 继续使用普通函数，不引入 managed query runtime。

## 为什么否决 PLAN-2

[PLAN-2](PLAN-2/README.md) 能统一验证公共 edge 与 anchor vocabulary，但会限制第三方领域的关系表达，并增加 field、
anchor version 与 cardinality tokens。当前目标只需要共同的穷尽输出保证，不需要让 host 理解每种 edge。

## 当前状态

公共 Relation 作者面已随通用 Analysis 层退出当前产品；这份裁决只保留历史候选理由。当前比较由固定
[`runs.compare`](../../feature/inspection/architecture.md)唯一拥有，Record 与 Insight 边界见
[Record → Inspection → 第一方 Delivery](../../feature/run-inspection/README.md)。
