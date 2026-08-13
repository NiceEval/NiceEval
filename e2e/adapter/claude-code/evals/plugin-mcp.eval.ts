// Plugins(适配器契约页 Eval 闭环表):从 Anthropic 官方 marketplace 安装知名的
// Context7 Plugin。它自带匿名可用的远程 MCP；调用 Plugin 命名空间内的工具就是
// "native plugin 安装真的把内容接线进了运行中的 agent"的行为证据，不只检查安装清单。
import { defineEval } from "niceeval";
import { includes, jsonMatch, satisfies, toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    "Plugins:官方 Context7 Plugin 自带的远程 MCP 已接线且能以正确入参被调用",
  async test(t) {
    const turn = await t.send(
      "调用 Context7 Plugin 的 resolve-library-id MCP 工具查找 React。" +
        "参数 libraryName=react、query=React useState documentation。不要用 Bash 或其它工具。" +
        "如果调用因为其 MCP server 还在连接中而失败,调用 WaitForMcpServers," +
        '参数只填 server 名称("plugin_context7_context7"——不是工具名,也不要加 mcp__ 前缀),' +
        "然后重试同一个工具调用;持续重试直到成功,不要放弃。" +
        "最后只报告工具返回的第一个 library ID。",
    );
    await turn.succeeded().orStop();

    t.calledTool(
      toolMatch("mcp__plugin_context7_context7__resolve-library-id", {
        input: jsonMatch({
          libraryName: "react",
          query: "React useState documentation",
        }),
      }),
    ).label('"mcp__plugin_context7_context7__resolve-library-id" input');
    t.check(turn.message, includes("/reactjs/react.dev"));
  },
});
