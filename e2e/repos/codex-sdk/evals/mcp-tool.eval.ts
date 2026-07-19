// 协议行为:MCP 工具调用——MCP 工具出现在 action.called(名字是 `${server}.${tool}`,见
// src/agents/sdk-streams.ts 的 fromCodexThreadEvents);反例断言未挂载的工具 notCalledTool。
//
// MCP server 用官方 `@modelcontextprotocol/server-everything` 的确定性 get-sum 工具
// (agents/codex-sdk.ts 里挂成 "e2e"),不为这一个 Eval 手写自定义 stdio MCP server。
import { defineEval } from "niceeval";

export default defineEval({
  description: "MCP 工具挂载:点名使用后真实调用且入参正确;反例断言未挂载的工具",
  async test(t) {
    // 点名工具 + 明令排除逃生舱(shell / apply_patch / 自己心算):Codex 除了挂载的 MCP 工具外
    // 永远还有 shell 可用,泛泛的"用 MCP 工具"、"别自己算"挡不住模型改口跑一条 `expr`/`python -c`
    // 也能拿到同一个数字——真机验证过这条更宽的 prompt 才稳定选中 e2e.get-sum(6/6)。
    const turn = await t.send(
      'Call the MCP tool named "e2e.get-sum" with arguments {"a":100,"b":23} to compute the sum. ' +
        "This is a hard requirement: do not use a shell command, do not use apply_patch, do not write or run " +
        "any code, do not compute the sum yourself in any way -- the only acceptable action is one call to " +
        "the e2e.get-sum MCP tool. Report only the final number it returns.",
    );
    turn.expectOk();

    await t.group("MCP 工具调用且入参正确", () => {
      t.calledTool("e2e.get-sum", { status: "completed", input: { a: 100, b: 23 } });
    });
    t.messageIncludes("123");

    // 反例:这个仓库没有挂载天气 MCP server,同一段事件流不应该出现这个工具调用——
    // 证明转换器不会为不存在的挂载编造归一结果。
    t.notCalledTool("weather.get_weather");
  },
});
