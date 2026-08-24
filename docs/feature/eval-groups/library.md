# Eval Group —— Library

`defineEvalGroup()` 从 `niceeval` 根入口导出。Sandbox 工厂与命令从 `niceeval/sandbox` 导入。

```ts
interface EvalGroupInput<Sandbox extends SandboxLayer | undefined = SandboxLayer | undefined> {
  readonly evals: readonly [EvalGroupMember, ...EvalGroupMember[]];
  readonly sandbox?: Sandbox;
  readonly plugins?: readonly PluginInstance<"group">[];
  readonly onUnavailable: "stop-group" | "replace-sandbox";
}

declare function defineEvalGroup<const Sandbox extends SandboxLayer | undefined>(
  input: EvalGroupInput<Sandbox>,
): EvalGroupDefinition;
```

`evals` 必须非空，成员必须是 `defineEval()` 或 `defineScoreEval()` 返回的原始 definition。
字符串 ID、selector、tag、glob 与复制出来的对象都不是成员。成员最多归属一个 Group，
同一 Group 也不能重复列出同一成员。

## 成员 type-state

合法成员的 Sandbox 类型只允许两种状态：省略，或 command-only 且 prepare-only。

```ts
type EvalGroupMemberSandbox =
  | SandboxLayer<"command-only", "prepare-only">
  | undefined;
```

`sandboxLayer().prepare(...)` 保留 prepare-only 状态。任何 template-bearing Layer，或调用过
`.setup()` / `.teardown()` 的 Layer，都会在 `defineEvalGroup()` 调用处产生 TypeScript 错误。
discovery 仍复核运行时品牌与实际 Layer 状态，拦住 JavaScript、宽泛断言和动态加载越界。

## `onUnavailable`

策略必须显式填写，没有默认值：

| 值 | 行为 |
|---|---|
| `stop-group` | 当前物理失败如实结束，停止该 Group 后续未开始 slot |
| `replace-sandbox` | 退休失败实例，下一条 slot 建立一次替代实例；同阶段再次失败后停止 Group |

该策略只处理 Sandbox create、reset 与 Sandbox Plugin setup 的不可用失败。
Eval 断言失败、Agent 失败和普通业务结果不触发替换。

## Sandbox 与 Plugin

Group 的 `sandbox` 可以提供 template、逐物理实例生命周期和逐 Attempt 命令。
Experiment 与 Group 之间仍遵守唯一 template owner。Group Plugin 提供 lane lifecycle；
若同一 occurrence 声明 `sandbox` fragment，runner 自动把它注入 Group 使用的每台物理实例，
但 Plugin 仍不能修改 template。

## 加载错误

| code | 含义 |
|---|---|
| `eval-group-member-unresolved` | 成员不是 discovery 得到的原始 Eval definition |
| `eval-group-member-overlap` | 成员重复，或同时归属多个 Group |
| `eval-group-member-layer` | 成员持有 template 或实例级 lifecycle |
| `eval-group-evaluation-kind-mixed` | 闭合成员集同时包含 Pass Eval 与 Score Eval |
| `eval-group-sandbox-reuse-conflict` | 同一 Experiment 同时使用 Group 与 `sandboxReuse` |
| `eval-group-direct-agent` | Group 被 Direct Agent 选中 |
| `eval-group-incompatible` | 成员无法归一到相同的物理 Sandbox 计划 |

完整运行时序见 [Lifecycle](lifecycle.md)。
