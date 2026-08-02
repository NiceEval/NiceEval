import { defineEval } from "niceeval";
import { commandSucceeded, includes } from "niceeval/expect";
import { REPLY_DIRECTIVE, SKIP_BUILD_NOTE } from "../shared.ts";

const POSTSETUP_ORDER_LOG = "/tmp/niceeval-bub-postsetup-order.log";

// pythonPlugins + postSetup(docs/engineering/testing/e2e/adapter/bub.md):
//   1. postSetup 钩子按声明顺序执行,证据落进 POSTSETUP_ORDER_LOG(experiments/ci.ts)——
//      直接读文件断言顺序,不依赖模型这次怎么回答。
//   2. pythonPlugins 声明的包被真正装进 bub 自己的 uv tool venv(`uv tool install bub --with
//      cowsay`),用 uv 的标准 venv 布局直接验证可导入;同时也让 agent 自己跑一次同样的
//      命令,证明这条能力在真实协议路径上、不仅是宿主侧旁路检查里可用。
const VENV_PYTHON = "$HOME/.local/share/uv/tools/bub/bin/python";
const PLUGIN_CHECK_CMD = `${VENV_PYTHON} -c "import cowsay; print(cowsay.get_output_string('cow', 'PLUGIN_OK'))"`;

export default defineEval({
  description: "pythonPlugins 声明的包在 bub 自己的 tool venv 里可导入;postSetup 钩子按声明顺序执行",

  async test(t) {
    const order = await t.sandbox.readFile(POSTSETUP_ORDER_LOG);
    t.check(order, includes("first\nsecond"));

    const hostCheck = await t.sandbox.runShell(PLUGIN_CHECK_CMD);
    t.check(hostCheck, commandSucceeded());
    t.check(hostCheck.stdout, includes("PLUGIN_OK"));

    const turn = await t.send(
      `${SKIP_BUILD_NOTE}${REPLY_DIRECTIVE}请精确执行以下 shell 命令,把它的 stdout 原样贴回来,` +
        `不要输出其它内容:\n${PLUGIN_CHECK_CMD}`,
    );
    await turn.succeeded().stopOnFailure();
    t.calledTool("shell");
    t.messageIncludes("PLUGIN_OK");
  },
});
