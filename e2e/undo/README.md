# 暂停的 E2E fixture

这里保存尚无完整官方 Agent 工厂的真实 fixture，不参与 E2E discovery、CI matrix 或结构守护。

fixture 只有在产品侧补齐对应官方工厂，并完成以下收口后才能移回 `e2e/adapter/`：

- 删除仓库内的 `agents/` 与本地 Adapter 实现；
- Experiment 直接从 `niceeval/adapter` 导入并实例化官方工厂；
- 不调用 `defineAgent`、`defineSandboxAgent`、`driveFrameStream` 或 `from*Events` 拼装 Agent；
- 通过 `test/e2e-structure.test.ts` 与该仓库真实 E2E。

当前暂停项：`claude-agent-sdk`、`codex-sdk`、`pi-agent-core`、`langgraph`。
