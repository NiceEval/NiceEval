// Plugins(适配器契约页 Eval 闭环表):marketplace 安装的 Plugin 行为在事件流中可观察。
// 用本仓库自带的本地 Marketplace fixture(不依赖第三方仓库内容漂移),这个 Plugin 自带
// 一份 `.mcp.json`——装上后其 MCP server 以 `mcp__plugin_<plugin>_<server>__<tool>`
// 命名出现(本机实测确认,与直接配置的 mcpServers 用 `mcp__<server>__<tool>` 不同
// 命名空间),调用它就是"native plugin 安装真的把内容接线进了运行中的 agent"的行为证据,
// 不只是安装 manifest 记了一笔。
//
// setup 钩子在 agent.setup 之前把 fixture 上传到沙箱 workdir 下的
// `.fixtures/e2e-marketplace`(见 EvalDef.setup 时序:eval.setup → agent.setup →
// test),agents/claude-code-plugin.ts 里的 `marketplace.source` 引用同一个相对路径。
import { defineEval } from "niceeval";
import type { Sandbox } from "niceeval/sandbox";

export default defineEval({
  description: "Plugins: a marketplace-installed plugin's bundled MCP server is wired in and callable with correct input",
  async setup(sandbox: Sandbox) {
    // uploadDirectory 的本地目录相对 eval 定义文件所在目录(evals/)解析,不是项目根。
    await sandbox.uploadDirectory("../fixtures/plugins/e2e-marketplace", ".fixtures/e2e-marketplace");
  },
  async test(t) {
    const turn = await t.send(
      "Call the MCP tool named exactly mcp__plugin_e2e-plugin_tools__get-sum with a=55 and b=8. " +
        "Do not use Bash, do not compute it yourself, do not use any other tool. " +
        "If the call fails because its MCP server is still connecting, call WaitForMcpServers with the server " +
        'name only ("plugin_e2e-plugin_tools" — not the tool name, and not prefixed with mcp__), ' +
        "then retry the exact same tool call; keep retrying until it succeeds, do not give up. " +
        "Report only the final number it returns.",
    );
    turn.expectOk();

    t.calledTool("mcp__plugin_e2e-plugin_tools__get-sum", { input: { a: 55, b: 8 } });
    turn.messageIncludes("63");
  },
});
