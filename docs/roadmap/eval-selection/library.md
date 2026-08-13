# Eval 选择 —— Library

Experiment 可用 `"*"`、ID 前缀、ID 数组或一个只读 Eval descriptor predicate 表示 `evals`。
加载阶段把它求值为稳定 ID 集；运行期不会再次调用 predicate。

```ts
export default defineExperiment({
  agent: codexAgent(),
  evals: ["coding/", "integration/"],
});
```

准确字段与 CLI 组合见 [Experiment Library](../../feature/experiments/library.md) 和 [CLI](cli.md)。

## Eval Group

```ts
export default defineEvalGroup({
  evals: [entryStats, entryBill],
  sandbox: sandboxLayer().setup(installToolchain),
  onUnavailable: "replace-sandbox",
});
```

```ts
interface EvalGroupInput {
  readonly evals: readonly [EvalGroupMember, ...EvalGroupMember[]];
  readonly sandbox?: SandboxLayer;
  readonly plugins?: readonly PluginInstance<"group">[];
  readonly onUnavailable: "stop-group" | "replace-sandbox";
}
```

每个 `evals` 项必须是一个真实 Eval definition，并且发现后只能对应一条 Eval ID。
同一 Eval 不得属于多个 Group，也不得重复列入同一 Group。
`evals` 表示集合，不提供成员 index、业务 sequence 或 complete-prefix。
