# 具名 Experiment 族 —— Library

## 定义

```ts
import { defineExperiments } from "niceeval";

type ExperimentFamilyInput = Readonly<Record<string, ExperimentDefinitionInput>>;

declare function defineExperiments<const T extends ExperimentFamilyInput>(
  definitions: T,
): ExperimentFamilyDefinition<T>;
```

default export 必须是一个 `defineExperiment()` 结果，或一个 `defineExperiments()` 结果。
同一文件不能混合两个顶层定义形状，也不能从任意 object 猜它是不是 Experiment 族。

`definitions` 必须是只含 own enumerable string data property 的 plain record，prototype 只能是 `Object.prototype` 或 `null`。
array、class instance、symbol property 与 getter 都是定义错误；discovery 通过 property descriptor 检查 getter，不调用它。
Proxy 不受支持，JavaScript 也不提供可靠的 Proxy 检测；作者不能依赖 Proxy trap 参与 discovery 或 identity。

## Key 规则

key 必须匹配：

```text
[a-z0-9][a-z0-9._-]{0,127}
```

key 是一个 ID segment，因此不能包含 `/`、反斜杠、空白、`..` 或百分号编码的 separator。
空 record 与不符合上述语法的 key 是定义错误。
普通 JavaScript object 在进入 `defineExperiments()` 前已经合并重复 property，因此 API 不声称能诊断源码中被后值替换的同名 key。

最终 ID 是：

```text
<experiment-file-id>/<key>
```

文件 ID 继续由现有 discovery 路径规则产生。
key 不替换文件路径，也不允许成员手写完整 Experiment ID。
成员按 key 的 Unicode code point 升序进入 discovery 结果，不使用 object insertion order。

## 共享静态字段

普通 TypeScript 常量与 spread 是唯一共享机制：

```ts
const common = {
  evals: ["memory/"],
  attempts: 5,
  labels: { suite: "memory" },
} as const;

export default defineExperiments({
  baseline: {
    ...common,
    agent: codexAgent(),
    model: "gpt-5.6",
    labels: { ...common.labels, memory: "baseline" },
  },
  mempal: {
    ...common,
    agent: codexAgent(),
    model: "gpt-5.6",
    flags: { memory: "mempal" },
    labels: { ...common.labels, memory: "mempal" },
  },
});
```

`flags` 与 `labels` 仍遵守现有 owner 规则。
族 API 不做 deep merge，也不把第一个成员当 defaults。

## CLI 选择

```sh
niceeval exp list compare
niceeval exp compare
niceeval exp compare/baseline
niceeval exp compare/mem
```

精确成员 ID 优先于 prefix。
最后一条按现有文件名 segment prefix 规则选择 `compare/mempal`；不会跨另一个 family path 匹配。
