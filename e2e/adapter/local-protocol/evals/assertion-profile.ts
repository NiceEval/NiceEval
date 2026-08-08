// 本地协议（uiMessageStreamAgent + 签入 fixture）只提供协议事实；公共断言逻辑在
// e2e/adapter/shared/assertion-contract.eval.ts。marker 与 src/fixture/server.ts 的
// CONTRACT_MARKERS 逐字一致——fixture 是真实协议执行端（真实工具 part 帧），
// 这里只声明事实，不复制任何断言实现。
const conversationMarker = "LOCAL_CONTRACT_CONVERSATION_926";
const scopeMarker = "LOCAL_CONTRACT_SCOPE_926";
const changedPath = "assertion-contract-edit.txt";
const createdPath = "assertion-contract-created.txt";
const deletedPath = "assertion-contract-delete.txt";
const changedBefore = "before-assertion-contract-926";
const changedAfter = "after-assertion-contract-926";
const createdMarker = "created-by-assertion-contract-926";
const shellMarker = "LOCAL_CONTRACT_OUTPUT_926";

export default {
  conversation: {
    prompt: "ping local-protocol conversation contract",
    marker: conversationMarker,
    absentTool: "shell",
  },
  scopeTool: {
    prompt: "ping local-protocol scope-tool contract",
    name: "shell",
    inputToken: scopeMarker,
    outputToken: scopeMarker,
    absentTool: "web_search",
  },
  coding: {
    prompt: "ping local-protocol coding contract",
    changedPath,
    changedBefore,
    changedAfter,
    createdPath,
    createdMarker,
    deletedPath,
    absentDiffToken: "must-not-appear-in-assertion-contract-diff",
    calls: [
      { name: "file_write", inputToken: createdPath, exactCount: 1 },
      { name: "file_edit", inputToken: changedPath, exactCount: 1 },
      { name: "shell", inputToken: deletedPath },
      { name: "shell", inputToken: shellMarker, outputToken: shellMarker },
    ],
    absentTool: "web_search",
    maxToolCalls: 4,
  },
  maxTokens: 200_000,
  maxCostUsd: 10,
  // UI Message Stream 协议帧不带 token 计数（adapter 声明的诚实 unavailable，见
  // docs/engineering/testing/e2e/adapter/ai-sdk.md）。契约在 profile 声明该标志时
  // 对 maxTokens / maxCost 走 optional 折叠，不把诚实的 unavailable 判成 errored。
  usageUnavailable: true,
  // Direct Agent：核心链接契约不允许声明 Sandbox（docs/engineering/testing/e2e/
  // adapter/README.md「共享断言契约」）。tool-match-and-sandbox 仍对真实工具事件执行
  // 完整 ToolMatch，只跳过 t.sandbox 专属段；Sandbox 4 个方法由六个 coding adapters
  // 的共享 Eval 证明。
  sandboxUnavailable: true,
};
