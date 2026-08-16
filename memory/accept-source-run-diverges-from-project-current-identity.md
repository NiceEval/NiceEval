---
name: accept-source-run-diverges-from-project-current-identity
description: accept 用 link 前的 source Experiment 重算当前身份，带 Plugin 的 accepted Run 能被 explicit --run 读到，却立即被无参 project-current 排除
metadata:
  type: project
---

# `accept` 用 source Run 重算身份，刚采用的 Run 不属于 project-current

## 现象

`niceeval accept @<locator>` 成功并返回新的 Run ID；`niceeval show --run <id>` 也能证明新 Run 通过 reference Member 指向原 Attempt。但紧接着运行无参 `niceeval show`，accepted Run 不在 `selectedRunIds`，分母是 0；`niceeval exp <experiment> --dry` 同时仍报告 `identity-mismatch`。

这里有两个必须同时成立、但不能混为一谈的产品语义：

- 无参 `show`：accepted Run 使用当前目标身份，创建后应立即进入 `project-current`。
- 下一次 `exp --dry`：`accepted` 只解释这个 Run 当时为何采用旧 Attempt，不授予未来自动 carry；reuse policy 仍可把它判为 gap。

旧 Journey 只在 accept 后调用 `show --run <acceptedRunId>`。`explicit-runs` 不做 project-current 身份收窄，所以错误实现也会通过。

## 根因

Plugin link 会把作者定义的 source `AgentRun` 变成包含 `pluginBehavior` 与组合 lifecycle 的 effective `pair.run`。正常 `show` / `exp --dry` 的 current planning 在 `planProjectTarget` 中始终用 `pair.run` 计算 config identity。

`prepareCurrentAdoptionTarget` 却复制了一套 identity / fingerprint 计算，并把 link 前的 `run` 传给 `configIdentityForRun`。于是同一个 Eval 有两份“当前身份”：

```text
show / exp --dry -> prepared pair -> effective pair.run -> current identity
accept           -> prepared pair -> source run          -> adopted identity
```

Direct、无 Plugin 的简单 fixture 中 `run` 与 `pair.run` 的身份投影相同，问题不会显现；带 experiment Plugin 的真实 Runner fixture 和 MemoryBench mempal 会稳定暴露分叉。

## 修法

不在 project-current 对 `accepted` 做特判，也不只在重复计算处改一个实参。`src/runner/fingerprint.ts` 暴露内部 `planPreparedProjectTarget()`：它对已经完成 link 与 physical planning 的 pairs 一次性冻结 config identity、fingerprint 与 manifest。`planProjectTarget()` 和 `prepareCurrentAdoptionTarget()` 共同消费这条 seam，因此 accept 不再拥有第二套当前身份算法。

既有 `e2e/runner/test/accept-reanchor.test.ts` 在 explicit `show --run` 之后增加无参 `show --json`，断言：

- policy 是 `project-current`；
- `selectedRunIds` 只有刚创建的 accepted Run；
- `runCount`、`slotCount`、`denominator` 都是 1；
- 随后的 `exp --dry` 仍为 gap。

fixture 已有稳定 experiment Plugin，足以区分 source Run 与 effective Run，不需要复制 MemoryBench，也不需要新增 E2E owner。

## TDD 收据

同一测试改动、同一命令：

```sh
pnpm e2e --repo runner -- --run test/accept-reanchor.test.ts
```

- 最小逆补丁恢复旧算法后，candidate `sha256:4575468c925323307f5c8bf31833a02cd6107a84178c4c7e4ac3582898b39703` 红灯：explicit read 已通过，但无参 `show` 实际返回 `selectedRunIds: []`、`runCount: 0`、`slotCount: 0`、`denominator: 0`；artifact root `/tmp/niceeval-e2e-artifacts-w0P9F3`。
- 共享 prepared planning 后，candidate `sha256:ea1ac529f284a3acc2b6943140877d1317ab262dc2fa66085c3e3875e7118cac` 绿灯：1 file / 1 test passed；artifact root `/tmp/niceeval-e2e-artifacts-cWPqTt`。
- 同一 final candidate 的 owner takeover 全通过：三个隔离副本、同一安装副本连续两次、Runner 默认并行 3/3、文件与标题单项 1/1，六份 receipt 均为 `cleanupOk: true`；summary `/tmp/niceeval-e2e-takeover-artifacts-tdzEJf/takeover-summary.json`。
- MemoryBench 公开 CLI 实验也确认修正：无参 `show` 从 108/144 变为 144/144，mempal accepted Run 被选中，pass rate 为 32/36；没有读取 `.niceeval` 私有文件。

## 适用场景

任何身份字段在 Plugin、Sandbox、Eval Group 或其它 planning 阶段组合后发生变化时，都必须从 shared prepared plan 取得结果，不能让 accept、rename、show、dry 分别重算。只测 explicit selector 只能证明 durable 对象存在，不能证明默认 selection policy 能找到它。

这与 [accept-drops-eval-level-judge-from-fingerprint](accept-drops-eval-level-judge-from-fingerprint.md) 是同类缺陷：多个入口分别重算“当前身份”，一个入口遗漏了组合后的输入。前一条修正 judge 解析链；本条进一步把 prepared identity planning 收敛成单一实现。
