# Plugins

Plugin 是可复用的 Eval、Experiment 或 Sandbox Group 条件蓝图。它在 factory 调用时成为不可变 definition，并可挂在四个稳定入口：

```ts
defineEval({ plugins: [...] });
defineScoreEval({ plugins: [...] });
defineExperiment({ plugins: [...] });
defineSandboxGroup({ plugins: [...] });
```

folder、suite 与 `defineConfig()` 不产生隐式 Plugin 继承。Plugin 不是新运行时、依赖注入容器、marketplace，也不是 Agent Native Plugin。

## pair link 与挂载

NiceEval 在每个 Eval × Experiment pair 的 link 阶段组合两侧贡献。Plugin 可贡献 behavior identity、封闭 typed requirements、command-only Sandbox layer、现有 lifecycle 与 receiver-branded AgentExtension。
它不能替换 Agent、Sandbox template、provider、lifetime、Sequence、并发、预算或 Eval 选择。

`(name, instance)` 在一个 pair 内唯一。Eval 与 Experiment 两侧重复同一 identity 是 typed link conflict，不是去重机会。每个 owner 内先接作者原生片段，再按 `plugins[]` 顺序接 Plugin 片段；跨 owner 顺序由 template owner 决定。

## Plugin 不扩张 Record Core

Plugin 不直接修改 Record Core。框架只为需要落 Record 的 Eval／Experiment Plugin 写入版本化
`niceeval.plugin-provenance/v1` RecordAttachment，保存：

- `name`、`instance`、`revision`、mount 与 source；
- 安全规范化后的 effective behavior identity；
- 已接受 contribution 的 typed refs；
- 仅含 domain 与 version 的 redacted credential token（如有）。

credential value、私有 config、raw token、未规范化 options 与任意 JSON 不进入 provenance。Run-owned document 只包含
整份 Run 真正共享的 Experiment mount；Attempt-owned document 保存对应 Eval／pair 事实。Group 不写 provenance，它只
留在 demand cohort 的 plan manifest。provider、slot、pair 或 cohort 不能提升成“整个 Run 都如此”的假事实。

## 声明式 RecordAttachment capability

Plugin blueprint 必须通过 [RecordAttachment 作者 SDK](../record-attachment-authoring/README.md) 的 producer
allowlist 显式声明它可写的每个 definition。运行时 context 只接受该 occurrence allowlist 中、owner 正确的
definition；它没有 raw name、path 或 JSON 写入口。

一个 owner 的一个 attachment family 至多写一次。closed、wrong-owner、undeclared 或 duplicate write 都是具名 typed failure；不会由 last-wins、静默改写或开放写入通道处理。完整类型、provenance 与 migration 规则见 [Library](library.md)。

## 迁移与信任边界

Plugin Attachment definition 自带完整相邻 migration 图，应用经 `defineConfig({ recordAttachments })` 显式安装。
registry 只表达 application trust，不重新声明 converter，也不授予 Plugin 写权限。`niceeval migrate` 不按保存的
schema 动态 import Plugin，也不运行 Plugin factory、hook 或 lifecycle。

converter 是 trusted extension。其 `Effect` requirement 为 `never`，表示 converter 不需要 NiceEval runtime service；这不是 JavaScript 沙箱，也不证明第三方代码安全。

## 框架保证

- discovery / link 不重跑 factory、不调用 lifecycle，也不求值 runtime binding；可信 Plugin 的 import 与 factory 必须保持纯函数。
- Agent 特殊性留在 Adapter receiver；core 不读取 receiver payload 或 secret。
- requirements 只拒绝非法计划，不暗改 template、lifetime、Sequence 或并发。
- Experiment attachment 行为进入 Run `configHash`；Eval attachment 行为进入对应 Eval fingerprint / manifest。
- Group 只形成 demand cohort 与 unavailable policy；资源 lifetime 仍属于 physical Sandbox instance。

## 入口

- [Library](library.md) —— `definePlugin()`、typed attachment capability 与 registry。
- [Architecture](architecture.md) —— pair link、provenance、identity 与 owner 边界。
- [Lifecycle](lifecycle.md) —— 资源作用域、失败与封口时点。
- [Remem 用例](use-case/remem.md)
- [NiceEval-Eval 候选 Runtime](use-case/niceeval-eval-candidate-runtime.md)
- [Terminal-Bench Harness](use-case/terminal-bench-harness.md)
- [Git checkout](use-case/git-checkout.md)
