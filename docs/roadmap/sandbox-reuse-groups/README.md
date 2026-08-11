# 分组 Sandbox 复用

评估作者在 `evals/` 中用 Sandbox 复用组声明一条强制运行边界。
同组 Eval 一旦被选中，就轮流使用该组的一台活跃 Sandbox；不同组绝不共用实例，未分组 Eval 使用全新 Sandbox。

## 解决的问题

全实验复用把所有 Eval 放进一个隐式池，也让每个 Experiment 重复维护同一份成员边界。
作者无法直接写出“这几道评估属于同一套 Sandbox，其它评估保持隔离并行”这条题集契约。

同组 Eval 还可能来自同一个 GitHub repository，只是 base commit 不同。
组级 Git repository 声明让一台 Sandbox 在首题前取得一次完整组需求，后续题目只在本地切换 commit，不再重新 clone 或 fetch。

三个 dogfooding 场给出三类约束：

| 项目 | 真实边界 | 配置判断 |
|---|---|---|
| MemoryBench | 纵向记忆链 Eval 只有 command-only prepare；不同记忆条件各自提供 template | 这些 Eval 可以在编译期组成一组，各 Experiment 分别拥有实例 |
| Terminal-Bench | 238 个 Eval 各自拥有 Dockerfile / Compose template | template-owning Eval 不能入组，每条 Attempt 使用全新 Sandbox |
| NiceEval-Eval | 两道当前项目题不拥有 Sandbox Layer，可复用 Node 条件的安装缓存 | 在 `experiment/` 中定义只含这两道题的具名组 |

## 核心心智

Sandbox Layer 与复用组按所有权组合：

- Layer 回答“一条 Eval 最终需要什么 Sandbox，以及按什么顺序 prepare”；
- 复用组回答“哪些已经完成 link 的 Eval 轮流使用同一物理实例”。

组成员不能拥有 template 或 `setup()` / `teardown()` 实例生命周期，只能省略 Sandbox Layer，或声明每 Attempt 重新执行的 command-only `prepare()`。
Experiment 是组实例唯一的 template 与 lifecycle owner；现有 Layer link 顺序不变。

这个限制进入 `defineEval()` 输出的类型状态。
`defineSandboxGroup()` 接收导入的 Eval definition，而不是字符串 id，因此 TypeScript 会直接拒绝带 template 或实例 hook 的成员；动态 JavaScript 与显式类型逃逸仍由发现期再次校验。

组定义位于 `evals/` 下的 `*.sandbox-group.ts` 或 `<group>/sandbox-group.ts`，与 Eval 的文件入口、目录入口对称。
定义文件所在目录只提供引用定位点，文件路径只生成稳定组 id，不自动决定成员。
文件必须导入 Eval definition，并用 `defineSandboxGroup()` 明确列出每个成员；新增文件不会因为碰巧放在同一目录就进入共享 Sandbox。

`defineSandboxGroup()` 本身就表示成员需要 Sandbox reuse，不再等待 Experiment 二次启用。
Experiment 只照常选择 Eval，不能追加、删除、覆写或关闭成员的分组归属。

每个组只有一台活跃 Sandbox，因此组内 Attempt 串行。
不同组和未分组 Attempt 继续在 Experiment 与 Invocation 的并发上限内并行。

实例不可用时的处理没有默认约定。
每个组必须明确配置 `onUnavailable: "stop-group"` 或 `"replace-sandbox"`；前者保护物理连续性，后者只把复用当作性能优化。

复用组不声明 Eval 顺序、完整前缀或业务依赖。
这些执行历史由[有序 Eval 序列](../ordered-sequences/README.md)唯一负责；纵向评测把 Sequence 与 `stop-group` 复用组组合使用。

## 设计裁决

1. `defineSandboxGroup()` 同时声明成员与必须复用；Experiment 不引用组、不重复成员，也不提供全实验复用布尔值。
2. 一个 Eval 至多属于一个组；成员来自导入 definition 的显式数组，不从目录内容、tag、metadata 或 Layer 自动推导。
3. 组成员的 Eval Layer 只能省略或保持 prepare-only；Experiment 独占 template 与实例 lifecycle。
4. 同组只有一台活跃 Sandbox；不同组即使物理配置相同也不共享实例。
5. 未分组 Eval 使用全新 Sandbox，并可与任一复用组并行。
6. 每个组必须明确声明实例不可用时停止还是替换。
7. 组成员的所有真实 Attempt 都进入所属组的同一串行队列；要得到彼此隔离的重复轨迹，使用独立 Experiment 与独立状态身份。
8. 组定义与完整成员关系只进入成员 pair 的指纹；未分组 Eval 不因无关组变化而失效。
9. 组可以声明 `repositories`；每个 repository 每台物理 Sandbox 只访问一次 origin，每题 `checkout()` 只选择 commit。
10. Git 加速只隔离题间写污染，不承诺同组 commits 对 Agent 互相不可见。

## 范围

本功能包含：

- `evals/` 内的 `defineSandboxGroup()`、文件入口与目录入口发现；
- definition 成员引用、Layer type-state、重叠检查与发现期运行时复核；
- 组内单实例调度、显式替换策略、失败传播和运行数据；
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
- [Architecture](architecture.md) —— Layer 边界、规划实体、调度、指纹与数据形状。
- [Lifecycle](lifecycle.md) —— fresh、组内复用、停止与替换的完整时序。
- [Use Cases](use-case/README.md) —— MemoryBench、Terminal-Bench 与 NiceEval-Eval 的完整写法。

Git repository 复用的选型依据见[复用 Sandbox 内切换 Git commit](../../design/git-repository-reuse/README.md)。
