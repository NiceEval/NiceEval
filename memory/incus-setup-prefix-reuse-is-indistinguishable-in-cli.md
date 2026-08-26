---
format: niceeval.memory/v1
id: incus-setup-prefix-reuse-is-indistinguishable-in-cli
title: Incus SetupPrefix 复用在 CLI 中无法区分 pair
createdAt: 2026-08-26T21:21:34+08:00
kind:
  type: problem
  state: open
promotions:
  - kind: feature
    current:
      - docs/feature/experiments/cli.md#派发前-sandbox-准备
    history: []
---
# Incus SetupPrefix 复用在 CLI 中无法区分 pair

## 观察

NiceEval-Eval 从安装后候选执行 `pnpm exec niceeval exp harness`，Human dashboard 显示：

```text
preparing sandbox setup · niceeval-eval.prepare-inner-runtimes · action 1/5 · 1 attempt
```

同一个 Invocation 选中 4 个 Experiment config 与 3 个 Eval；既有 artifact inventory 对 `harness/v0.12.0` 与 `harness/canary` 的全部 lineage 都 exact hit，但 `harness/v0.9.0` 与 `harness/v0.13.3` 的当前 key 从未发布。这条 activity 没有 Experiment/Eval 身份，所以后一个 pair 的 `action 1/5` 看起来像整个 harness 忽略了前面的暖命中。

`niceeval debug` 又把 Incus Provider 的 `PreparedArtifact` setup-prefix capability 投影为 `unsupported`，让只读计划也无法确认该 pair 具有跨 Invocation 持久复用能力。

## 根因

Run activity 只携带 provider、action 计数和 Attempt 数，没有已在 `PreparationWork.plan.pair` 中存在的 exact `experimentId` / `evalId`。另一处静态 capability mapper 只识别 `Persistent`，漏掉了同样持久、但在 Attempt 派发前由 Provider 发布的 `PreparedArtifact`。

## 修复与验证边界

SetupPrefix activity 的 lookup、action、publish、hit 和 failed 标签都显示 exact `Experiment × Eval`。debug 把 `PreparedArtifact` 按其跨 Invocation 持久语义投影为 `persistent`，但仍保持 `lookup: not-probed`，不在只读 planning 中查 inventory。

本问题依赖真实 Incus Provider 与宿主 artifact inventory。普通 Docker E2E 无法区分 `PreparedArtifact` 错误分支，不新建复制核心缓存算法的 fake。Problem 保持 open，直到真实 Incus E2E owner 接管；本次用安装后 candidate 的 `niceeval debug` 与冷补齐/暖命中收据验收。
