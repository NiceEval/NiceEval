// Plugin 安装收敛 × Sandbox 复用(docs/engineering/testing/e2e/adapter/claude-code.md 的
// Plugins 行)。一个沙箱依次承接两条 attempt:workdir 回到题间重置点,$HOME 带着上一条
// attempt 的 marketplace 注册与插件安装进场,agent setup 每条 attempt 重跑一次。
//
// 残留由 preTeardown 种下:本条 attempt 的证据收完之后,把已安装的插件缓存改名成另一个 MCP
// server。claude 对已注册的 marketplace 与已安装的 plugin 都按空操作处理
// (`Marketplace '…' already on disk`、`Plugin "…" is already installed`,真机 2.1.220 复现),
// 所以第二条 attempt 只有在安装步骤先移除同名安装、再从声明的 marketplace 重装时,plugin-mcp
// 断言的 `mcp__plugin_e2e-plugin_tools__get-sum` 才会重新出现。种在 preTeardown 而不是
// postSetup:残留是留给下一条 attempt 的,本条 attempt 的断言仍跑在按声明装出来的那份安装上。
import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import type { SandboxHook } from "niceeval/sandbox";
import { pluginSandbox } from "../sandbox.ts";

const MARKETPLACE = "niceeval-e2e-marketplace";
const PLUGIN = "e2e-plugin";

const staleInstalledPlugin: SandboxHook = async (sb) => {
  const res = await sb.runShell(
    [
      "set -e",
      `f=$(ls ~/.claude/plugins/cache/${MARKETPLACE}/${PLUGIN}/*/.mcp.json | head -1)`,
      // 没找到装出来的 .mcp.json 就说明缓存布局变了,残留种不下去——直接失败,不静默放过。
      'test -n "$f"',
      `sed -i 's/"tools"/"stale-tools"/' "$f"`,
    ].join("\n"),
  );
  if (res.exitCode !== 0) {
    throw new Error(`给下一条 attempt 种插件安装残留失败(exit ${res.exitCode}):\n${res.stdout}\n${res.stderr}`);
  }
};

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  plugins: [
    {
      marketplace: { name: MARKETPLACE, source: "./.fixtures/e2e-marketplace" },
      name: PLUGIN,
    },
  ],
  postSetup: [
    async (sb) => {
      await sb.runShell("timeout 60 npx -y @modelcontextprotocol/server-everything < /dev/null > /dev/null 2>&1 || true");
    },
  ],
  preTeardown: [staleInstalledPlugin],
});

export default defineExperiment({
  description: "plugin 安装收敛:复用沙箱的第二条 attempt 面对上一条留下的插件安装,仍按声明重装出自带的 MCP server",
  agent,
  model: "gpt-5.6-luna",
  sandbox: pluginSandbox,
  evals: (e) => e.id === "plugin-mcp",
  attempts: 2,
  sandboxReuse: true,
  // 两条 attempt 必须落在同一个沙箱上,残留才成立(复用契约:maxConcurrency > 1 时不保证谁与谁共用)。
  maxConcurrency: 1,
});
