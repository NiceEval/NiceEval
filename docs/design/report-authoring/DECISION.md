# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md)

## 裁决

采纳 [PLAN-5](PLAN-5/README.md)。
作者面是“静态 page + 普通函数 + 普通结果值 + 按形状命名的组件”。

- page 清单静态可见，page render 拥有异步、按页失败隔离与缓存。
- `rollup()` / `aggregate()` 保障两级聚合、coverage 与 refs。
- 复杂算法通过 `metricValue()` / `evidenceRow()` 交出证据结果。
- 实体投影是 `to*` 立即转换，复用区块是普通函数。
- 组件只接 `rows`、`points`、`items`、`nodes`、`value` 或 `attempt`。
- 只有新增显示形状时才定义 text / web 双面 renderer。

## 为什么替换 PLAN-2

PLAN-2 正确识别了两级聚合、涵盖范围、证据下钻与双面一致这些硬约束，但把内部运行阶段投影成了三个作者概念。

Source 让作者理解声明何时 compute；Composition 让作者理解 page context 与树读取；Component 的 source / data 双入口让调用点无法直接说出值的角色。

这些协议没有增加表达力。
普通函数已经能完成异步、组合、并行、join、排序与复用。
正确性应由 `aggregate()` 和证据结果构造器约束，不应由整条查询运行时约束。

## 为什么仍否决其它方案

- PLAN-1 按领域问题增加组件，双面实现和 props 会随问题数增长。
- PLAN-3 把两级聚合、coverage 与 refs 交还给每条 SQL。
- PLAN-4 让同一报告出现两套正确性强度，较弱路径会成为事实标准。

PLAN-5 保留通用原语与 TypeScript 组合，同时不建立第二门查询语言。

## 契约落点

- 作者 API、page 与普通转换：[Library](../../feature/reports/library.md)。
- 聚合与准入边界：[Calculations](../../feature/reports/calculations.md)。
- 求值、缓存和双面：[Architecture](../../feature/reports/architecture.md)。
- 组件具体属性：[Components](../../feature/reports/components/README.md)。

## 风险

- page 是比单查询更粗的增量边界；性能靠 benchmark 与内部透明缓存守护。
- 双面自定义 renderer 仍有一面能力漂移风险；两面必填和 fixture 验收是门槛。
- 报告旁算法只能保证证据完整，不能自动证明公式正确；重复出现且满足准入判据后才提升进公共内核。
