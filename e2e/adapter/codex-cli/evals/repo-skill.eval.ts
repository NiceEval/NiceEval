import { defineEval } from "niceeval";
import { equals, includes, satisfies, toolMatch } from "niceeval/expect";

const SKILL_NAME = "calibre";
const SKILL_PATH = `.agents/skills/${SKILL_NAME}/SKILL.md`;
const EXPECTED_COMMAND = "ebook-convert novel.epub novel.azw3";

export default defineEval({
  description:
    "Repo Skill:钉定 Git 来源安装后被 Codex 读取，并采用远程 Skill 的命令约定",
  async test(t) {
    await t.group("远程 Skill 文件进入 Codex 发现目录", async () => {
      const installed = await t.sandbox.runShell(
        `test -f ${SKILL_PATH} && grep -F 'ebook-convert' ${SKILL_PATH}`,
      );
      t.assert(t.check(installed.exitCode, equals(0)));
      t.assert(t.check(installed.stdout, includes("ebook-convert")));
    });

    const turn = await t.send(
      `Inspect the installed ${SKILL_PATH} guide, then tell me the exact one-line command that converts ` +
        "novel.epub to novel.azw3. Do not run the conversion or create files.",
    );
    await t.require(turn.succeeded());
    t.assert(
      turn.calledTool(
        toolMatch("shell", {
          input: satisfies(
            '"shell" input',
            (input) =>
              typeof input === "object" &&
              input !== null &&
              !Array.isArray(input) &&
              (typeof input["command"] === "string"
                ? new RegExp(SKILL_PATH).test(input["command"])
                : new RegExp(SKILL_PATH).test(JSON.stringify(input) ?? "")),
          ),
          status: "completed",
        }),
      ),
    );
    t.assert(
      turn.eventsSatisfy("no skill.loaded event", (events) =>
          events.every((event) => event.type !== "skill.loaded"),
      ),
    );
    t.assert(t.check(turn.message, includes(EXPECTED_COMMAND)));
    t.assert(t.noFailedActions());
  },
});
