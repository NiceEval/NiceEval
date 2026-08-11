# Eval Group

Eval Group 把一组兼容的 Eval 绑定到同一条 capacity-one 复用 lane。组内真实派发的 Attempt
共享物理 Sandbox 并稳定串行；不同 Group 与未分组 Eval 仍可并发。它解决重型条件重复创建
的问题，不表达跨 Eval 数据依赖或业务顺序。

```ts
export default defineEvalGroup({
  evals: [checkout, migration, verification],
  onUnavailable: "stop-group",
});
```

`evals` 是闭合集合，数组位置没有公开业务含义。发现阶段取得规范化 Eval ID 后排序。
需要“先构建、后查询”时，把步骤写进同一条 Eval；未来的业务排序必须使用单独的显式契约。

## 核心边界

- Group 成员可以省略 Sandbox Layer，或只声明逐 Attempt 的 `prepare()` 命令。
- Sandbox template 与实例级 `setup()` / `teardown()` 由 Group 或 Experiment 持有。
- Group 与 `sandboxReuse: true` 不能同时作用于同一 Experiment。
- Group Plugin 只贡献 identity 与 requirements；Eval Plugin resource 由物理 Sandbox 持有。
- carry、过滤与首过即停只移除 slot，不会补跑其它成员或制造前缀完成语义。

## 正文入口

- [Library](library.md) —— `defineEvalGroup()`、成员 type-state 与错误边界。
- [CLI](cli.md) —— 选择、dry plan 与机器输出。
- [Architecture](architecture.md) —— 发现、身份、兼容性与调度模型。
- [Lifecycle](lifecycle.md) —— 物理 Sandbox、Plugin resource、Attempt 与失败策略的时序。
- [MemoryBench](use-case/memorybench.md) —— 用多个 Group 并行复用记忆条件与 Git seed。

## 范围

Group 不提供私有 Eval before/after、Group runtime resource、业务 sequence、complete-prefix，
也不把作者数组位置解释成依赖。Group 只拥有封闭成员关系、capacity-one lane、物理复用边界
和 Sandbox 不可用时的处理策略。
