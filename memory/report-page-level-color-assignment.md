# report-page-level-color-assignment

## 裁决

2026-07-25:维度值的颜色**按页分配**，不按组件。契约落在 `docs/feature/reports/components/README.md`「系列色:分配单位是页」，管线位置写在 `docs/feature/reports/architecture.md`(resolve → validate → render，render 前收集这一页已解析数据里的全部 `(维度, 值)` 对算一次映射)。

规则:色只按 `(维度, 维度值)` 取，不按组件也不按显示名(`ExperimentList` 缩短后的行标签不参与取键)；以稳定散列为起点，同一页 keyset 内撞色按显示键字典序线性探测下一个空色格，超出色板才复用；这一页全部消费者(图表 series 与图例、实体列表的 agent 键、矩阵行列头)读同一份映射。跨页稳定让位给页内可辨——读者跨页比较靠标签，页内比较才靠颜色。

## 起因

用户实测:首页散点图例里 bub 蓝、codex 绿，同页实验列表里两个 agent 都是蓝。根因是 [[scatter-series-color-collision]] 那次修法**有意**只改图表路径——`colorIndicesForKeys(seriesOrder)` 做图内消解，表格 agent 名走 `colorClassForKey(key)` 单键散列不消解；`bub` 与 `codex` 恰好散列同格。旧契约两处也没对齐:`entity-lists.md` 只说「颜色跟 Agent」，`metric-views.md` 只说「同一张图内撞色时探测」，没有任何一句要求两者一致。

## 修法

不是「让列表也吃图表的映射」，而是把分配单位整体上提一层:消解的输入从「一张图的 series 集合」换成「一页的维度值集合」，图表与列表都是消费者。这样 `colorClassForKey` / `colorIndicesForKeys` 两条路径合成一条，也不需要在组件之间传色表。

上一条修法([[scatter-series-color-collision]])的判断——「先探测、探不动再复用」——保留；被推翻的只是它的作用域(图 → 页)与「跨块单键着色不变」那一句。

覆盖规范已登记在 `docs/engineering/testing/unit/reports.md`「页级色分配」:断言面是映射本身(同键同色、字典序探测、超板复用、缩短显示名不参与取键)，不断言渲染出的颜色值。
</content>
