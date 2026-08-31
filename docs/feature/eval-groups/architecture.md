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

Group 是物理 resource lane，也是 Group Plugin 的显式声明位置。Group lifecycle 跨 replacement
保持一次；每个 occurrence 的 Sandbox lifecycle 则随实际物理实例重新执行。

## 调度

运行器把每个 Group 建成一条 capacity-one lane。lane 内按规范化 Eval ID 排序，再把每个
成员的 Attempt index 连续展开。carry slot 在建 wave 前移除，不占并发位，也不取得 Sandbox。

不同 lane 按调度波次公平进入全局与 Experiment 并发限制。Group 的 capacity-one 只约束自己，
不把整个 Experiment 降成串行。每个 Group 使用独立复用池；普通 `sandboxReuse` 的共享池
不与 Group pool 合并。

波次公平只决定多个**当前可派发** lane 同时竞争许可时的先后，必须保持 work-conserving：只要全局与
Experiment 并发位空闲，并且某条 lane 能复用已经取得的 Sandbox，Runner 就继续派发该 lane。
首波准入条件不得要求所有 lane 先取得 Provider reservation、创建物理 Sandbox 或完成首槽位，才允许任一
lane 派发后继；等待 `provider-capacity` 的 lane 也不得占住 Experiment 并发位。否则 Group 数量大于
Provider 物理容量时，首波会保留全部容量、后继又被首波准入条件阻塞，形成循环等待。

尚未取得 Provider reservation 并启动 Sandbox 的 lane 不因暂时缺少 capacity 永久失去公平机会。已有实例释放或容量增加后，
admission 重新把它纳入候选；这种 eventual fairness 不能以暂停已有复用 lane、制造全局空闲为代价。

## 不变量

- 一条 Eval 最多属于一个 Group。
- 同一 Group 同时最多有一条 Attempt 持有 lease。
- Group lane 的执行顺序只来自规范化 Eval ID，不来自作者数组位置。
- Group pool key 包含物理 Provider plan、Agent install plan、Experiment 与 Group scope。
- 调度公平不以“每条 lane 都已取得 reservation 并启动 Sandbox”为 barrier；Provider capacity 小于 lane 数仍必须推进。
- 结果、锁与 carry 的主键仍是 Eval Attempt；Group 只增加 lane、pool 与调度上下文。
