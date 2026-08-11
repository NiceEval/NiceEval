# Eval Group

Eval Group 把一组已经定义的 Eval 绑定到同一台物理 Docker Sandbox。
它只表达封闭归属和可用性策略，不表达业务排序、前缀完成条件或跨组资源运行时。

```ts
import { defineEvalGroup } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";

export default defineEvalGroup({
  evals: [checkout, migration, verification],
  sandbox: dockerSandbox({ context: new URL("./sandbox/", import.meta.url) }),
  onUnavailable: "stop-group",
});
```

`evals` 是非空、去重的闭集。它的数组位置没有公开业务含义。
发现阶段把成员规范化为 Eval ID 后排序；同一 Group 内按该稳定 ID 顺序串行派发。
不同 Group 可以并行，未来若需要业务排序，必须增加单独的显式契约。

## 公共形状

```ts
interface EvalGroupInput {
  readonly evals: readonly [EvalGroupMember, ...EvalGroupMember[]];
  readonly sandbox?: SandboxLayer;
  readonly plugins?: readonly PluginInstance<"group">[];
  readonly onUnavailable: "stop-group" | "replace-sandbox";
}
```

每一项必须是 `defineEval()` 或 `defineScoreEval()` 的原始 definition。
同一 Eval 只能归属一个 Group，不能在同一 Group 重复出现。
Group 不公开 `index`、`sequence` 或成员位置；过滤和结果携带只决定哪些 slot 实际进入本次运行。

## 物理生命周期

Group 的 Sandbox 在第一条真实 Attempt 前取得，并由整组的物理生命周期拥有：

```text
provider acquire
  -> sandbox layer setup
  -> selected resource materialize
  -> reset anchor
  -> each real Attempt: reset -> resource prepare -> commands -> agent -> cleanup
  -> resource release (reverse order)
  -> sandbox teardown
  -> provider finalizer
```

全量 carry 不建立 Sandbox，也不 materialize Plugin resource。
部分 carry 仍在 carry 规划前冻结完整 selected resource envelope；只有真实 Attempt 调用该 Attempt 的 resource `prepare`。

`onUnavailable` 只处理物理 Sandbox 的 create、reset 与 Plugin resource prepare 失败：

- `stop-group`：已开始的 Attempt 如实结束为 errored；后续未开始 slot 早退且不伪造结果。
- `replace-sandbox`：失败 lease 退休，下一条 slot 才建立替代实例；同一阶段再次失败后停止该 Group。

重置在上一条 Attempt 结束后失败不会改写上一条结果。Run 保留不完整诊断并以非零状态结束；其他 Group 不受影响。

## 身份与发现

Group fingerprint 包含规范化 Eval ID 集、`onUnavailable`、Sandbox Layer、Group Plugin occurrence 和 Group 源码闭包。
重排 inline `evals` 不改变 fingerprint；增删成员、改变可执行 Group source 或修改 Plugin/resource 行为会改变它。

`freshImport: true` 为一次 discovery 建立一张 namespaced 模块图。共享模块只求值一次。
Group 导入的 definition 与 Eval entry 的 definition 保持对象 identity。共享模块登记的 loader 输入归属到每个静态导入它的 entry。

不同 Group 的调度波次可以并行。组内只有规范化 Eval ID 的稳定串行派发。

## 范围

Group Plugin 只贡献 identity 和 requirements。
Eval Plugin 的 resource 归物理 Sandbox 所有；它不是 Group Plugin runtime resource。
Group 不提供私有 Eval before/after、Group runtime/resource、业务 sequence、complete-prefix 或 Docker template 所有权。
