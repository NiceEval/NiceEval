import { defineEval } from "niceeval";
import {
  equals,
  excludes,
  includes,
  satisfies,
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
      t.check(installed.exitCode, equals(0));
    });
    const turn = await t.send(
      `Before writing a status report, inspect only the applicable Skill under ${SKILL_DIR}/; ` +
        "do not inspect another Skill. " +
        `Create ${reportPath} saying "all systems nominal" and follow the selected Skill exactly.`,
    );
    await turn.succeeded().orStop();
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
    await t.group("OpenCode 原生 skill 工具归一为目标 skill.loaded，且没有加载 decoy", () => {
      t.check(
        turn.events,
        satisfies<typeof turn.events>(
          `loaded ${STATUS_SKILL}`,
          (events) =>
            events.some(
              (event) => event.type === "skill.loaded" && event.skill === STATUS_SKILL,
            ),
        ),
      );
      t.check(
        turn.events,
        satisfies<typeof turn.events>(
          `did not load ${DECOY_SKILL}`,
          (events) =>
            events.every(
              (event) =>
                event.type !== "skill.loaded" || event.skill !== DECOY_SKILL,
            ),
        ),
      );
    });
    await t.group("选中的 Skill 约定进入实际产物，decoy 约定未进入", async () => {
      const content = await t.sandbox.readText(reportPath);
      t.check(content, includes(STATUS_MARKER));
      t.check(content, excludes(DECOY_MARKER));
    });
  },
});
