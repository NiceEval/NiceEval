# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md)

## 裁决

采纳 [PLAN-5](PLAN-5/README.md)。
作者面是“静态 page + 普通函数 + 普通结果值 + 按形状命名的组件”。

- page 清单静态可见；host 在作者 callback 前闭合 projection，Calculation 与 Page callback 同步消费普通值并各自隔离失败。
- `reportInputs()` 静态声明 projection；`defineCalculation()` 以普通函数形成普通 closed value。
- 复杂算法的结果类型显式携带自己的 observed、denominator、state、issues 与 refs。
- 普通 Analysis 与 Report Calculation 可以调用同一纯函数，不建立结果注入协议。
- 组件只消费已经形成的普通值或 `ReportCalculationResult`，不读取 Record。
- 只有新增显示形状时才定义 text / web 双面 renderer。

## 为什么替换 PLAN-2

PLAN-2 正确识别了涵盖范围、证据下钻与双面一致这些硬约束，但把内部运行阶段投影成了三个作者概念。

Source 让作者理解声明何时 compute；Composition 让作者理解 page context 与树读取；Component 的 source / data 双入口让调用点无法直接说出值的角色。

这些协议没有增加表达力。
普通函数已经能完成 join、排序、公式组合与复用；Effect-native I/O 则统一停在 host input phase。
正确性应由 Sample denominator、穷尽 Projection、领域结果类型与公式验证共同约束，不应由整条查询运行时约束。

## 为什么仍否决其它方案

- PLAN-1 按领域问题增加组件，双面实现和 props 会随问题数增长。
- PLAN-3 把两级聚合、coverage 与 refs 交还给每条 SQL。
- PLAN-4 让同一报告出现两套读取与计算入口，较弱路径会成为事实标准。

PLAN-5 保留通用原语与 TypeScript 组合，同时不建立第二门查询语言。

## 契约落点

- 作者 API、Page、Calculation 与 closed semantic tree：[Reports Library](../../feature/reports/library.md)。
- 求值、input closure、problem inventory 与 renderer：[Reports Architecture](../../feature/reports/architecture.md)。

## 风险

- Calculation 不能依赖另一个 Calculation；共享的多阶段公式必须收进一个纯函数或一个 Calculation。
- closed semantic tree 限制任意交互扩展；新增 block variant 必须同时定义 terminal、web 与 static 语义。
- 报告旁算法的结果类型只能保留口径，不能自动证明公式正确；重复出现且满足准入判据后才提升进公共内核。
