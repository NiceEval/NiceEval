// Real native Plugin installation must expose the fixture server under the
// Plugin namespace; calling its tool proves more than installation metadata.
import { defineEval } from "niceeval";
import { jsonMatch, toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    "Plugins:安装后的 Plugin MCP 能以正确入参被调用并返回结果",
  async test(t) {
    const turn = await t.send(
      "调用名字严格为 mcp__plugin_e2e_fixture__get-sum 的 MCP 工具，参数 a=517、b=926。" +
        "必须真实调用这个工具，不要自己计算，不要用 Bash 或其它工具。" +
        "如果调用因为其 MCP server 还在连接中而失败,调用 WaitForMcpServers," +
        '参数只填 server 名称("plugin_e2e_fixture"——不是工具名,也不要加 mcp__ 前缀),' +
        "然后重试同一个工具调用;持续重试直到成功,不要放弃。" +
        "最后只报告工具返回的数字。",
    );
    await turn.succeeded().orStop();

    t.calledTool(
      toolMatch("mcp__plugin_e2e_fixture__get-sum", {
        input: jsonMatch({
          a: 517,
          b: 926,
        }),
        output: jsonMatch(/1443/),
        status: "completed",
      }),
    ).label('"mcp__plugin_e2e_fixture__get-sum" input and output');
  },
});
