# Bug 组：协议路径必须落到同一个公开工具身份

这一组用 Codex SDK 流漏规范工具名作正例，用 Claude SDK 流的同形遗漏作反证。
它挑战的是 adapter 的多入口组合，但不需要新增 DSL 原语：现有 Eval 断言、真实 `cli()` 和执行树身份已经足够。

## 正例：命令成功执行，`calledTool("shell")` 却失败

fix commit `060a6a05` 前，`codex-sdk/run-command` 连续 6 个 attempt 失败。
artifact 中的 `command_execution` 已完成且 exit 0，但 SDK 流转换器发出的 tool `operation.started` 没有规范 `tool` 字段；事实推导只能得到 `name: "unknown"`，所以既有 Eval 的 `calledTool("shell")` 不命中。

公开错误事实是同一个 NiceEval 规范工具身份随接入路径变化：transcript parser 路径把命令归一为 `shell`，SDK stream 路径却没有。
用户症状看起来像 agent 没有调用工具，实际是 adapter 丢了身份。

fix 前 `src/agents/sdk-streams.test.ts` 已覆盖 `command_execution`、`mcp_tool_call` 与成对 result，但期望值本身只含原始 `name`，没有拿转换结果走一次公开 `calledTool` 语义。
测试精确验证了错误的中间形状，所以仍绿；最早应失败在 adapter contract case，其次是已有 Eval 的真实 E2E。

```ts
adapterBehavior(codexSdkCommandKeepsCanonicalIdentity, async () => {
  const run = await cli("pnpm exec niceeval exp run-command --rerun all", { cwd: w.consumerDir("codex-sdk") });
  const locator = reportView(run.stdout).latestAttemptLocator();
  const attempt = reportView((await cli(`pnpm exec niceeval show ${locator} --execution`)).stdout)
    .attempt(locator);

  expectObserved(attempt.executionNodes()).toShowRows(["shell"]);
});
```

真正的主断言仍是用户原有 Eval 里的 `calledTool("shell")`；上面的读回只负责在失败时把“agent 未调用”与“adapter 身份丢失”区分开。
DSL 不要求用户修改 Eval，也不要求额外发内部事件。

## 同形反证：Claude SDK 后来重复遗漏

`060a6a05` 的提交说明已经记录 `fromClaudeSdkMessages` 有同类缺口，但当时没有规范名 gate 依赖它，所以没有红。
直到 `d8d5a84b` 才给 Claude `tool_use` 补上 `CLAUDE_TOOL_ALIASES` 归一；该 commit 没有同步增加协议测试。

这证明“给 Codex 四种 item 写断言”只是单例修复。
可复用守护必须对每条公开 adapter 入口运行同一组 contract cases：给定厂商协议的 shell / file / web / MCP 代表事件，公开 execution node 与 `calledTool` 看到的规范身份一致；原始名只通过显式 `originalName()` 读取。

用户侧 proof 仍复用相同正文，只替换 world recipe 的 adapter，不为不同 SDK 改期望工具名。
如果 Claude 路径再次漏归一，`cli()` 先因既有 gate 非零退出；读回随后列出实际节点身份和原始名，定位到 adapter，而不是建议用户把断言改成 `Bash`。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 断规范身份 `shell`，不锁厂商原始词或渲染布局 |
| 不能改断言放行 | 同一 Eval 跨 adapter 复用；改成 `command_execution` / `Bash` 会违反公开规范身份 |
| 观察失败显式报错 | `cli()` 非零先报 outcome；读回缺 attempt 或 execution node 报 observe |
| 用户侧直接定位 | 同时列 gate、规范身份、原始协议名、locator 与可复制命令 |
| 设施不造假 | contract case 使用厂商协议 fixture；E2E 走真实 SDK 消费方，不手写 `Turn` 绕过转换器 |
| 用户已有用法不改 | 复用历史上已经存在的 `calledTool("shell")` Eval |
