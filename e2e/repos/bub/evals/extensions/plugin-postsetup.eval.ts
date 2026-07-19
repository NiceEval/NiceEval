import { defineEval } from "niceeval";
import { commandSucceeded, includes } from "niceeval/expect";
import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";
import { POSTSETUP_ORDER_LOG } from "../../agents/bub.ts";

// pythonPlugins + postSetup(docs/engineering/e2e-ci/adapters/bub.md):
//   1. postSetup 钩子按声明顺序执行,证据落进 POSTSETUP_ORDER_LOG(agents/bub.ts)——
//      直接读文件断言顺序,不依赖模型这次怎么回答。
//   2. pythonPlugins 声明的包被真正装进 bub 自己的 uv tool venv(`uv tool install bub --with
//      cowsay`),用 uv 的标准 venv 布局直接验证可导入;同时也让 agent 自己跑一次同样的
//      命令,证明这条能力在真实协议路径上、不仅是宿主侧旁路检查里可用。
const VENV_PYTHON = "$HOME/.local/share/uv/tools/bub/bin/python";
const PLUGIN_CHECK_CMD = `${VENV_PYTHON} -c "import cowsay; print(cowsay.get_output_string('cow', 'PLUGIN_OK'))"`;

export default defineEval({
  description: "pythonPlugins package is importable in bub's own tool venv; postSetup hooks ran in declared order",

  async test(t) {
    const order = await t.sandbox.readFile(POSTSETUP_ORDER_LOG);
    t.check(order, includes("first\nsecond"));

    const hostCheck = await t.sandbox.runShell(PLUGIN_CHECK_CMD);
    t.check(hostCheck, commandSucceeded());
    t.check(hostCheck.stdout, includes("PLUGIN_OK"));

    const turn = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}Run exactly this shell command and paste back its exact stdout, ` +
        `nothing else:\n${PLUGIN_CHECK_CMD}`,
    );
    turn.expectOk();
    t.calledTool("shell");
    t.messageIncludes("PLUGIN_OK");
  },
});
