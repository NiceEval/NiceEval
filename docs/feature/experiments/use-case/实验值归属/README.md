# 实验值归属 —— 用例

一句判据：**值是你写下的 → 配置；值是跑起来才知道的 → 运行时观测。**
配置再分一道：会改变 Attempt 里发生的事用 `flags`，只给报告归类用 `labels`。

| 目标 | 用例 |
|---|---|
| 声明会改变运行行为的 A/B 条件 | [用 flags 控制联网](声明运行条件.md) |
| 给报告增加不影响运行的坐标 | [用 labels 标注记忆机制](报告标注.md) |
| 保存启动后才知道的实例地址 | [上报运行时观测](上报运行时观测.md) |
| 同一个值既可能是条件也可能是观测 | [按角色选择归属](区分条件与观测.md) |

模型名是 `model` 配置，实验 id 是身份，都不属于这三个袋子。
运行时观测不是第三方可扩展的持久化面。只有 NiceEval 已发布的 typed collector 或 Adapter 能力才能把匹配值写入固定的 Observability、FileChanges、Assertions、Sources 或 Artifacts。
没有 collector 的值不自动持久化或查询。
完整归属规则见 [Library · labels 与运行时观测](../../library.md#labels-与运行时观测)。
