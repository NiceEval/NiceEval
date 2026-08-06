# 分组 Sandbox 复用

评估作者在 `evals/` 中声明 Sandbox 复用组，Experiment 只按组 id 决定本条件启用哪些组。
已启用组的 Eval 轮流使用该组的一台活跃 Sandbox；不同组绝不共用实例，其余 Eval 使用全新 Sandbox。

## 解决的问题

全实验复用把所有 Eval 放进一个隐式池，也让每个 Experiment 重复维护同一份成员边界。
作者无法直接写出“这几道评估属于同一套环境，其它评估保持隔离并行”这条题集契约。

三个 dogfooding 场给出三类约束：

| 项目 | 真实边界 | 配置结论 |
|---|---|---|
| MemoryBench | 记忆条件需要共用环境，baseline 对同一批题仍要 fresh 并行 | 在记忆链目录声明一组，只由记忆 Experiment 启用 |
| Terminal-Bench | 238 个题各自声明环境并独立判分 | 不声明组，每条 Attempt 使用全新 Sandbox |
| NiceEval-Eval | 两道当前项目题可复用安装缓存，迁移题仍可独立运行 | 在 `experiment/` 中定义具名组，并由对应 Experiment 启用 |

## 核心心智

Sandbox Layer 与复用组正交：

- Layer 回答“一条 Eval 最终需要什么 Sandbox，以及按什么顺序 prepare”；
- 复用组回答“哪些已经完成 link 的 Eval 轮流使用同一物理实例”。

Runner 先按既有 Layer 契约完成 Eval × Experiment link，再校验每个已启用组中本次选中成员的物理复用身份完全一致。
已选成员解析出不同 template、Provider plan、Agent ensure identity 或 lifecycle owner 时，框架在创建资源前报错，不猜测也不拆组。

组定义位于 `evals/` 下的 `*.sandbox-group.ts` 或 `<group>/sandbox-group.ts`，与 Eval 的文件入口、目录入口对称。
定义文件所在目录只提供引用锚点，文件路径只生成稳定组 id，不自动决定成员。
文件必须用 `defineSandboxGroup()` 明确列出每个 Eval；新增文件不会因为碰巧放在同一目录就进入共享环境。

Experiment 使用 `sandboxReuse: { groups: [...] }` 精确引用组 id。
这只是启用已有边界，不允许在 Experiment 内追加、删除或覆盖成员；省略时本条件全部 fresh。

每个组只有一台活跃 Sandbox，因此组内 Attempt 串行。
不同组和未分组 Attempt 继续在 Experiment 与 Invocation 的并发上限内并行。

实例不可用时的处理没有默认约定。
每个组必须明确配置 `onUnavailable: "stop-group"` 或 `"replace-sandbox"`；前者保护物理连续性，后者只把复用当作性能优化。

复用组不声明 Eval 顺序、完整前缀或业务依赖。
这些执行历史由[有序 Eval 序列](../ordered-sequences/README.md)唯一负责；纵向评测把 Sequence 与 `stop-group` 复用组组合使用。

## 设计结论

1. `defineSandboxGroup()` 是唯一成员定义入口；Experiment 只引用组 id，不重复成员，也不提供全实验复用布尔值。
2. 一个 Eval 至多属于一个组；组身份来自目录中的显式定义，不从目录内容、tag、metadata 或 Layer 自动推导。
3. 同组只有一台活跃 Sandbox；不同组即使物理配置相同也不共享实例。
4. 未分组 Eval 与本 Experiment 未启用的组成员都使用全新 Sandbox，并可与任一已启用组并行。
5. 每个组必须明确声明实例不可用时停止还是替换。
6. 已启用组的所有真实 Attempt 都进入所属组的同一串行队列；要得到彼此隔离的重复轨迹，使用独立 Experiment 与独立状态身份。
7. 已启用的组定义与完整成员关系只进入其成员 pair 的指纹；未启用组和未分组 Eval 不影响本 Experiment。

## 范围

本功能包含：

- `evals/` 内的 `defineSandboxGroup()`、文件入口与目录入口发现，以及 Experiment 的显式组引用；
- 显式成员、重叠检查、Layer link 后的物理身份预检；
- 组内单实例调度、显式替换策略、失败传播和运行记录；
- `--dry`、live 与结束反馈中的组和实例归属。

本功能不包含：

- 第二套 Eval 顺序或依赖声明；
- 在不同 Invocation 之间共享运行中的 Sandbox handle；
- 把目录中的全部 Eval、Docker build 或远程记忆库自动视为一个组；
- 为 Eval 作者暴露可写的复用池句柄；
- 根据 `maxConcurrency` 自动决定组数或实例数。

跨 Invocation 的外部 checkpoint 与数据库仍使用 [`sharedState.key`](../../feature/experiments/README.md)。
外部状态需要按组隔离时，作者使用不同的稳定状态身份；Sandbox 组不替第三方系统创建命名空间。

## 入口

- [Library](library.md) —— `defineSandboxGroup()`、发现路径、成员引用与错误反馈。
- [Architecture](architecture.md) —— Layer 边界、规划实体、调度、指纹与记录形状。
- [Lifecycle](lifecycle.md) —— fresh、组内复用、停止与替换的完整时序。
- [Use Cases](use-case/README.md) —— MemoryBench、Terminal-Bench 与 NiceEval-Eval 的完整写法。
