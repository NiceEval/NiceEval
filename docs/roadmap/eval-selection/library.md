# Eval 选择 —— Library

Experiment 使用声明式对象确定自己的静态 Eval 范围。
省略 `evals` 表示选择全部发现出的 Eval；显式提供时，类型要求至少有一项有效条件。

## 公开形状

```ts
type NonEmptyStrings = readonly [string, ...string[]];

type EvalTagSelectionInput =
  | {
      readonly allOf: NonEmptyStrings;
      readonly noneOf?: NonEmptyStrings;
    }
  | {
      readonly allOf?: NonEmptyStrings;
      readonly noneOf: NonEmptyStrings;
    };

interface EvalSelectionFields {
  readonly ids?: NonEmptyStrings;
  readonly idPrefixes?: NonEmptyStrings;
  readonly tags?: EvalTagSelectionInput;
}

type EvalSelectionInput =
  | (EvalSelectionFields & { readonly ids: NonEmptyStrings })
  | (EvalSelectionFields & { readonly idPrefixes: NonEmptyStrings })
  | (EvalSelectionFields & { readonly tags: EvalTagSelectionInput });

interface ExperimentInput {
  readonly evals?: EvalSelectionInput;
  // 其它 Experiment 字段保持各自契约。
}
```

`EvalSelectionInput` 不接受空对象，`tags` 也不接受空对象。
每个字符串必须非空，匹配区分大小写且不会自动 trim；重复值规范化为一项，不报错。

`ids` 精确匹配完整 Eval ID。
`idPrefixes` 使用原始 `startsWith` 语义；`algebra` 会匹配 `algebra`、`algebra2` 与 `algebra/linear`。
需要只选 `algebra` 时使用 `ids`。

`ids` 与 `idPrefixes` 属于同一身份轴，二者之间是 OR。
身份轴与 tag 轴之间是 AND：结果必须携带 `allOf` 的每个 tag，并且不能携带 `noneOf` 的任何 tag。
`allOf` 与 `noneOf` 不能包含同一个 tag。

```ts
export default defineExperiment({
  agent: codexAgent(),
  evals: {
    idPrefixes: ["coding/"],
    tags: {
      allOf: ["coding"],
      noneOf: ["gpu"],
    },
  },
});
```

精确选择少量 Eval 时只写 `ids`：

```ts
export default defineExperiment({
  agent: codexAgent(),
  evals: { ids: ["algebra", "geometry/triangle"] },
});
```

## 条件边界

选择词表只包含精确 ID、ID 前缀、`tags.allOf` 与 `tags.noneOf`。
`"*"`、字符串数组、predicate、`tags.anyOf`、description、metadata 与题型都不是合法输入。
JavaScript、动态导入或类型断言绕过类型时，`defineExperiment()` 在加载阶段用同一规则拒绝非法形状和未知字段。

模块代码可以动态构造声明式对象。
因此保证是：模块加载完成后，给定相同发现结果与输入值，选择结果确定且可逐条件诊断；契约不声称阻止模块读取进程变量集合或时间。

## Eval Group 是成员关系

Eval Group 使用 `members`，不使用 `EvalSelectionInput`：

```ts
export default defineEvalGroup({
  members: [entryStats, entryBill],
  sandbox: sandboxLayer().setup(installRustToolchain),
});
```

```ts
type EvalGroupMember = AnyEvalDefinition;

interface EvalGroupInput<Sandbox extends SandboxLayer | undefined> {
  readonly members: readonly [EvalGroupMember, ...EvalGroupMember[]];
  readonly sandbox?: Sandbox;
}
```

每个成员必须是 `defineEval()` 或 `defineScoreEval()` 返回的真实 definition，并且必须恰好对应一条发现后的 Eval。
数组或 keyed record 测试集不能作为一个成员自动展开；作者逐项引用其中的 definition，仍须保证每项只对应一个 ID。

同一 definition 若对应多个生成后的 ID，Group 发现阶段因身份查找不唯一而报错。
一条 Eval 最多属于一个 Group，同一 Group 不能重复引用成员。

## 配置错误

以下错误都在资源动作之前报告，并点名 Experiment、字段和值：

| 条件 | 结果 |
|---|---|
| `ids` 某项不存在 | 配置错误，即使其它 ID 命中 |
| `idPrefixes` 某项零命中 | 配置错误，即使其它前缀命中 |
| `allOf` 某个 tag 未出现在身份候选中 | 配置错误 |
| `noneOf` 某个 tag 未出现在应用正 tag 后的候选中 | 配置错误 |
| 各原子存在，但组合结果为空 | 配置错误 |
| `allOf` 与 `noneOf` 含同一 tag | 加载阶段配置错误 |
| 空字符串、空数组、空对象或未知字段 | 加载阶段配置错误 |

多个负 tag 可以排除同一条 Eval，不要求每个负 tag 都产生独立的边际变化。
负 tag 必须在自己的候选域里出现，这项严格校验意味着作者不能预先声明尚不存在的排除 tag。
