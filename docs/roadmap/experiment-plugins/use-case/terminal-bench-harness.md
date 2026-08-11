# Terminal-Bench 的 Harness 条件

## 异构 Pair 是首要约束

terminal-bench 的 Experiment 不拥有 Sandbox template。238 道 Eval 各自声明 folder-local 起点:226 道是 Dockerfile,12 道是 Docker Compose。同一个 Codex Experiment 因此会 link 出大量 provider / template 不同的 Eval × Experiment pair。

这证明 Experiment Plugin 不能在 Run 级只为 Sandbox contribution 或 requirement 求值一次。一个公共 harness 条件必须逐 pair 接入:

```ts
export default defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.6-luna",
  evals: ["terminal-bench/"],
  plugins: [terminalBenchHarness()],
});
```

`terminalBenchHarness()` 可以表达所有题共同成立、且不改变起点的条件:

- 对每个 completed pair plan 验证封闭的 typed platform / requested plan 字段;
- 在两个作者 layer 之后追加轻量 command-only 检查命令;
- 把实际 provider family、执行身份与 harness revision 写入 facts;
- 给错误和 diagnostic 附 `contributionSource`;
- 让 Codex 与 Oracle 两个 Experiment 复用同一组 harness 观测规则。

每个 pair 的实得 template、provider 与 requirement 结果留在该 Eval 的 plan / fingerprint manifest,不能提升成“一整份 Run 都是 Compose”或“一整份 Run 都是 Dockerfile”的假事实。

## Oracle 不是 Plugin

Terminal-Bench 的 Oracle 会读取当前 `AgentContext.evalId`,上传该题的 `solution.sh` / `solution.yaml`,再执行已知正确答案。它拥有自己的 Agent identity、ensure、evidence coverage 与 send 语义:

```ts
export default defineExperiment({
  agent: tbOracle,
  model: "oracle",
  plugins: [terminalBenchHarness()],
});
```

`tbOracle` 必须继续是完整 Agent。把它写成 `plugins: [oracle()]` 会让插件暗中替换 Agent,破坏调用点对“谁在产生 Turn”的判断,也绕过 Agent receiver 只扩展既有 Agent 的边界。

同理,模型实验继续显式写 `agent: codexAgent()`;harness plugin 可以向 Codex 的 receiver 贡献诊断或安装后扩展,不能把 Codex 变成 Oracle。

## Harbor Compose env 不是 Plugin

`harborComposeEnv(taskId)` 由具体 Eval 的 task id 决定,并参与该题 `dockerComposeSandbox()` 的 template 插值与宿主目录。它属于 folder-local Eval 起点,不属于跨题公共 Experiment 条件。

把它搬进 Experiment Plugin 会产生三个问题:

- 插件必须猜当前 Eval task id 与 template family;
- command-only contribution 越权修改 template env;
- Run 级插件身份掩盖每题不同的宿主路径与 Compose build identity。

因此每条 Compose Eval 继续在自己的 template factory 中调用它。Experiment Plugin 只消费 link 后的 provider-neutral pair facts,不读取 Compose 私有 identity。

## 适合共用的调用形状

Codex 与 Oracle 可以共享 plugin,但 Agent 选择保持一眼可见:

```ts
const terminalBenchPlugins = [terminalBenchHarness()] as const;

export const codexExperiment = defineExperiment({
  agent: codexAgent(),
  model: "gpt-5.6-luna",
  plugins: terminalBenchPlugins,
});

export const oracleExperiment = defineExperiment({
  agent: tbOracle,
  model: "oracle",
  plugins: terminalBenchPlugins,
});
```

共享 blueprint 不共享运行时 mutable state。两个 Experiment 各自得到 Linked Plugin Instance;它们并行跑不同 Sandbox 时,setup handle、facts 与 teardown obligation 互不改写。
