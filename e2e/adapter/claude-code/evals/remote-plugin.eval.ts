import { defineEval } from "niceeval";
import { equals, includes, satisfies } from "niceeval/expect";

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
        t.check(installed.exitCode, equals(0));
        t.check(installed.stdout, includes("skills/frontend-design/SKILL.md"));
      },
    );

    const turn = await t.send(
      `Use the installed frontend-design Skill, then reply with exactly ${LIVE_MARKER}. ` +
        "Do not use tools or edit files.",
    );
    await turn.succeeded().orStop();
    t.check(
      turn.events,
      satisfies<typeof turn.events>(
        "loaded skill frontend-design:frontend-design",
        (events) =>
          events.some(
            (event) =>
              event.type === "skill.loaded" &&
              event.skill === "frontend-design:frontend-design",
          ),
      ),
    );
    t.check(turn.message, includes(LIVE_MARKER));
    t.check(
      t.events,
      satisfies<typeof t.events>(
        "no failed tool or subagent actions",
        (events) =>
          !events.some(
            (event) =>
              event.type === "operation.finished" && event.status === "failed",
          ),
      ),
    );
  },
});
