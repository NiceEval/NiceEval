# 云 Sandbox 的一批 Attempt 只准备一次

## 用户目标

我在 E2B、OpenSandbox 或 Instabox 上并发跑一批 Eval，它们共用同一段昂贵的 before 准备（checkout、安装依赖）。我希望第一次运行就只付一次准备的实例时长，而不是每个并发 Attempt 各装一遍；下一次运行直接从准备好的起点开始；缓存出问题时只变慢，不让任务失败。对应故事 [RUN-9、RUN-10、OPS-6、OPS-7、OPS-8](../../../user-story.md)。

## 起始状态

- Experiment 用 `e2bSandbox()`、`openSandbox()` 或 `instaboxSandbox()` 声明 template，Base 能对应到不可变身份：E2B template 能查到当前 build，OpenSandbox image 带 digest，Instabox 使用 `sn_` snapshot ID。
- 准备写成声明式 before action，例如 `gitCheckout()` 与 `shell()`；Experiment 没有声明 `sandboxReuse: true`。
- `maxConcurrency` 为 3，三个 Eval 的 before 前缀完全相同，本机 UserDatabase 中没有对应的 Before cache。

```ts
export default defineExperiment({
  maxConcurrency: 3,
  sandbox: e2bSandbox({ template: "node-base", lifetimeMs: 60 * 60_000 })
    .before(gitCheckout({ id: "project", repository, commit }))
    .before(shell({ id: "install", command: "pnpm install --frozen-lockfile", inputs: [lockfile] })),
});
```

## 完整路径

1. 运行前执行 `pnpm exec niceeval debug cloud-batch <eval>`，两条 before 的 capability 都显示 `run-prepared`，我在花钱前就知道这批准备只会做一次。 {#preview}
2. 第一次运行 `pnpm exec niceeval exp cloud-batch`。派发任何 Attempt 前，Run 为这段前缀创建一个 staging 实例，执行 `project` 后发布第一份 snapshot，在同一实例上继续执行 `install` 并发布第二份，然后删除 staging（OpenSandbox 为第二层另建一个 staging）。进度只出现一次准备活动。 {#cold-prepare}
3. 三个 Attempt 都从这份 snapshot 创建各自的实例，两条 before 都报告 `hit`，Agent 直接开始工作。一个 Attempt 写入 workdir 的文件不会出现在另一个 Attempt 里。 {#cold-dispatch}
4. 再运行一次 `pnpm exec niceeval exp cloud-batch --rerun all`。Run 在 lookup 阶段直接命中，不创建 staging，三个 Attempt 都报告 `hit`。 {#warm-hit}
5. 把 `install` 的命令改成 `pnpm install --frozen-lockfile --prod` 后再运行。`project` 继续命中，只有 `install` 在新的 staging 中重新执行并发布一次。 {#suffix-change}
6. 用 `--sandbox-before-cache bypass` 运行一次。所有 before 在各自 Attempt 中真实执行，反馈为 `replay · bypass`，不发布新的 snapshot。 {#bypass}

预期输出（第一次运行的准备阶段与派发后，摘要）：

```text
sandbox.before-cache.prepare  cloud-batch  2 actions  prepared
before cache: hit · 2/2
before cache: hit · 2/2
before cache: hit · 2/2
```

## 结果

每个不同的 BeforeCacheKey 在一次 Invocation 内只准备一次，同时运行的多个 Experiment 共享相同前缀；后续 Invocation 直接命中。缓存失败只让准备变慢，不改变 Eval 能否运行：

| 情形 | 用户看到的结果 |
| --- | --- |
| E2B template 以同名重建 | 旧前缀 miss，第一次运行重新准备并发布 |
| Base 不是不可变身份（未 pin digest 的 OpenSandbox image、不存在的 E2B tag） | before 报告 `unsupported` 并在每个 Attempt 中真实执行 |
| 准备过程中出现新增挂载或已知敏感内容，或云服务拒绝保存 | 该节点不发布；Attempt 从更浅的已发布前缀开始，其余 before 报告 `degraded` |
| snapshot 请求超时、结果不确定 | 同上；Run 结束时 NiceEval 按名称找到这份 snapshot 并删除 |
| 上游 snapshot 被删除或损坏 | Attempt 从 Base 重建实例，before 报告 `degraded`，带 `cache-degraded` diagnostic |
| author action 失败（例如 `pnpm install` 退出码非零） | 依赖该前缀的配对在派发前失败，其它配对照常运行；这是唯一让配对失败的情形 |
| 声明了 `sandboxReuse: true` | E2B 复用实例的第一条 Attempt 报告 `hit`，同一实例上的后续 Attempt 真实执行 before；OpenSandbox 与 Instabox 不支持复用，在规划时拒绝 |

## 相关契约

- [Before cache](../architecture/before-cache.md) —— 身份、Provider 能力与降级。
- [Sandbox 数据模型](../data-model.md) —— 远端 snapshot 账本。
- [远端 snapshot Before cache](../architecture/remote-snapshot-cache.md) —— Run 级节点结算、发布与各 Provider 规则。
- [CLI](../cli.md) —— `--sandbox-before-cache` 与 `--max-before-cache-concurrency`。
- [Sandbox Layer](../library/layers.md) —— 声明式 before action。
