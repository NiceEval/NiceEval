import { defineEval } from "niceeval";
import {
  equals,
  excludes,
  includes,
  satisfies,
  toolMatch,
} from "niceeval/expect";

const SKILL_DIR = ".agents/skills";
const STATUS_SKILL = "niceeval-opencode-status-report";
const DECOY_SKILL = "niceeval-opencode-decoy";
const STATUS_MARKER = "OPENCODE-STATUS-REPORT-NICEEVAL-E2E-914";
const DECOY_MARKER = "OPENCODE-DECOY-AUDIT-NICEEVAL-E2E-518";
const reportPath = "status-report.txt";

export default defineEval({
  description: "status-report skill 已安装、被选择，且不会误用 decoy",
  async test(t) {
    await t.group("两个 Skill 都真实安装到 OpenCode 的发现目录", async () => {
      const installed = await t.sandbox.runShell(
        `test -f ${SKILL_DIR}/${STATUS_SKILL}/SKILL.md && test -f ${SKILL_DIR}/${DECOY_SKILL}/SKILL.md`,
      );
      t.assert(t.check(installed.exitCode, equals(0)));
    });

    const turn = await t.send(
      `Before writing a status report, inspect only the applicable Skill under ${SKILL_DIR}/; ` +
        "do not inspect another Skill. " +
        `Create ${reportPath} saying "all systems nominal" and follow the selected Skill exactly.`,
    );
    await t.require(turn.succeeded());
    t.assert(t.noFailedActions());

    await t.group("OpenCode 原生 skill 工具选择目标，且没有选择 decoy", () => {
      t.assert(
        turn.calledTool(
          toolMatch("skill", {
            input: satisfies(
              '"skill" input',
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                Object.is(input["name"], STATUS_SKILL),
            ),
          }),
        ),
      );
      t.assert(
        turn.notCalledTool(
          toolMatch("skill", {
            input: satisfies(
              '"skill" input',
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                Object.is(input["name"], DECOY_SKILL),
            ),
          }),
        ),
      );
      t.assert(
        turn.eventsSatisfy("任何工具的 input 均未引用 decoy Skill", (events) =>
            events.every(
              (event) =>
                event.type !== "operation.started" ||
                event.operation.kind !== "tool" ||
                !JSON.stringify(event.operation.input).includes(DECOY_SKILL),
            ),
          ),
      );
    });

    await t.group("选中的 Skill 约定进入实际产物，decoy 约定未进入", () => {
      t.assert(t.sandbox.fileChanged(reportPath));
      t.assert(t.check(t.sandbox.file(reportPath), includes(STATUS_MARKER)));
      t.assert(t.check(t.sandbox.file(reportPath), excludes(DECOY_MARKER)));
    });
  },
});
