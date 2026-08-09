// Codex 没有 skill.loaded，一条 Skill 的正调由「只读取目标文件 + 采用独有 marker」证明；
// 未读取其它已安装 Skill 是同一轮里的反选证据。
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

const SKILL_DIR = ".agents/skills";
const SKILL_NAME = "niceeval-release-note";
const OTHER_SKILLS = ["niceeval-status-report", "niceeval-decoy"] as const;
const MARKER = "RELEASE-NOTE-FORMAT-NICEEVAL-E2E-731";
const relPath = "release-note.txt";

export default defineEval({
  description: "Skill 正调:release note 只读取对应 Skill，不误读 status / decoy",
  async test(t) {
    const turn = await t.send(
      `Check the installed skill or guide specifically for writing a release note file under ${SKILL_DIR}/. ` +
        `Then create ${relPath} announcing "adapter skill matrix expanded", following only that matching convention.`,
    );
    await turn.succeeded().stopOnFailure();
    turn.noFailedActions();

    turn.calledTool("shell", {
      status: "completed",
      input: { command: new RegExp(`${SKILL_DIR}/${SKILL_NAME}`) },
    });
    for (const other of OTHER_SKILLS) {
      turn.notCalledTool("shell", { input: { command: new RegExp(`${SKILL_DIR}/${other}`) } });
    }
    turn.notEvent("skill.loaded");
    t.notEvent("skill.loaded");
    t.sandbox.fileChanged(relPath);
    t.check(t.sandbox.file(relPath), includes(MARKER));
  },
});
