import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

const MARKETPLACE = "claude-plugins-official";
const PLUGIN = "frontend-design";
const LIVE_MARKER = "CLAUDE-REMOTE-PLUGIN-E2E-731";

export default defineEval({
  description:
    "远程 Plugin:官方 marketplace 安装文件存在，Plugin 自带 Skill 可加载并完成真实请求",
  async test(t) {
    await t.group(
      "Claude Plugin cache 包含远程 marketplace 安装的 Skill",
      async () => {
        const cache = `~/.claude/plugins/cache/${MARKETPLACE}/${PLUGIN}`;
        const installed = await t.sandbox.runShell(
          `find ${cache} -path '*/skills/frontend-design/SKILL.md' -type f | head -1`,
        );
        t.assert(t.check(installed.exitCode, equals(0)));
        t.assert(
          t.check(
            installed.stdout,
            includes("skills/frontend-design/SKILL.md"),
          ),
        );
      },
    );

    const turn = await t.send(
      `Use the installed frontend-design Skill, then reply with exactly ${LIVE_MARKER}. ` +
        "Do not use tools or edit files.",
    );
    await t.require(turn.succeeded());
    t.assert(turn.loadedSkill("frontend-design:frontend-design"));
    t.assert(t.check(turn.message, includes(LIVE_MARKER)));
    t.assert(t.noFailedActions());
  },
});
