import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

const SKILL_NAME = "calibre";
const SKILL_PATH = `.claude/skills/${SKILL_NAME}/SKILL.md`;
const EXPECTED_COMMAND = "ebook-convert novel.epub novel.azw3";

export default defineEval({
  description:
    "Repo Skill:钉定 Git 来源安装后被 Claude 原生加载，并采用远程 Skill 的命令约定",
  async test(t) {
    await t.group("远程 Skill 文件进入 Claude 项目级发现目录", async () => {
      const installed = await t.sandbox.runShell(
        `test -f ${SKILL_PATH} && grep -F 'ebook-convert' ${SKILL_PATH}`,
      );
      t.assert(t.check(installed.exitCode, equals(0)));
      t.assert(t.check(installed.stdout, includes("ebook-convert")));
    });

    const turn = await t.send(
      "Use the installed calibre Skill to tell me the exact one-line command that converts " +
        "novel.epub to novel.azw3. Do not run the command or create files.",
    );
    await t.require(turn.succeeded());
    t.assert(turn.loadedSkill(SKILL_NAME));
    t.assert(t.check(turn.message, includes(EXPECTED_COMMAND)));
    t.assert(t.noFailedActions());
  },
});
