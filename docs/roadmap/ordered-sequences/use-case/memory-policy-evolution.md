# 让一组记忆演化题拥有可验证执行历史

## 问题

MemoryBench 用八道 coding Eval 模拟同一用户的规则演化。
每道题都从相同代码起点开始，前序交互只通过被测 memory 条件延续：先建立 30 分钟规则，再改成 20 分钟，随后增加并撤销一个局部例外。

Eval 本身已经有稳定业务身份，不需要为了序号改名：

```text
evals/toggl-cli-evolution/
  capacity-policy/eval.ts
  capacity-weekly/eval.ts
  capacity-policy-update/eval.ts
  capacity-monthly/eval.ts
  capacity-fixed-exception/eval.ts
  capacity-projects/eval.ts
  capacity-exception-revoked/eval.ts
  capacity-quarterly/eval.ts
```

文件路径继续回答“这道 Eval 是谁”。
Sequence 文件单独回答“这次按什么历史运行这些 Eval”：

```ts
// sequences/toggl-cli-capacity-policy.sequence.ts
import { defineSequence } from "niceeval";

export default defineSequence({
  evals: [
    "toggl-cli-evolution/capacity-policy",
    "toggl-cli-evolution/capacity-weekly",
    "toggl-cli-evolution/capacity-policy-update",
    "toggl-cli-evolution/capacity-monthly",
    "toggl-cli-evolution/capacity-fixed-exception",
    "toggl-cli-evolution/capacity-projects",
    "toggl-cli-evolution/capacity-exception-revoked",
    "toggl-cli-evolution/capacity-quarterly",
  ],
});
```

这份声明没有 `role`。
哪些题是学习、更新、撤销或 checkpoint 属于 MemoryBench 的报告口径，不改变 Runner 怎样建立有效历史。

## 给不同条件复用同一 Sequence

无 memory baseline 和 memory 变体继续使用各自的 Experiment：

```ts
// experiments/compare/codex-baseline.ts
export default defineExperiment({
  agent: codexAgent(),
  evals: ["toggl-cli-evolution/"],
  flags: { memory: "baseline" },
  sandbox: e2bSandbox({ template: baseTemplate }),
});
```

```ts
// experiments/compare/codex-mempal.ts
export default defineExperiment({
  agent: codexAgent({ skills: [mempalSkill] }),
  evals: ["toggl-cli-evolution/"],
  flags: { memory: "mempal", cohort: "capacity-policy-2026-08-a" },
  sharedState: { key: "mempal/codex/capacity-policy-2026-08-a" },
  sandbox: e2bSandbox({ template: mempalTemplate })
    .setup(restoreKnownCohort)
    .teardown(saveCommittedCohort),
});
```

Sandbox 共用要求由 `evals/toggl-cli-evolution/sandbox-group.ts` 一次声明，对选择这些成员的 Experiment 直接生效。
完整成员写法见[分组 Sandbox 复用的 MemoryBench 用例](../../sandbox-reuse-groups/use-case/MemoryBench.md)。

Sequence 不要求两边使用相同状态实现。
它只保证两边收到相同的有序任务历史；复用组让每个 Experiment 的八步使用各自的一台活跃实例。
baseline 与 mempal 不共享实例，memory 状态仍由 Agent 与 lifecycle 决定。

## 预览并运行

```sh
pnpm --silent exec niceeval exp compare/codex-mempal \
  --sequence toggl-cli-capacity-policy \
  --dry
```

计划列出八步、固定串行、完整重放和 `sharedState` key。
它不会把 key 名里含有 cohort 就解释成干净状态；`restoreKnownCohort` 是否真的恢复约定 revision 仍由作者负责。
同一正式条件再次运行时要分配新的 cohort，或让 lifecycle 恢复同一份固定起点；不能在上次的最终状态上再次重放。

确认起点后运行同一命令，去掉 `--dry`：

```sh
pnpm --silent exec niceeval exp compare/codex-mempal \
  --sequence toggl-cli-capacity-policy
```

如果只需要运行到最后一个验证题，仍使用 `--through` 从头执行：

```sh
pnpm --silent exec niceeval exp compare/codex-mempal \
  --sequence toggl-cli-capacity-policy \
  --through toggl-cli-evolution/capacity-quarterly
```

这里目标正好是最后一步，所以与完整 Sequence 相同。
把目标改成 `capacity-monthly` 时只运行前四步，但不会只派发第四步。

## 下游报告仍拥有业务解释

MemoryBench 可以继续用 Eval metadata 标记自己的读数：

```ts
metadata: {
  checkpoint: true,
  memoryOperation: "forgetting",
}
```

报告从 Attempt 的 `sequence.id`、`sequence.index` 和 Eval metadata 产生 checkpoint trajectory。
Sequence lineage 证明这些结果来自同一条完整前缀；metadata 只决定报告怎样分组，不参与调度。

失败归因仍需结构化 Assertion 或运行事实。
`memoryOperation: "forgetting"` 只能说明这道题想测撤销后的行为，不能自动证明失败就是旧记忆复活。
