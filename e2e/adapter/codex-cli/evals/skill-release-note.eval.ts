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
      `Use shell commands to read ${SKILL_DIR}/${SKILL_NAME}/SKILL.md. ` +
        `Then create ${relPath} announcing "adapter skill matrix expanded", following only that convention. ` +
        `Before finishing, use a shell command to print ${relPath} and verify that it exists and contains the required marker.`,
    );
    await turn.succeeded().orStop();
    t.check(
      turn.events,
      satisfies<typeof turn.events>(
        "no failed tool or subagent actions",
        (events) =>
          events.every(
            (event) =>
              event.type !== "operation.finished" ||
              event.status !== "failed",
          ),
      ),
    );
    turn.calledTool(
      toolMatch("shell", {
        input: satisfies(
          `shell 入参引用 ${SKILL_DIR}/${SKILL_NAME}`,
          (input) =>
            typeof input === "object" &&
            input !== null &&
            !Array.isArray(input) &&
            (typeof (input as Record<string, unknown>)["command"] === "string"
              ? new RegExp(`${SKILL_DIR}/${SKILL_NAME}`).test(
                  (input as Record<string, unknown>)["command"] as string,
                )
              : new RegExp(`${SKILL_DIR}/${SKILL_NAME}`).test(
                  JSON.stringify(input) ?? "",
                )),
        ),
        status: "completed",
      }),
    );
    for (const other of OTHER_SKILLS) {
      turn.notCalledTool(
        toolMatch("shell", {
          input: satisfies(
            `shell 入参未引用 ${SKILL_DIR}/${other}`,
            (input) =>
              typeof input === "object" &&
              input !== null &&
              !Array.isArray(input) &&
              (typeof (input as Record<string, unknown>)["command"] === "string"
                ? new RegExp(`${SKILL_DIR}/${other}`).test(
                    (input as Record<string, unknown>)["command"] as string,
                  )
                : new RegExp(`${SKILL_DIR}/${other}`).test(
                    JSON.stringify(input) ?? "",
                  )),
          ),
        }),
      );
    }
    t.check(
      turn.events,
      satisfies<typeof turn.events>("no skill.loaded event", (events) =>
        events.every((event) => event.type !== "skill.loaded"),
      ),
    );
    t.check(
      t.events,
      satisfies<typeof t.events>("no skill.loaded event", (events) =>
        events.every((event) => event.type !== "skill.loaded"),
      ),
    );
    const content = await t.sandbox.readText(relPath);
    t.check(content, includes(MARKER));
  },
});
