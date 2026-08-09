import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

const SKILL_NAME = "niceeval-hermes-incident-report";
const DECOY_SKILL = "niceeval-hermes-decoy";
const MARKER = "HERMES-INCIDENT-REPORT-FORMAT-NICEEVAL-E2E-731";
const relPath = "incident-report.txt";

export default defineEval({
  description:
    "Skill 安装到 Hermes 原生目录后只选择匹配的 incident-report 约定",
  async test(t) {
    await t.group("两个本地 Skill 都安装到 Hermes 原生目录", async () => {
      const installed = await t.sandbox.runShell(
        `test -f "$HOME/.hermes/skills/${SKILL_NAME}/SKILL.md" && ` +
          `test -f "$HOME/.hermes/skills/${DECOY_SKILL}/SKILL.md"`,
      );
      t.assert(t.check(installed.exitCode, equals(0)));
    });

    const turn = await t.send(
      `Use the built-in skills tools to load only the installed skill named ${SKILL_NAME}; ` +
        `do not load ${DECOY_SKILL}. Then create ${relPath} as an incident report about ` +
        `"adapter evidence is complete", following the selected skill's convention exactly.`,
    );
    await t.require(turn.succeeded());

    await t.group("匹配的原生 Skill 被选择,decoy 没有误用", () => {
      t.assert(turn.loadedSkill(SKILL_NAME));
      t.assert(
        turn.eventsSatisfy("selected incident-report Skill without decoy", (events) =>
            events.every(
              (event) =>
                event.type !== "skill.loaded" || event.skill !== DECOY_SKILL,
            ),
          ),
      );
    });

    t.assert(t.sandbox.fileChanged(relPath));
    t.assert(t.check(t.sandbox.file(relPath), includes(MARKER)));
  },
});
