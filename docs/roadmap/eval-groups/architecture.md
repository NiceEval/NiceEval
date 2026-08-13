# Eval Group —— Architecture

## 发现与成员归属

discovery 只加载 `evals/**/eval-group.ts`，根目录 `evals/eval-group.ts` 没有有效 Group ID。
Group entry 导入 Eval factory 的原始返回对象；同一次 namespaced module graph 中，共享模块只
求值一次，所以 Group 成员与 Eval entry 保持对象 identity。发现完成后通过对象 identity
查找到规范化 Eval ID，并进行非空、去重、单一归属和成员 Layer 复核。

数组位置不进入成员身份。规范化成员 ID 集排序后进入 Group definition hash；增删成员、修改
可执行 Group source、改变 `onUnavailable`、Sandbox Layer 或 Group Plugin 行为都会改变身份。

## Sandbox link 与兼容性

每个实际 Eval × Experiment pair 仍独立完成三层 Sandbox link 和 Provider planning。
同一 Group 的成员必须得到相同的物理 Provider identity、Agent install plan 与 Sandbox
Plugin lifecycle identity。任何不一致在创建 Provider 资源前聚合成 `eval-group-incompatible`。

Group 是物理 cohort，也是 Group Plugin 的显式声明位置。Group lifecycle 跨 replacement
保持一次；每个 occurrence 的 Sandbox lifecycle 则随实际物理实例重新执行。

## 调度

运行器把每个 Group 建成一条 capacity-one lane。lane 内按规范化 Eval ID 排序，再把每个
成员的 Attempt index 连续展开。carry slot 在建 wave 前移除，不占并发位，也不取得 Sandbox。

不同 lane 按调度波次公平进入全局与 Experiment 并发限制。Group 的 capacity-one 只约束自己，
不把整个 Experiment 降成串行。每个 Group 使用独立复用池；普通 `sandboxReuse` 的共享池
不与 Group pool 合并。

## 不变量

- 一条 Eval 最多属于一个 Group。
- 同一 Group 同时最多有一条 Attempt 持有 lease。
- Group lane 的执行顺序只来自规范化 Eval ID，不来自作者数组位置。
- Group pool key 包含物理 Provider plan、Agent install plan、Experiment 与 Group scope。
- 结果、锁与 carry 的主键仍是 Eval Attempt；Group 只增加 cohort 与调度上下文。
