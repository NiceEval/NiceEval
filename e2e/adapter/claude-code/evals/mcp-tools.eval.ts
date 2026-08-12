// MCP(适配器契约页 Eval 闭环表):stdio 与 Streamable HTTP 两种 server 形态都能被真实调用,
// 工具以 mcp__<server>__<tool> 命名出现,入参连名带参一起断言(入参保真是协议路径的
// 一部分)。反例 calledTool count:0 的目标 server(e2e-absent)从未挂载过,负断言在结构上
// 必然成立,不依赖模型这一次具体怎么回答。
import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";

export default defineEval({
  description:
    "MCP:stdio 与 Streamable HTTP 两种 server 形态都能被真实调用且入参正确;未挂载的 server 从未被调用",
  async test(t) {
    const turn = await t.send(
      "调用名字严格为 mcp__e2e-stdio__get-sum 的 MCP 工具,参数 a=100、b=23。" +
        "然后调用名字严格为 mcp__e2e-http__get-sum 的 MCP 工具,参数 a=6、b=36。" +
        "必须通过工具调用真正调用这两个精确工具;不要用 Bash,不要自己计算,也不要用任何其它工具。" +
        "如果某次工具调用因为其 MCP server 还在连接中而失败,调用 WaitForMcpServers," +
        '参数只填 server 名称(即 "e2e-stdio" 或 "e2e-http"——不是工具名,也不要加 mcp__ 前缀),' +
        "然后重试同一个工具调用;持续重试直到两次调用都成功,不要放弃。" +
        "把两个结果按调用顺序报告为用空格分隔的两个数字。",
    );
    await turn.succeeded().orStop();

    await t.group(
      "两个已挂载的 MCP server 都以精确入参被调用;未挂载的 server 从未被调用",
      () => {
        t.calledTool("mcp__e2e-stdio__get-sum", {
          input: { a: 100, b: 23 },
        }).label('"mcp__e2e-stdio__get-sum" input');
        t.calledTool("mcp__e2e-http__get-sum", {
          input: { a: 6, b: 36 },
        }).label('"mcp__e2e-http__get-sum" input');
        t.calledTool("mcp__e2e-absent__get-diff", { count: 0 });
      },
    );

    t.check(turn.message, includes("123"));
    t.check(turn.message, includes("42"));
  },
});
