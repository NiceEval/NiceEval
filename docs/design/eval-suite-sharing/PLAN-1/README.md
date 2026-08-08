# PLAN-1：复制 Eval 目录到消费项目

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 形状

发布方把一棵 `evals/` 放在 Git 仓库或压缩包里。
消费方把需要的目录、Eval 依赖模块与资产复制进自己的 `evals/`，然后像本地题一样运行。

```text
upstream/evals/terminal-bench/hello-world/
  ↓ copy
consumer/evals/terminal-bench/hello-world/
```

Experiment 与 Agent 都由消费项目自己维护。

## 优点

- 不增加 NiceEval API，也不改变发现器。
- 复制后的题完全可见，消费方可以直接修改。
- 本地源码捕获、泄漏检查与逐 Eval 指纹自然生效。
- 离线运行不依赖额外 cache 或 registry。

## 代价

- 一次使用 238 条 Terminal-Bench Eval 就产生 238 份新所有权。
- 上游修一条判据或 Sandbox 时，消费方必须人工找出差异并重新应用。
- 本地修改与上游更新混在同一目录，无法可靠区分 fork 与漏同步。
- 上游版本只能写在 README 或 commit message，运行数据没有统一的上游出处事实。
- 多个项目各自复制后，同名题很快出现不相等的内容。

## 对固定 Case 的结果

PLAN-1 能满足 S2、S4 与 S7 的运行结果，但不满足 S1 的零复制目标。
S3 的 commit 只固定复制动作后的项目，不能证明它对应上游仓库哪个完整 commit。

S6 具备逐 Eval 精确失效，却没有可重复的升级动作。
S8 由现有重复 id 检查守护；S9 只能等复制后的发现或运行暴露。

## 裁决

这个方案适合明确接管一两条题，不适合把另一项目维护的完整 Eval 集合当依赖使用。
它把“复用”变成 fork，并把后续同步成本交给每个消费项目。
