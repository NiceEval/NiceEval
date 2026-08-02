// Plugins(适配器契约页 Eval 闭环表):marketplace 安装的 Plugin 行为在事件流中可观察。
// 用本仓库自带的本地 Marketplace fixture(不依赖第三方仓库内容漂移),这个 Plugin 自带
// 一份 `.mcp.json`——装上后其 MCP server 以 `mcp__plugin_<plugin>_<server>__<tool>`
// 命名出现(本机实测确认,与直接配置的 mcpServers 用 `mcp__<server>__<tool>` 不同
// 命名空间),调用它就是"native plugin 安装真的把内容接线进了运行中的 agent"的行为证据,
// 不只是安装 manifest 记了一笔。
//
// setup 钩子在 agent.setup 之前把 fixture 上传到沙箱 workdir 下的
// `.fixtures/e2e-marketplace`(见 EvalDef.setup 时序:eval.setup → agent.setup →
// test),experiments/plugin.ts 里的 `marketplace.source` 引用同一个相对路径。
import { defineEval } from "niceeval";
import type { Sandbox } from "niceeval/sandbox";

export default defineEval({
  description: "Plugins:marketplace 安装的 plugin 自带的 MCP server 已接线且能以正确入参被调用",
  async setup(sandbox: Sandbox) {
    // uploadDirectory 的本地目录相对 eval 定义文件所在目录(evals/)解析,不是项目根。
    await sandbox.uploadDirectory("../fixtures/plugins/e2e-marketplace", ".fixtures/e2e-marketplace");
  },
  async test(t) {
    const turn = await t.send(
      "调用名字严格为 mcp__plugin_e2e-plugin_tools__get-sum 的 MCP 工具,参数 a=55、b=8。" +
        "不要用 Bash,不要自己计算,也不要用任何其它工具。" +
        "如果调用因为其 MCP server 还在连接中而失败,调用 WaitForMcpServers," +
        '参数只填 server 名称("plugin_e2e-plugin_tools"——不是工具名,也不要加 mcp__ 前缀),' +
        "然后重试同一个工具调用;持续重试直到成功,不要放弃。" +
        "只报告它返回的最终数字。",
    );
    await turn.succeeded().stopOnFailure();

    t.calledTool("mcp__plugin_e2e-plugin_tools__get-sum", { input: { a: 55, b: 8 } });
    turn.messageIncludes("63");
  },
});
