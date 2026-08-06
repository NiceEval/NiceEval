# MemoryBench：题组目录声明共用 Sandbox

契约单源始终在 [Library](../library.md) 与 [Architecture](../architecture.md)。
本例展示纵向记忆题怎样声明共用 Sandbox；执行顺序仍由 Sequence 声明。

## 组定义

```ts
// evals/toggl-cli-evolution/sandbox-group.ts
import { defineSandboxGroup } from "niceeval";

export default defineSandboxGroup({
  evals: [
    "./01-capacity-policy",
    "./02-capacity-weekly",
    "./03-capacity-policy-update",
    "./04-capacity-monthly",
    "./05-capacity-fixed-exception",
    "./06-capacity-projects",
    "./07-capacity-exception-revoked",
    "./08-capacity-quarterly",
  ],
  onUnavailable: "stop-group",
});
```

组定义与题目共址，所有 Agent/model Experiment 使用同一成员边界。
需要连续实例的记忆 Experiment 只启用这个 id，不复制八个成员：

```ts
export default defineExperiment({
  evals: ["toggl-cli-evolution/", "react-hook-form/"],
  sandboxReuse: {
    groups: ["toggl-cli-evolution"],
  },
  // memory agent、model、sandbox layer 等保持原样
});
```

baseline Experiment 省略 `sandboxReuse`。
因此相同八道题在 baseline 中仍各用 fresh Sandbox 并行，不会因组文件与题目共址而被迫复用。

## 运行

启用该组的普通混合批次里，八个组成员轮流使用一台 Sandbox。
其它 PR 修复题未被任何组引用，因此使用 fresh Sandbox，并可与组内当前 Attempt 并行。

组定义不把文件名数字升级为执行契约。
正式纵向测量仍使用 [`defineSequence()`](../../ordered-sequences/library.md)列出八步，并通过 `--sequence` 取得完整前缀与 lineage。

远程记忆库或宿主 checkpoint 不由 Sandbox 组自动隔离。
实验必须使用稳定且独立的 cohort，并在跨 Invocation 共享该 cohort 时声明 `sharedState.key`。

Sequence 保证步骤全部真实执行，`stop-group` 保证实例失效后不拿空白环境接续。
两者都不证明第三方记忆库已经恢复到干净起点。
