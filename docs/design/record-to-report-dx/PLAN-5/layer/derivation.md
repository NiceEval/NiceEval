# Derivation 子设计

**上游**：[Relations](relations.md) · **下游**：[Report](report.md) ·
**拓扑裁决**：[PLAN-4](../../PLAN-4/README.md)

Derivation 从 relations 或 Sample-aligned facts 形成 metric、coverage 和领域模型。它始终是一类
计算责任，但只有 host 需要管理依赖、去重、调度或局部失败时，才成为独立 runtime
layer。

## 两种合法形态

| 形态 | 执行者 | 适用条件 | 失败边界 |
|---|---|---|---|
| 纯函数 | Report 模块或分析脚本 | 显式复用已足够，不需要 host dependency graph | 调用者自行处理 |
| managed Derivation | Report host | 需要跨 consumer 去重、consumer-local failure 或 provenance | 只阻断依赖它的 consumers |

两种形态必须使用同一批 pure calculation 和 reconciliation policies。不能为 managed runtime
另写一套指标真相。

## 拥有的契约

Derivation 显式声明 inputs、计算函数、coverage policy 与多源 observation reconciliation。
结果携带 typed value、coverage、reasons 和 lineage，不从页面文本反推机器可读值。

Managed 形态额外拥有 execution-local identity、dependency scheduling、同一对象的跨 consumer 去重和
局部错误传播。Stable ID、跨 execution cache 与持久 provenance 不是最小契约，只在真实
需求出现时增加。

## 不拥有的责任

- 不打开 package、不重做 Projection 或 Relations。
- 不静默删除 logical slots，不用 available rows 反推 denominator。
- 不选择 routes、渲染 Page 或读取浏览器状态。
- 不把统计学或业务策略偷藏在 Relations。

## 是否建立 runtime layer

只要下列任一条成为硬产品契约，就选择 managed Derivation：

- 一个公式失败只能阻断依赖它的 Page 或 Download；
- 不同 consumers 引用同一 derivation 时必须自动去重；
- host 必须在不打开 Report 实现的情况下规划依赖；
- 用户必须检查字段级公式 provenance。

如果这些都不是必要契约，Derivation 保持为普通纯函数库，不为了目录对称创建空 runtime。

## 验收条件

- Overview 与 CSV 消费同一 typed metric，不重复公式或从页面文本反推数值。
- Usage/timing 多源值只在显式 reconciliation policy 下形成 agreement 或 conflict。
- 公式不能用过滤掉 unavailable slots 的方式伪造更好的 coverage。
- 纯函数形态可脱离 Report UI 在分析脚本中复用。
