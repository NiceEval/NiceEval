# 实验加速

这项设计先区分真实场景，再讨论提速方案。

## 现实场景先决定需要什么能力

| 场景 | 为什么 | 需要的能力 | 真实例子 |
|---|---|---|---|
| 共享状态必须成对恢复和回存 | 两条 Invocation 的 Sandbox 交错恢复与回存会覆盖同一份状态 | 用 `sharedState.key` 独占完整状态窗口 | MemoryBench `codex-2.0-flash--mempal.ts` |
| 累积记忆要求 Eval 顺序确定 | 并发写入会改变后续 Eval 看到的历史 | 整个 Experiment 串行 | MemoryBench `claude-2.0-flash--nowledge.ts` |
| 共享服务允许并发读写 | 服务自身处理冲突，实验接受并发写入顺序 | 保留 Experiment 已声明的并行 | MemoryBench `codex-2.0-flash--nowledge.ts` |
| Attempt 相互独立 | 只有 Provider 与本机容量限制同时执行数 | 使用有界并发，不应为了复用 Sandbox 强制串行 | NiceEval-Eval 的安装实验 |
| 多条 Attempt 重复相同的动态安装 | 当前 lockfile 或实验配置决定依赖，不适合为每次变化重建 template | 用 Sandbox 复用按实际 Sandbox 数分摊 SandboxSpec `setup` | `pnpm install`、clone 与冷构建 |
| 批次长于一个 Sandbox 能保证的存活时间 | Sandbox 可能在 Agent 执行中途停止 | 派发前确认下一条 Attempt 能跑完，不能确认时停止或更换 Sandbox | 云 Sandbox 长批次 |

因此，“只复用一个 Sandbox”是 Sandbox 复用的一种运行方式，不是所有实验的默认答案。
Runner 仍须服从本 Invocation 的 Experiment `maxConcurrency`；Sandbox 复用不能把必须串行的队列改成并行。
多个 Invocation 指向同一 checkpoint 时，另由 `sharedState.key` 保护跨 Sandbox 复用池的 restore/run/save 窗口。

## 真实耗时限制了方案收益

从 `/Users/ctrdh/Code/MemoryBench` 与 `/Users/ctrdh/Code/NiceEval-Eval` 的 `.niceeval/**/result.json` 读取 1,266 个文件。
按仓库与 Attempt locator 去重后得到 480 条 Attempt：MemoryBench 467 条，NiceEval-Eval 13 条。

| 仓库与范围 | Agent 执行 | `eval.run` | `sandbox.create` | `sandbox.setup` | 评分 |
|---|---:|---:|---:|---:|---:|
| MemoryBench，467 条 | 71.7% | 93.3% | 0.6% | 1.3% | 0.2% |
| MemoryBench，230 条非 `errored` | 78.6% | 94.0% | 0.5% | 0.7% | 0.2% |
| NiceEval-Eval，13 条 | 68.8% | 92.7% | 0.5% | 0.1% | 5.8% |
| NiceEval-Eval，10 条非 `errored` | 87.6% | 90.5% | 0.6% | 0.1% | 7.7% |

两个仓库都不是主要卡在 Sandbox 创建。
把可以并行的 Attempt 改成逐条串行，很可能损失更多 Agent 执行的并行收益。

MemoryBench 的命令记录能直接识别 441 次 Node 包安装，共占全部 Attempt 总耗时的 8.2%；中位数为 4.8 秒，75 分位数为 18.9 秒，最长约 130 秒。
Rust build 或 fetch 占 4.2%，中位数为 82.2 秒。
这些工作多数发生在 `eval.run` 内，不会因为只复用 Sandbox 就自动变成一次。
跨项目稳定的依赖适合进入预制环境；由当前 checkout、lockfile 或实验配置决定的动态安装适合移到 SandboxSpec `setup`，再由 Sandbox 复用按实际 Sandbox 数分摊。

NiceEval-Eval 的时间树看不到 Agent CLI 内部执行的所有 shell 命令，不能算出其中 `pnpm install` 的准确占比。
因此，MemoryBench 的 8.2%不外推到该仓库。

MemoryBench 的 467 条 Attempt 中有 237 条 `errored`，177 条停在 `sandbox.setup`；这些主要是 Nowledge tunnel 或 server 探测 的连接错误，不是安装失败。
上表同时列出非 `errored` Attempt，避免早期失败压低 Agent 执行占比。

本目录重新评估如何缩短实验总耗时，并把原 [Sandbox 复用](../../feature/sandbox/reuse.md)设计放回候选方案比较。
最终选择是分层提速：默认运行先少跑、保留并行并使用预制环境。
能接受题间状态边界的 Experiment 用 `sandboxReuse: true` 声明本 Invocation 的 Attempt 共用 Sandbox，跨 Invocation checkpoint 另用 `sharedState.key` 协调。
完整边界见 [DECISION](DECISION.md)。

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [DECISION](DECISION.md)
