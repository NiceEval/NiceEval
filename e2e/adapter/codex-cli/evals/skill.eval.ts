// 协议行为:Skills——Skill 写入可发现目录后,验证走**读取行为**(事件流中出现对 Skill 文件
// 的读取)或 Skill 特有结果——不假设存在 Claude Code 式的自动加载事件(见
// docs/engineering/testing/e2e/adapter/codex-cli.md)。
//
// codex 没有原生 Skill 工具,不显式提示"检查有没有 skill/guide 文件"就几乎不会主动去读装好
// 的 skill(见 memory/codex-no-native-skill-tool.md)——prompt 里必须点名这一步。
// 断言双重把关:(a) 行为痕迹——真的用 shell 读过 skill 文件;(b) 结果痕迹——落盘内容确实
// 采用了 skill 里那条只存在于该文件、模型不可能凭空猜到的约定标记。
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

const SKILL_DIR = ".agents/skills";
const SKILL_NAME = "niceeval-status-report";
const MARKER = "STATUS-REPORT-FORMAT-NICEEVAL-E2E-914";
const relPath = "status.txt";

export default defineEval({
  description: "Skill 正调:装了 niceeval-status-report 之后确实被读取并落进产出内容",
  async test(t) {
    // 安装痕迹从沙箱里真实存在的文件读:清单本身只在宿主侧(attempt artifact agent-setup.json),
    // eval 够不着它,也不该够得着——沙箱里没有任何框架文件。
    await t.group("安装痕迹:skill 文件真的装进了可发现目录", async () => {
      const installed = await t.sandbox.runShell(`ls ${SKILL_DIR}`);
      t.check(installed.stdout, includes(SKILL_NAME));
    });

    const turn = await t.send(
      `Check whether this repository has a skill or guide file about writing a "status report" file ` +
        `before you answer — look under ${SKILL_DIR}/ if such a directory exists. ` +
        `Then create a file named ${relPath} that is a status report saying "all systems nominal", ` +
        `following whatever convention you found.`,
    );
    turn.expectOk();
    t.noFailedActions();

    await t.group("行为痕迹:真的用 shell 读过这个 skill 的文件", () => {
      t.calledTool("shell", {
        status: "completed",
        input: { command: new RegExp(`${SKILL_DIR}/${SKILL_NAME}`) },
      });
    });

    await t.group("结果痕迹:产出文件采用了 skill 里的约定标记", () => {
      t.sandbox.fileChanged(relPath);
      t.check(t.sandbox.file(relPath), includes(MARKER));
    });
  },
});
