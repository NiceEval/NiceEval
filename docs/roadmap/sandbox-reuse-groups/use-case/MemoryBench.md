# MemoryBench：题组目录声明共用 Sandbox

契约单源始终在 [Library](../library.md) 与 [Architecture](../architecture.md)。
本例展示纵向记忆题怎样声明共用 Sandbox；执行顺序仍由 Sequence 声明。

## 组定义

```ts
// evals/toggl-cli-evolution/sandbox-group.ts
import { defineSandboxGroup } from "niceeval";
import capacityPolicy from "./01-capacity-policy/eval.ts";
import capacityWeekly from "./02-capacity-weekly/eval.ts";
import capacityPolicyUpdate from "./03-capacity-policy-update/eval.ts";
import capacityMonthly from "./04-capacity-monthly/eval.ts";
import capacityFixedException from "./05-capacity-fixed-exception/eval.ts";
import capacityProjects from "./06-capacity-projects/eval.ts";
import capacityExceptionRevoked from "./07-capacity-exception-revoked/eval.ts";
import capacityQuarterly from "./08-capacity-quarterly/eval.ts";

export default defineSandboxGroup({
  evals: [
    capacityPolicy,
    capacityWeekly,
    capacityPolicyUpdate,
    capacityMonthly,
    capacityFixedException,
    capacityProjects,
    capacityExceptionRevoked,
    capacityQuarterly,
  ],
  onUnavailable: "stop-group",
});
```

八道 Eval 的 `evolutionSandbox()` 只调用 `sandboxLayer().prepare(...)`，所以输出类型是 `prepare-only`，可以加入组。
若其中一道改用 Dockerfile template 或增加 `setup()`，这份组文件立即出现 TypeScript 错误。

组定义与题目共址，并直接要求所有 Agent/model Experiment 对这八道题使用复用组。
每个 Experiment 各自创建组实例；baseline 与 mempal 不共享同一台 Sandbox，也不共享运行状态。

baseline 的 E2B template 与 mempal 的 template、checkpoint lifecycle 都继续由各自 Experiment 声明。
组内每道 Eval 的 Rust 安装与仓库准备仍作为第二层 prepare 逐 Attempt 重新执行。

baseline 没有 memory Agent、Skill 或外部状态，只是使用相同的物理复用边界。
如果 baseline 的测量契约要求这八道题逐题 fresh，就不能把共同 Eval 定义成强制复用组；Experiment 不能关闭 Eval 侧要求。

## 运行

普通混合批次里，八个组成员轮流使用本 Experiment 的一台 Sandbox。
其它 PR 修复题未被任何组引用，因此使用 fresh Sandbox，并可与组内当前 Attempt 并行。

组定义不把文件名数字升级为执行契约。
正式纵向测量仍使用 [`defineSequence()`](../../ordered-sequences/library.md)列出八步，并通过 `--sequence` 取得完整前缀与 lineage。

远程记忆库或宿主 checkpoint 不由 Sandbox 组自动隔离。
实验必须使用稳定且独立的 cohort，并在跨 Invocation 共享该 cohort 时声明 `sharedState.key`。

Sequence 保证步骤全部真实执行，`stop-group` 保证实例失效后不拿空白 Sandbox 接续。
两者都不证明第三方记忆库已经恢复到干净起点。
