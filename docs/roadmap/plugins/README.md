# Plugins

Plugin 是可复用的 Eval、Experiment 或 Sandbox Group 条件蓝图。它在 factory 调用时成为不可变 definition，并可挂在四个稳定入口：

```ts
defineEval({ plugins: [...] });
defineScoreEval({ plugins: [...] });
defineExperiment({ plugins: [...] });
defineSandboxGroup({ plugins: [...] });
```

folder、suite 与 `defineConfig()` 不产生隐式 Plugin 继承。Plugin 不是新运行时、依赖注入容器、marketplace，也不是 Agent Native Plugin。

## 一等能力：扩展已选 Agent

Experiment 仍显式选择 Agent；Plugin 只为已选 Agent 贡献能力：

```ts
export default defineExperiment({
  agent: codexAgent(),
  plugins: [context7(), effectSkill(), remem()],
});
```

Plugin 可以安装 Skill、MCP server、Codex／Claude 原生 Plugin、Bub Python extension 和 Agent 原生 Hook，也可以声明 NiceEval 托管的 Attempt／逻辑 Send Hook。它不能选择或替换 Agent、model、provider、主 credential、Sandbox template、budget 或 Sequence。

直接配置与 Plugin 复用同一种 `AgentExtension`，没有第二套安装真源：

```ts
codexAgent({
  configFile: "configs/codex/base.toml",
  extensions: [
    skillsExtension({ review: { source: reviewSkill } }),
    mcpServersExtension({ docs: { url: "https://mcp.example.com/v1" } }),
  ],
});
```

`configFile`／`settingsFile`、主进程变量集合、model／provider 和主 credential 仍是 Agent base-only 配置。Plugin 不提供 arbitrary native-config patch 或 generic env merge；新能力通过 receiver 拥有的窄 typed protocol 增加。

## 两类 Hook 不能混用

- **Agent 原生 Hook** 是 Codex／Claude 等运行时自己的声明式能力，经 receiver-specific `AgentExtension` 安装并由 Agent 执行。
- **Hosted Agent Hook** 由 NiceEval 执行，只观察 Attempt 与一次逻辑 `t.send()` 的前后边界。它不能改写 prompt、Session 或 Turn，也不监听逐 token／逐物理重试事件。

Hosted Hook 使用 `beforeSend`／`afterSend`，而不是 `beforeTurn`／`afterTurn`：终局发送失败时不存在可信 Turn，但 `afterSend` 仍必须拿到穷尽的 `SendHookExit` 并完成收尾。

## pair link 与身份

NiceEval 在每个 Eval × Experiment pair 的 link 阶段组合两侧贡献。Plugin 的 contribution 包括：

- behavior identity 与封闭 typed requirements；
- command-only Sandbox layer 与现有 Experiment lifecycle；
- `AgentExtension` 与 Hosted Agent Hook；
- 声明式 RecordAttachment write grant。

`(name, instance)` 在一个 pair 内唯一，`name` 使用 reverse-domain lowercase ASCII namespace。Eval 与 Experiment 两侧重复同一 identity 是 typed link conflict，不是去重机会。每个 owner 内先接作者原生片段，再按 `plugins[]` 顺序接 Plugin 片段；跨 owner 顺序由 template owner 决定。

Agent factory 与 Experiment Plugin 形成 `RunAgentPlan`，其安全规范投影进入 Run `configHash`。Eval Plugin 只形成 pair-local delta；pair fingerprint 已经包含 `configHash`，不会重复编码 Run 投影。同值 Eval contribution 只增加 provenance，异值在创建资源前形成 pair link conflict。

## 完整 desired state，而不是增量安装

receiver 把 Agent base 与 Plugin contribution 规范化并组合为不可变 `LinkedAgentPlan`。每个 Attempt 都必须把 Agent home 收敛到本次完整 desired state：即使声明为空，也要移除上一 Attempt 留下的 NiceEval-managed Skill、MCP、Plugin、Hook 与 credential materialization。

