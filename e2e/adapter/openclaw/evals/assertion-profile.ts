// OpenClaw 只提供协议事实；公共断言逻辑在 e2e/adapter/shared/assertion-contract.eval.ts。
// 工具名按 openclaw session transcript 归一后的 canonical 名（file_write / shell）。
const conversationMarker = "OPENCLAW_ASSERTION_CONTRACT_926";
const scopeMarker = "OPENCLAW_SCOPE_TOOL_926";
const changedPath = "assertion-contract-edit.txt";
const createdPath = "assertion-contract-created.txt";
const deletedPath = "assertion-contract-delete.txt";
const changedBefore = "before-assertion-contract-926";
const changedAfter = "after-assertion-contract-926";
const createdMarker = "created-by-assertion-contract-926";
const shellMarker = "OPENCLAW_TOOL_OUTPUT_926";

export default {
  conversation: {
    prompt:
      `只回复这个标记:${conversationMarker}。` +
      "这是普通对话反向契约：不要调用任何工具，不要读写文件，不要运行命令。",
    marker: conversationMarker,
    absentTool: "web_search",
  },
  scopeTool: {
    prompt:
      `只调用一次 Bash 工具执行 echo ${scopeMarker}，` +
      "不要调用其它工具，然后只回复命令输出。",
    name: "shell",
    inputToken: scopeMarker,
    outputToken: scopeMarker,
    absentTool: "web_search",
  },
  coding: {
    prompt:
      "按顺序完成下列操作，不要增加额外探索：" +
      `(1) 用你的文件写入工具创建 ${createdPath}，内容恰好一行 ${createdMarker}；` +
      `(2) 用你的文件编辑工具把 ${changedPath} 里的 ${changedBefore} 替换为 ${changedAfter}；` +
      `(3) 用 Bash 执行 rm ${deletedPath}；` +
      `(4) 用 Bash 执行 echo ${shellMarker}。` +
      "前两步禁止用 Bash/Python/重定向写文件；完成后只简短确认。",
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
    maxToolCalls: 6,
  },
  maxTokens: 200_000,
  maxCostUsd: 10,
};
