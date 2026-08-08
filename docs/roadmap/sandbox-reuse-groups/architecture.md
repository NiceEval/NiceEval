# 分组 Sandbox 复用 —— Architecture

契约总纲见 [README](README.md)，公开配置见 [Library](library.md)。

## Sandbox Layer 与复用组

Sandbox Group Definition 不提供 template、Provider 或 prepare 命令。
组成员的 Eval Layer 只能省略，或是没有实例 hook 的 command-only prepare Layer；Experiment 必须提供 template-bearing Layer，并成为唯一 lifecycle owner。

每个 Eval × Experiment pair 仍按 [Sandbox Layer](../../feature/sandbox/layers.md)完成普通 link。
Experiment 作为 template owner 先 prepare，当前 Eval 的 command-only prepare 随后重新执行；现有两层顺序不变。

link 完成后，physical planning 产生既有复用身份：

```text
(Provider physical plan identity, Agent ensure identity, lifecycle owner marker)
```

Provider physical plan 与 lifecycle owner 都来自同一个 Experiment，Agent ensure identity 也在 Experiment 内恒定。
Eval 只能贡献不进入物理复用键的 Attempt prepare，因此正常类型路径在结构上已经保证组内身份一致。

Runner 仍逐项比较最终 identity。
自定义 Provider 或动态 JavaScript 绕过结构约束后若产生差异，报 `sandbox-reuse-group-incompatible`，不猜测也不拆组。

组 id 进入运行时复用键。
两个组即使读取出完全相同的物理身份，也必须创建各自的 Sandbox，不能跨组借用。
运行时所有权是 `(invocationId, experimentId, groupId)`；另一个 Experiment 或 Invocation 使用同一组定义时，创建自己的独立实例。

## 发现实体与规划实体

```ts
interface DiscoveredSandboxGroup {
  readonly id: string;
  readonly definitionHash: string;
  readonly evalIds: readonly string[];
  readonly onUnavailable: "stop-group" | "replace-sandbox";
}

type SandboxAssignment =
  | { readonly kind: "fresh" }
  | {
      readonly kind: "group";
      readonly groupId: string;
      readonly onUnavailable: "stop-group" | "replace-sandbox";
    };
```

assignment 只由发现结果与当前 Eval id 确定，不读取 Experiment 配置、回调、运行时抢占顺序或 Sandbox id。

## 编译期与发现期

`defineEval()` 输出保留 `none`、`prepare-only` 或 `instance` Sandbox 所有权。
`defineSandboxGroup()` 的 tuple 只接受前两种，普通 TypeScript 项目在加载 NiceEval 前就能指出具体不合法成员。

发现顺序固定为 Eval 在前、Sandbox Group 在后。
组模块导入的 definition 必须按对象身份恰好命中一条已发现 Eval；Runner 随后读取 Layer 私有状态复核 template 与 hook，不能把类型断言当成权限。

## 调度

本次选择命中组成员时，Runner 为该组建立一个互斥队列和至多一台活跃 Sandbox：

1. 组内下一条工作取得全局与 Experiment 并发位；
2. 首条工作创建 Sandbox，后续工作领取同一活跃实例；
3. Runner reset workdir，并重新执行两层 prepare 与 agent.ensure；
4. Attempt 封口和 cleanup 完成后，实例回到该组；
5. 组结束后执行 lifecycle teardown，再按 physical release policy 停驻或销毁。

公平调度仍使用全局调度波次。
一个组不能因为持有 Sandbox 就连续抢占全部并发位；其它组、其它 Experiment 与 fresh Attempt 仍有机会运行。

## 指纹与结果携带

`definitionHash` 哈希组 id、按 Eval id 排序的完整成员集合与 `onUnavailable`。
组上下文进入每个成员 pair 的指纹；组成员或策略变化会让这些结果重新判定携带资格。

未分组 pair 不包含任何组定义，因此无关组变化不会作废它的结果。
所有 assignment 仍逐 Attempt 判断结果携带；被携带的 Attempt 不领取 Sandbox，也不执行 lifecycle、reset 或 prepare。

Sequence 上下文仍按[有序 Eval 序列](../ordered-sequences/architecture.md)进入 Attempt 指纹。
复用组不建立第二套 lineage、完整前缀或重新执行规则。

## 实例不可用

Sandbox 在以下任一条件下不可继续：reset 失败、派发前寿命无法保证、实例中途消失，或收尾后无法证明命令树已经终止。

- `stop-group`：中止该组尚未派发的工作，Run 记为 incomplete；其它组和 fresh Attempt 继续。
- `replace-sandbox`：完成旧实例可执行的 teardown 与 physical release，再创建新实例继续尚未派发的工作。

两条路径都登记原始失败阶段和 Provider 原文。
`replace-sandbox` 登记替换，但不把新实例描述成连续状态。

## 数据形状

Run 保存实际选中的组定义，Attempt 保存 Sandbox 调度归属：

```ts
interface SandboxGroupRunInfo extends DiscoveredSandboxGroup {
  readonly selectedEvalIds: readonly string[];
}

interface AttemptSandboxReuseInfo {
  readonly reused: boolean;
  readonly groupId?: string;
  readonly sandboxNumber: number;
  readonly assignment: number;
}
```

fresh Attempt 省略 `groupId`，并使用自己的 `sandboxNumber`。
组内 `sandboxNumber` 在替换时递增，`assignment` 是该实例承接 Attempt 的从一开始序号。

`--dry` 对每条计划显示 `fresh` 或 `group:<groupId>`，并在组摘要中显示 `onUnavailable`。
运行级 created、active、assignments 与 replacements 按 Experiment × group 聚合，计数口径沿用[复用反馈](../reuse-feedback/README.md)。

## 错误阶段

| code | 阶段与条件 |
|---|---|
| `sandbox-group-member-unresolved` | 发现期：definition 没有恰好对应一条已发现 Eval |
| `sandbox-group-member-overlap` | 发现期：一条 Eval 被重复引用或属于多个组 |
| `sandbox-group-member-layer` | 发现期：成员拥有 template 或 instance lifecycle hook |
| `sandbox-reuse-group-direct-agent` | 计划期：配对 Experiment 使用 Direct Agent，没有可复用 Sandbox |
| `sandbox-reuse-group-template-missing` | 计划期：Sandbox Agent Experiment 没有提供 template-bearing Layer |
| `sandbox-reuse-group-incompatible` | 计划期：组中本次选中成员的 Layer link 或物理复用身份不同 |

错误消息必须列出 group id、相关 Eval id 与修正方向。
配置错误不降级成 fresh，也不自动拆组。
