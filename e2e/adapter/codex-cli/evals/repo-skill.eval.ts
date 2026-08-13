import { defineEval } from "niceeval";
import { equals, includes, satisfies } from "niceeval/expect";
const SKILL_NAME = "calibre";
const SKILL_PATH = `.agents/skills/${SKILL_NAME}/SKILL.md`;
const DECOY_SKILL_PATH = ".agents/skills/niceeval-decoy/SKILL.md";
const EXPECTED_COMMAND = "ebook-convert novel.epub novel.azw3";
export default defineEval({
  description:
    "Repo Skill:钉定 Git 来源安装后被 Codex 读取，并采用远程 Skill 的命令约定",
  async test(t) {
    await t.group("远程 Skill 文件进入 Codex 发现目录", async () => {
      const installed = await t.sandbox.runShell(
        `test -f ${SKILL_PATH} && test -f ${DECOY_SKILL_PATH} && grep -F 'ebook-convert' ${SKILL_PATH}`,
      );
      t.check(installed.exitCode, equals(0));
      t.check(installed.stdout, includes("ebook-convert"));
    });
    const turn = await t.send(
      `Inspect the installed ${SKILL_PATH} guide, then tell me the exact one-line command that converts ` +
        "novel.epub to novel.azw3. Do not run the conversion or create files.",
    );
    await turn.succeeded().orStop();
    turn.calledTool("shell", {
      input: (input) =>
        typeof input === "object" &&
        input !== null &&
        !Array.isArray(input) &&
        (typeof (input as Record<string, unknown>)["command"] === "string"
          ? new RegExp(SKILL_PATH).test(
              (input as Record<string, unknown>)["command"] as string,
            )
          : new RegExp(SKILL_PATH).test(JSON.stringify(input) ?? "")),
      status: "completed",
    });
    turn.calledTool("shell", {
      input: (input) =>
        typeof input === "object" &&
        input !== null &&
        !Array.isArray(input) &&
        (typeof (input as Record<string, unknown>)["command"] === "string"
          ? new RegExp(DECOY_SKILL_PATH).test(
              (input as Record<string, unknown>)["command"] as string,
            )
          : new RegExp(DECOY_SKILL_PATH).test(JSON.stringify(input) ?? "")),
      count: 0,
    });
    t.check(
      turn.events,
      satisfies<typeof turn.events>("no skill.loaded event", (events) =>
        events.every((event) => event.type !== "skill.loaded"),
      ),
    );
    t.check(turn.message, includes(EXPECTED_COMMAND));
    t.check(
      t.events,
      satisfies<typeof t.events>(
        "no failed tool or subagent actions",
        (events) =>
          events.every(
            (event) =>
              event.type !== "operation.finished" ||
              event.status !== "failed",
          ),
      ),
    );
  },
});
