---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 配置 Sandbox 准备命令

同一批 Eval 共享、但会随 Experiment 改变的沙箱内准备，写在 Experiment `sandbox` layer 的 `prepare()` 命令里。
典型用途是安装实验专用二进制、写协议配置或预热服务。

prepare 是 Agent 前的统一 Sandbox preparation。typed inputs 推导 sandbox 或 attempt scope；每个 occurrence 在变更分类账标记之前得到满足。缓存 hit restore verified state，miss 或 unsupported 才执行命令，因此都不属于 Agent 对任务的修改。
昂贵动作由命令做真实检查，命中后快速返回。
收尾在取得资源后经 `context.onCleanup()` 登记，按全局准备顺序逆序执行。

跨 Attempt 的实际 Sandbox 目录、服务或快照归 layer 的 `setup()` / `teardown()`：创建后恢复、退休前回存；新的 run 也从同一条 `setup()` 边界恢复。需要唯一连续实例时声明 `sandboxReuse: true`，需要固定顺序时再设为串行，选择方式见[并发用例](../并发/)。
安装与检查 Agent CLI 由 Adapter 的 Agent layer 承担，连 Agent 与鉴权属于 `SandboxAgent.setup`，都不放在这里。
命令的声明形状与执行顺序见 [Sandbox Layer](../../../sandbox/layers.md)。

在执行前要核对同一组准备命令会怎样包裹某个 Eval 时，使用只读的 `debug`，而不是运行或 `--dry`：

```sh
niceeval debug compare/codex memory/commit0
niceeval debug compare/codex memory/commit0 --json
```

它把 Experiment、lane、slot 和每条可检查 action 按实际计划顺序逐框显示；Shell 保留多行和末尾换行，不能检查的 callback 标为 `opaque`。它不创建 Invocation、Run、Sandbox 或 cache lookup。完整的 command-plan 排版见 [debug 输出案例](../../output/debug-command-plan.md)。

两个 selector 都必须唯一，且 Eval 只能在该 Experiment 已选范围内匹配。无法唯一匹配时在 physical planning 前非零结束，列出排序后的精确候选；同样没有 Invocation 或 receipt：

```text
error: Experiment selector is ambiguous: compare
candidates: compare/codex, compare/claude

error: No eval matched in compare/codex: no-such-eval
```
