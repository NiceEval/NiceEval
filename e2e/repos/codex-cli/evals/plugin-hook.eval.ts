// 协议行为:Plugins 与 hook 信任——marketplace 安装的 Plugin 行为可观察,其 hook 在 bypass
// 信任姿态下确实生效(见 docs/engineering/e2e-ci/adapters/codex-cli.md)。
//
// 安装痕迹:agent-setup.json 的 nativePlugins 记录与 codex 自己的 plugin cache 目录都要对得上
// (镜像 e2e/projects/codex 里 native-plugin-installed.eval.ts 的既有做法)。
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
const MARKETPLACE_SOURCE = "CorrectRoadH/niceeval-e2e-codex-hook-fixture";
const MARKETPLACE_REF = "343b07bc8b204cd7f524d2dd4367f83409c98c29";
const PLUGIN_NAME = "hook-demo";
const PLUGIN_VERSION = "0.1.0";
const HOOK_SENTINEL = "NICEEVAL_HOOK_SENTINEL_926";

export default defineEval({
  description: "Plugin 安装 + hook 信任 bypass:manifest/磁盘安装痕迹俱全,SessionStart hook 真实执行留下证据",
  async test(t) {
    await t.group("安装痕迹:agent-setup.json manifest 与真实安装文件都对得上", async () => {
      const manifestRaw = await t.sandbox.readFile("__niceeval__/agent-setup.json");
      const manifest = JSON.parse(manifestRaw) as {
        nativePlugins?: {
          agent?: string;
          marketplace?: { name?: string; source?: string; ref?: string };
          name?: string;
          resolvedVersion?: string;
        }[];
      };
      const plugin = manifest.nativePlugins?.[0];
      t.check(plugin?.agent, equals("codex"));
      t.check(plugin?.marketplace?.name, equals(MARKETPLACE_NAME));
      t.check(plugin?.marketplace?.source, equals(MARKETPLACE_SOURCE));
      t.check(plugin?.marketplace?.ref, equals(MARKETPLACE_REF));
      t.check(plugin?.name, equals(PLUGIN_NAME));
      t.check(plugin?.resolvedVersion, equals(PLUGIN_VERSION));

      const check = await t.sandbox.runShell(
        `test -f ~/.codex/plugins/cache/${MARKETPLACE_NAME}/${PLUGIN_NAME}/${PLUGIN_VERSION}/hooks.json`,
      );
      t.check(check.exitCode, equals(0));
    });

    // 便宜的收尾轮:证明 attempt 真的跑通了 agent,同时是 hook 在真实 session 里执行的载体
    // ——SessionStart 钩子在这轮的第一条消息之前就已经跑过。
    const turn = await t.send('Say "ok" and nothing else. Do not run any commands or read any files.');
    turn.expectOk();
    t.succeeded();

    await t.group("hook 证据:SessionStart 钩子的输出真的落进了 Codex 自己的 session 记录", async () => {
      const probe = await t.sandbox.runShell(
        `f=$(find ~/.codex/sessions -name "*${t.sessionId}*.jsonl" | head -1); test -n "$f" && cat "$f"`,
      );
      t.check(probe.exitCode, equals(0));
      t.check(probe.stdout, includes(HOOK_SENTINEL));
    });
  },
});
