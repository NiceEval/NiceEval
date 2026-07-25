# 用 artifact 定义业务指标

## 解决什么问题

内置指标能回答通过率、成本和耗时,但你要问「通过的方案改了多少行」或「某类工具调用多少次」。

## 全流程

1. 用 `defineMetric` 声明名字、单位、好坏方向和两级聚合口径。
2. `where` 只保留指标真正适用的 Attempt;测不了返回 `null`,不返回 0。
3. `value` 通过 `AttemptHandle` 懒加载 diff、events、trace 或 o11y,在计算层做一次。
4. 把指标放进 `MetricTable`、图表或 `DeltaTable`,与主成功指标并排。
5. 需要新分组而不是新数值时定义 `CustomDimension`,不滥用 metric。

可复制代码见[自定义指标与维度配方](../library/recipes.md#自定义指标只比通过方案的改动行数)。

## 边界

- 指标是消费方观点,不回写 Results,不改 verdict。
- 自定义计算要在服务端、构建脚本或 report resolve 阶段运行,不放进纯 React renderer。
