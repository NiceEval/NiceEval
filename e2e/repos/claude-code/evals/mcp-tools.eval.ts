// MCP(适配器契约页 Eval 闭环表):stdio 与远程 HTTP 两种 server 形态都能被真实调用,
// 工具以 mcp__<server>__<tool> 命名出现,入参连名带参一起断言(入参保真是协议路径的
// 一部分)。反例 notCalledTool 的目标 server(e2e-absent)从未挂载过,负断言在结构上
// 必然成立,不依赖模型这一次具体怎么回答。
import { defineEval } from "niceeval";

export default defineEval({
  description: "MCP: stdio and remote HTTP server forms are both callable with correct input; an unmounted server is never called",
  async test(t) {
    const turn = await t.send(
      "Call the MCP tool named exactly mcp__e2e-stdio__get-sum with a=100 and b=23. " +
        "Then call the MCP tool named exactly mcp__e2e-http__get-product with a=6 and b=7. " +
        "You must invoke both exact tools via tool calls; do not use Bash, do not compute anything yourself, do not use any other tool. " +
        "If a tool call fails because its MCP server is still connecting, call WaitForMcpServers with the server " +
        'name only (i.e. "e2e-stdio" or "e2e-http" — not the tool name, and not prefixed with mcp__), ' +
        "then retry the exact same tool call; keep retrying until both calls succeed, do not give up. " +
        "Report both results as two numbers separated by a space, sum first.",
    );
    turn.expectOk();

    await t.group("both mounted MCP servers are called with exact input; an unmounted one is never called", () => {
      t.calledTool("mcp__e2e-stdio__get-sum", { input: { a: 100, b: 23 } });
      t.calledTool("mcp__e2e-http__get-product", { input: { a: 6, b: 7 } });
      t.notCalledTool("mcp__e2e-absent__get-diff");
    });

    turn.messageIncludes("123");
    turn.messageIncludes("42");
  },
});
