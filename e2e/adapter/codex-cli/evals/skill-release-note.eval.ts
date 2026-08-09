// Codex 没有 skill.loaded，一条 Skill 的正调由「只读取目标文件 + 采用独有 marker」证明；
// 未读取其它已安装 Skill 是同一轮里的反选证据。
import { defineEval } from "niceeval";
import { includes, satisfies, toolMatch } from "niceeval/expect";

const SKILL_DIR = ".agents/skills";
const SKILL_NAME = "niceeval-release-note";
const OTHER_SKILLS = ["niceeval-status-report", "niceeval-decoy"] as const;
const MARKER = "RELEASE-NOTE-FORMAT-NICEEVAL-E2E-731";
const relPath = "release-note.txt";

export default defineEval({
  description:
    "Skill 正调:release note 只读取对应 Skill，不误读 status / decoy",
  async test(t) {
    const turn = await t.send(
      `Check the installed skill or guide specifically for writing a release note file under ${SKILL_DIR}/. ` +
        `Then create ${relPath} announcing "adapter skill matrix expanded", following only that matching convention.`,
    );
    await t.require(turn.succeeded());
    t.assert(turn.noFailedActions());

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
                ? new RegExp(`${SKILL_DIR}/${SKILL_NAME}`).test(
                    input["command"],
                  )
                : new RegExp(`${SKILL_DIR}/${SKILL_NAME}`).test(
                    JSON.stringify(input) ?? "",
                  )),
          ),
          status: "completed",
        }),
      ),
    );
    for (const other of OTHER_SKILLS) {
      t.assert(
        turn.notCalledTool(
          toolMatch("shell", {
            input: satisfies(
              '"shell" input',
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                (typeof input["command"] === "string"
                  ? new RegExp(`${SKILL_DIR}/${other}`).test(input["command"])
                  : new RegExp(`${SKILL_DIR}/${other}`).test(
                      JSON.stringify(input) ?? "",
                    )),
            ),
          }),
        ),
      );
    }
    t.assert(
      turn.eventsSatisfy("no skill.loaded event", (events) =>
          events.every((event) => event.type !== "skill.loaded"),
      ),
    );
    t.assert(
      t.eventsSatisfy("no skill.loaded event", (events) =>
          events.every((event) => event.type !== "skill.loaded"),
      ),
    );
    t.assert(t.sandbox.fileChanged(relPath));
    t.assert(t.check(t.sandbox.file(relPath), includes(MARKER)));
  },
});
