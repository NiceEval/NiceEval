// 协议行为:MCP——stdio 与远程 HTTP 两种形态的 `[mcp_servers.<name>]` 都能被调用。
//
// stdio:官方 @modelcontextprotocol/server-everything 的确定性 get-sum 工具(挂成 "e2e")。
// 远程 HTTP:DeepWiki 的公开、免鉴权 Streamable HTTP 端点(挂成 "deepwiki"),真实工具
// read_wiki_structure(repoName)返回一个仓库的文档目录——本仓库设计阶段已用真实
// codex-cli 0.144.1 在本机核对过这个远程端点可达、可被 Codex 正常调用。
// 原始工具名是 `${server}.${tool}`(点分隔,非 claude-code 的 mcp__ 命名空间,见
// memory/mcp-tool-naming-claude-vs-codex.md 与 src/o11y/parsers/codex.ts 的 mcp_tool_call 分支)。
//
// 两次调用必须在**同一轮**里发起,不能拆成两个 t.send():原生 item ID 只在所属 turn
// 内充当配对身份,跨轮不能拿顺序或局部 ID 猜测同一调用——
// 本仓库设计阶段真机复现过,两轮各自的 mcp_tool_call 都恰好落在 item_3,call ID 在这条会话的
// 累积事件流里发生碰撞,导致按 call ID 配对结果与调用错位。同一轮内地道具编号连续、不会碰撞。
import { defineEval } from "niceeval";
import { includes, satisfies, toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    "MCP 挂载:stdio 与远程 HTTP 两种形态在同一轮里都真实调用且入参正确",
  async test(t) {
    const turn = await t.send(
      "In this single turn, call two different MCP tools and report both results: " +
        "(1) use your e2e MCP tool to add 100 and 23 (do not compute it yourself), and " +
        "(2) use your deepwiki MCP tool to read the wiki structure for the GitHub repo openai/codex " +
        '(call it with repoName "openai/codex", do not guess). ' +
        "Report the sum, then a comma-separated list of the top-level topic names you found.",
    );
    await turn.succeeded().orStop();

    await t.group("stdio MCP 工具调用且入参正确", () => {
      t.calledTool(
        toolMatch("e2e.get-sum", {
          input: satisfies(
            "e2e.get-sum 入参 a=100 且 b=23",
            (input) =>
              typeof input === "object" &&
              input !== null &&
              !Array.isArray(input) &&
              Object.is((input as Record<string, unknown>)["a"], 100) &&
              Object.is((input as Record<string, unknown>)["b"], 23),
          ),
          status: "completed",
        }),
      );
    });
    t.check(turn.message, includes("123"));

    await t.group("远程 HTTP MCP 工具调用且入参正确", () => {
      t.calledTool(
        toolMatch("deepwiki.read_wiki_structure", {
          input: satisfies(
            "deepwiki 入参 repoName=openai/codex",
            (input) =>
              typeof input === "object" &&
              input !== null &&
              !Array.isArray(input) &&
              Object.is(
                (input as Record<string, unknown>)["repoName"],
                "openai/codex",
              ),
          ),
          status: "completed",
        }),
      );
    });
  },
});
