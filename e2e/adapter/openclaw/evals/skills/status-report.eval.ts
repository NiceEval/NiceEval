import { defineEval } from "niceeval";
import { includes, satisfies, toolMatch } from "niceeval/expect";
const SKILL_DIR = ".agents/skills";
const SKILL_NAME = "niceeval-status-report";
const DECOY_NAME = "niceeval-decoy";
const MARKER = "OPENCLAW-STATUS-REPORT-NICEEVAL-E2E-742";
const REPORT_PATH = "status-report.txt";
export default defineEval({
  description: "Skill 正调:只读取匹配的 status-report Skill，不误用 decoy",
  async test(t) {
    await t.group("安装痕迹:目标与 decoy Skill 都落在可发现目录", async () => {
      const installed = await t.sandbox.runShell(`ls ${SKILL_DIR}`);
      t.check(installed.stdout, includes(SKILL_NAME));
      t.check(installed.stdout, includes(DECOY_NAME));
    });
    const turn = await t.send(
      `先只用你的 shell 工具读取 ${SKILL_DIR}/${SKILL_NAME}/SKILL.md；` +
        `不要读取 ${SKILL_DIR}/${DECOY_NAME}/SKILL.md。然后创建 ${REPORT_PATH}，` +
        `内容是“all systems nominal”的 status report，并严格遵循刚读取的 Skill 约定。`,
    );
    await t.require(turn.succeeded());
    t.check(turn.noFailedActions());
    await t.group("选择痕迹:读取目标 Skill 的稳定路径，未读取 decoy", () => {
      t.check(
        turn.calledTool(
          toolMatch("shell", {
            input: satisfies(
              '"shell" input',
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                (typeof input["command"] === "string"
                  ? new RegExp(`${SKILL_DIR}/${SKILL_NAME}/SKILL\\.md`).test(
                      input["command"],
                    )
                  : new RegExp(`${SKILL_DIR}/${SKILL_NAME}/SKILL\\.md`).test(
                      JSON.stringify(input) ?? "",
                    )),
            ),
            status: "completed",
          }),
        ),
      );
      t.check(
        turn.notCalledTool(
          toolMatch("shell", {
            input: satisfies(
              '"shell" input',
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                (typeof input["command"] === "string"
                  ? new RegExp(`${SKILL_DIR}/${DECOY_NAME}/SKILL\\.md`).test(
                      input["command"],
                    )
                  : new RegExp(`${SKILL_DIR}/${DECOY_NAME}/SKILL\\.md`).test(
                      JSON.stringify(input) ?? "",
                    )),
            ),
          }),
        ),
      );
      t.check(
        turn.events,
        satisfies<typeof turn.events>(
          "任何工具的 input 均未引用 decoy Skill 文件",
          (events) =>
            events.every(
              (event) =>
                event.type !== "operation.started" ||
                event.operation.kind !== "tool" ||
                !JSON.stringify(event.operation.input).includes(
                  `${SKILL_DIR}/${DECOY_NAME}/SKILL.md`,
                ),
            ),
        ),
      );
      t.check(
        turn.events,
        satisfies<typeof turn.events>("no skill.loaded event", (events) =>
          events.every((event) => event.type !== "skill.loaded"),
        ),
      );
    });
    await t.group("Skill 内容影响产物", () => {
      t.check(t.sandbox.fileChanged(REPORT_PATH));
      t.check(t.sandbox.file(REPORT_PATH), includes(MARKER));
    });
  },
});
