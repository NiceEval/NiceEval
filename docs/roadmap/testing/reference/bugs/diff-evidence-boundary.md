# Bug 组：公开证据存在性不能由内部便利布尔值代替

这一组用 `agent.setup` 文件污染 agent diff 作正例，用零改动 diff 被误报为无证据作同形反证。
两条都不是 diff 算法错误，而是框架自己的辅助事实越过边界，冒充用户看到的公开证据。

## 正例：框架安装文件冒充 agent 产出

fix commit `28758142` 前，attempt 在 `agent.setup` 之前建立 Git 参照点。
adapter 随后写入 `.claude/skills/**`、`.agents/skills/**`，或新建 `AGENTS.md`；最终
`captureGeneratedFiles()` 便把这些框架安装物当成 agent 生成文件。
用户的既有 `notInDiff()` gate 会误红，`show --diff` 也被几十个无关路径淹没。

修复把 adapter 新建的未跟踪 workspace 路径写进 `.git/info/exclude`；已有的
`AGENTS.md` 不排除，因为 agent 仍可能真实修改它。
当时新增的 `skills.test.ts` 只断 fake sandbox 收到一条包含 `.git/info/exclude` 的命令，
没有从真实 attempt 读回最终 diff，所以“命令发了但边界仍错”仍可全绿。

验收不读取 `.git/info/exclude`，也不要求用户改 Eval：复用现有带 Skill 的 agent 配置、原有
Eval 与公开 diff 读回。

```ts
adapterBehavior(setupFilesAreNotAgentOutput, async () => {
  const run = await cli("pnpm exec niceeval exp skill-fixture --rerun all --json");
  const locator = ndjsonEvents(run.stdout).attempt("skill-uses-effect-ts").locator();
  const shown = await cli(`pnpm exec niceeval show ${shellArg(locator)} --diff`);

  expectObserved(shown.exitCode()).toEqualValue(0);
  expectObserved(shown.stdoutText())
    .toMatchScrubbedFileSnapshot("golden/skill-agent-diff.txt");
});
```

golden 只收公开命令的短路径清单与净改动，不收 patch 行号、颜色或内部排除文件。
若该 Eval 本来已有 `notInDiff()` gate，同一真实运行会更早在 outcome 阶段失败；验收器直接保留
该 gate，不复制一份特例断言。

## 同形反证：有 artifact，不等于有净改动

fix commit `2b81795f` 前，`attemptDiffData()` 用 `capabilities.diff` 决定 diff 证据是否存在。
但这个字段还包含“有文件值得推荐给用户看”的策略：artifact 存在但 `files` 为空时为 false。
于是 MemoryBench 的零改动 attempt 被渲染成 `diff unavailable`。

修复只按 `evidence.diff === null` 判断证据缺失，并保留三态：

- `null`：没有发布 diff artifact；
- `files: []`：artifact 存在，agent 没有净改动；
- 非空：存在净改动。

修复测试已经用同一个 `diffText()` 纯函数区分 `diff unavailable` 与
`no file changes by the agent`，但没有走真实 `show --diff`。
用户侧仍复用上面的真实 `cli()` 与 scrubbed golden；同一原语同时防止“框架文件被算进去”和
“空证据被算没了”，无需新增 `capabilities()` 或 `diffArtifactExists()` 内部读面。

## 六项检查

| 检查 | 判断 |
|---|---|
| 契约不变不误红 | golden 只锁公开路径身份与零改动短文案，不锁 patch、颜色和 `.git/info/exclude` 实现 |
| 不能改断言放行 | recipe 固定同一安装配置与既有 Eval；新增框架路径或把“零改动”改成“无证据”都必须解释公开契约变化 |
| 观察失败显式报错 | 真实命令非零、locator 缺失、golden 路径差异分阶段报告 |
| 用户侧直接定位 | 消息附 run / attempt locator、实际 diff 路径清单与 `show --diff` 命令 |
| 设施不造假 | 真实 attempt 建参照点并捕获 diff；不读取 fake sandbox 命令或手工拼 `AttemptEvidence` |
| 用户已有用法不改 | 复用既有 agent 配置、Eval、gate 和 `show --diff` |
