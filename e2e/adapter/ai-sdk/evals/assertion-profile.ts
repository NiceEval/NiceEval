// AI SDK（uiMessageStreamAgent）只提供协议事实；公共断言逻辑在
// e2e/adapter/shared/assertion-contract.eval.ts。工具名就是应用声明的真实工具名
// （get_weather / calculate / file_write / file_edit / shell），事件由真实模型调用
// 真实应用产生，不是伪造帧。
const conversationMarker = "AI_SDK_ASSERTION_CONTRACT_926";
const scopeMarker = "AI_SDK_SCOPE_TOOL_926";
const changedPath = "assertion-contract-edit.txt";
const createdPath = "assertion-contract-created.txt";
const deletedPath = "assertion-contract-delete.txt";
const changedBefore = "before-assertion-contract-926";
const changedAfter = "after-assertion-contract-926";
const createdMarker = "created-by-assertion-contract-926";
const shellMarker = "AI_SDK_TOOL_OUTPUT_926";

export default {
  conversation: {
    prompt:
      `只回复这个标记:${conversationMarker}。` +
      "这是普通对话反向契约：不要调用任何工具，不要读写文件，不要运行命令。",
    marker: conversationMarker,
    absentTool: "calculate",
  },
  scopeTool: {
    prompt:
      `只调用一次 get_weather 工具，参数 city 为 "北京"，` +
      "不要调用其它工具，然后只回复工具返回的天气。",
    name: "get_weather",
    inputToken: "北京",
    outputToken: "北京",
    absentTool: "calculate",
  },
  coding: {
    prompt:
      "按顺序完成下列操作，不要增加额外探索：" +
      `(1) 用 file_write 工具创建 ${createdPath}，内容恰好一行 ${createdMarker}；` +
      `(2) 用 file_edit 工具把 ${changedPath} 里的 ${changedBefore} 替换为 ${changedAfter}；` +
      `(3) 用 shell 工具执行 rm ${deletedPath}；` +
      `(4) 用 shell 工具执行 echo ${shellMarker}。` +
      "前两步禁止用 shell 写文件；完成后只简短确认。",
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
    absentTool: "calculate",
    maxToolCalls: 6,
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
