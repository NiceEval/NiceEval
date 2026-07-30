// Plugin 安装收敛 × Sandbox 复用(docs/engineering/testing/e2e/adapter/codex-cli.md 的
// Plugins 行)。一个沙箱依次承接两条 attempt:workdir 回到题间重置点,$HOME 带着上一条
// attempt 的 marketplace 注册与插件安装进场,agent setup 每条 attempt 重跑一次。
//
// 残留由 preTeardown 种下:本条 attempt 的证据收完之后,把同名 marketplace 改注册成同一个
// 仓库的浮动 ref。codex 把「同名、来源字符串不同」的 add 直接判错
// (`Error: marketplace 'niceeval-e2e-plugins' is already added from a different source`,
// 真机 codex-cli 0.146.0 复现),真实生态里插件自带的 install 脚本改写注册也落到同一个报错上。
// 第二条 attempt 因此只有在安装步骤先摘除同名注册与同名安装、再按声明的 source 与 ref 重装时
// 才跑得起来。种在 preTeardown 而不是 postSetup:残留是留给下一条 attempt 的,本条 attempt 的
// 断言仍跑在按声明装出来的那份安装上。
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import type { SandboxHook } from "niceeval/sandbox";

const MARKETPLACE = "niceeval-e2e-plugins";
const SOURCE = "CorrectRoadH/niceeval-e2e-codex-hook-fixture";
const REF = "343b07bc8b204cd7f524d2dd4367f83409c98c29";
const PLUGIN = "hook-demo";

const rewriteMarketplaceSource: SandboxHook = async (sb) => {
  const res = await sb.runShell(
    [
      "set -e",
      `codex plugin remove ${PLUGIN}@${MARKETPLACE}`,
      `codex plugin marketplace remove ${MARKETPLACE}`,
      `codex plugin marketplace add ${SOURCE} --ref main`,
      `codex plugin add ${PLUGIN}@${MARKETPLACE}`,
    ].join("\n"),
  );
  if (res.exitCode !== 0) {
    throw new Error(
      `给下一条 attempt 种同名不同源的 marketplace 残留失败(exit ${res.exitCode}):\n${res.stdout}\n${res.stderr}`,
    );
  }
};

const agent = codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  plugins: [{ marketplace: { name: MARKETPLACE, source: SOURCE, ref: REF }, name: PLUGIN }],
  preTeardown: [rewriteMarketplaceSource],
});

export default defineExperiment({
  description: "codex-cli Plugin 安装收敛:复用沙箱的第二条 attempt 面对同名不同源的 marketplace 残留,仍按声明装出插件",
  agent,
  model: "gpt-5.4-mini",
  evals: ["plugin-hook"],
  attempts: 2,
  sandboxReuse: true,
  // 两条 attempt 必须落在同一个沙箱上,残留才成立(复用契约:maxConcurrency > 1 时不保证谁与谁共用)。
  maxConcurrency: 1,
  budget: 4,
});