receiver 只能撤销自己拥有的 overlay，不能删除用户或 Agent 自己的未知状态。无法证明隔离或可撤销的 extension 必须声明不支持 Sandbox reuse，并在资源创建前被 requirement 拒绝。Agent teardown 完成后才 dispose overlay，避免 drain／flush 或 Agent 自身收尾读取不到配置。

## Plugin 不扩张 Record Core

Plugin 不直接修改 Record Core。框架只为需要落 Record 的 Eval／Experiment Plugin 写入版本化 `niceeval.plugin-provenance/v1` RecordAttachment，保存：

- `name`、`instance`、`revision`、mount 与 source；
- 安全规范化后的 effective behavior identity；
- 已接受 contribution 的 typed refs；
- 仅含 domain 与可选 revision 的 redacted credential token（如有）。

credential value、env selector、宿主绝对路径、私有 config、raw token、未规范化 options 与 receiver opaque payload 不进入 provenance。Run-owned document 只包含整份 Run 真正共享的 Experiment mount；Attempt-owned document 保存对应 Eval／pair 事实。Group 不写 provenance，它只留在 demand cohort 的 plan manifest。

## 声明式 RecordAttachment capability

Plugin blueprint 必须通过 [RecordAttachment 作者 API](../record-attachment-authoring/README.md) 的 producer `recordAttachments: { write: [...] }` 显式声明它可写的每个 definition。运行时 context 只接受该 linked occurrence grant 中、owner 正确的 definition；它没有 raw name、path 或 JSON 写入口。

一个 owner 的一个 attachment family 至多写一次。closed、wrong-owner、undeclared 或 duplicate write 都是具名 typed failure；不会由 last-wins、静默改写或开放写入通道处理。完整类型、provenance 与 migration 规则见 [Library](library.md)。

## 资产、凭据与信任边界

`pluginAsset(new URL("./assets/...", import.meta.url))` 表示 module-relative trusted local asset。definition 只保存 locator；仅选中的 occurrence 在 planning 阶段读取、拒绝 symlink／special file 并计算 digest。manifest 与 dry plan 只显示用途、kind 和 digest，不显示宿主绝对路径。远程安装内容必须带完整 commit identity 或声明的 content digest；floating branch、movable tag 与默认 ref 在 link 阶段拒绝。

扩展凭据通过 `credentialFromEnv()` 的 opaque runtime binding 引用。factory、link 与 dry plan 不读取 env；materialize 在任何扩展写入前一次性求值，secret value 永不进入 hash、provenance、manifest 或错误文本。

Plugin package、第三方 protocol factory 与 receiver 都是 application-trusted ESM code。NiceEval 只为内建 receiver 承诺纯 `resolve`、redaction 与资源纪律；nominal token 防误接线，不构成 JavaScript sandbox。不提供 marketplace 自动发现、全局 registry 或按 Record 动态 import。

## 框架保证

- discovery、factory activation 与 pure link 不调用 lifecycle、不求值 runtime binding；资产 I/O 只发生在显式 selected planning snapshot。
- Agent 特殊性留在 Adapter receiver；core 不读取 receiver payload 或 secret。
- requirements 只拒绝非法计划，不暗改 template、lifetime、Sequence 或并发。
- keyed contribution 同 canonical value 去重并保留 provenance，异值冲突；有序 Hook 保持 Plugin 声明顺序，不采用 last-wins。
- dry plan 展示 Plugin → extension → selected receiver → redacted manifest、顺序、冲突与不支持原因，不创建资源。

## 入口

- [Library](library.md) —— `definePlugin()`、Agent extension protocol、Hosted Hook、asset／credential 与 RecordAttachment write grant。
- [Architecture](architecture.md) —— pair link、receiver、身份、收敛、provenance 与信任边界。
- [Lifecycle](lifecycle.md) —— 分阶段 Agent plan、Effect Scope、Hook 与失败语义。
- [给 Codex 安装 MCP、Skill 与 Hook](use-case/codex-agent-extensions.md)
- [Remem 用例](use-case/remem.md)
- [NiceEval-Eval 候选 Runtime](use-case/niceeval-eval-candidate-runtime.md)
- [Terminal-Bench Harness](use-case/terminal-bench-harness.md)
- [Git checkout](use-case/git-checkout.md)
