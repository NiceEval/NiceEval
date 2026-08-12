// 协议行为:Plugins 与 hook 信任——marketplace 安装的 Plugin 行为可观察,其 hook 在 bypass
// 信任姿态下确实生效(见 docs/engineering/testing/e2e/adapter/codex-cli.md)。
//
// 安装痕迹从 codex 自己的 plugin cache 目录读(镜像 e2e/projects/codex 里
// native-plugin-installed.eval.ts 的既有做法);安装清单是宿主侧 attempt artifact,不进沙箱。
//
// hook 证据:CorrectRoadH/niceeval-e2e-codex-hook-fixture 的 hook-demo 插件只有一个
// SessionStart 钩子,内容是 `echo NICEEVAL_HOOK_SENTINEL_926`。Codex 把 SessionStart 命令钩子
// 的纯文本 stdout 折叠成一条 developer 角色消息、注入模型上下文,但**不会**把这次注入本身
// 作为 `codex exec --json` stdout 里的一个可见 item(本仓库设计阶段已用真实 codex-cli 0.144.1
// 在本机核对过:--json 事件流里没有独立的 hook item,注入只出现在 Codex 自己侧写的 session
// rollout 文件里)。真实证据因此从产物读,不是从模型复述读——模型不一定会在回复里主动提起
// 一条 developer 消息;能不能读到 developer 消息本身,才是"hook 真的执行了"而不是"被 headless
// 下的信任门槛静默跳过"(见 memory/codex-hook-trust-headless-silent-skip.md)的真实证据。
import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

const MARKETPLACE_NAME = "niceeval-e2e-plugins";
const PLUGIN_NAME = "hook-demo";
const PLUGIN_VERSION = "0.1.0";
const HOOK_SENTINEL = "NICEEVAL_HOOK_SENTINEL_926";

export default defineEval({
  description:
    "Plugin 安装 + hook 信任 bypass:磁盘安装痕迹俱全,SessionStart hook 真实执行留下证据",
  async test(t) {
    // 安装痕迹从 codex 自己的 plugin cache 目录读:安装清单只在宿主侧(attempt artifact
    // agent-setup.json),沙箱里没有任何框架文件,eval 也不该从沙箱里去读它。
    await t.group(
      "安装痕迹:codex 自己的 plugin cache 里装到了指定版本",
      async () => {
        const cacheDir = `~/.codex/plugins/cache/${MARKETPLACE_NAME}/${PLUGIN_NAME}`;
        const versions = await t.sandbox.runShell(`ls ${cacheDir}`);
        t.check(versions.stdout, includes(PLUGIN_VERSION));

        const check = await t.sandbox.runShell(
          `test -f ${cacheDir}/${PLUGIN_VERSION}/hooks.json`,
        );
        t.check(check.exitCode, equals(0));
      },
    );

    // 便宜的收尾轮:证明 attempt 真的跑通了 agent,同时是 hook 在真实 session 里执行的载体
    // ——SessionStart 钩子在这轮的第一条消息之前就已经跑过。
    const turn = await t.send(
      'Say "ok" and nothing else. Do not run any commands or read any files.',
    );
    await turn.succeeded().orStop();
    t.succeeded().label("attempt 完成");

    await t.group(
      "hook 证据:SessionStart 钩子的输出真的落进了 Codex 自己的 session 记录",
      async () => {
        const probe = await t.sandbox.runShell(
          `f=$(find ~/.codex/sessions -name "*${t.sessionId}*.jsonl" | head -1); test -n "$f" && cat "$f"`,
        );
        t.check(probe.exitCode, equals(0));
        t.check(probe.stdout, includes(HOOK_SENTINEL));
      },
    );
  },
});
