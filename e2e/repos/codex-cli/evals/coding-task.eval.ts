// 协议行为:coding 任务工具轨——真实任务下 `codex exec --json` 的结构化 stdout 归一出命令
// 与文件工具事件,优先按显式 call ID 配对(见 src/o11y/parsers/codex.ts:command_execution /
// file_change 分支,call id 来自 item.id)。一个 Eval 里同时验两种编码工具形态(改文件 + 跑
// 命令),不为每种形态各开一条 Eval(见 docs/engineering/e2e-ci/adapters/README.md「仓库 Eval
// 预算」)。codex 在 Docker Sandbox 里跑,没有 host 工作目录,文件断言一律走 t.sandbox.*。
//
// 两处设计都来自本仓库设计阶段的真机复现(codex-cli 0.144.1):
// 1. 用"修改既有文件"而不是"从无创建文件"来触发 file_edit——"创建一个只有一行内容的新文件"
//    这类极简任务,codex 经常图省事直接用一条 shell 命令(`printf ... > file`)写出去,整轮
//    只留下 command_execution,不产生 file_change item;"精确替换既有文件中的一行"则稳定
//    触发 apply_patch(file_change,kind:"update"→file_edit)。
// 2. 两个动作必须在**同一轮**里发起,不能拆成两个 t.send():`codex exec --json` 的 item.id
//    按单次进程调用从零编号,`codex exec resume` 续接的下一轮是一个新进程,同样从头编号——
//    两轮各自的工具调用可能巧合落在同一个 item 号上,call ID 在这条会话的累积事件流里发生
//    碰撞,导致按 call ID 配对结果与调用错位(同类问题见 evals/mcp.eval.ts 的说明)。
import { defineEval } from "niceeval";
import { excludes, includes } from "niceeval/expect";

const relPath = "niceeval-e2e-coding-task.txt";
const oldMarker = "niceeval-e2e-old-914";
const newMarker = "niceeval-e2e-new-914";
const cmdMarker = "niceeval-e2e-run-914";
const seed = `alpha\n${oldMarker}\nomega\n`;

export default defineEval({
  description: "coding 任务工具轨:文件变更(改既有文件)与 shell 调用都归一进标准事件流,调用与结果配对成立",
  async test(t) {
    await t.sandbox.writeFiles({ [relPath]: seed });

    const turn = await t.send(
      `在当前工作目录里做两件事:` +
        `(1) 把 ${relPath} 中的 ${oldMarker} 改成 ${newMarker},其它内容保持不变;` +
        `(2) 跑 \`echo ${cmdMarker}\`,把命令的输出告诉我。`,
    );
    turn.expectOk();

    t.noFailedActions();

    await t.group("文件变更事件已归一,调用与结果配对", () => {
      t.calledTool("file_edit", { status: "completed", input: { path: new RegExp(relPath) } });
    });
    await t.group("shell 调用已归一,调用与结果配对", () => {
      t.calledTool("shell", { status: "completed", input: { command: new RegExp(cmdMarker) } });
    });

    turn.messageIncludes(cmdMarker);

    // 双重核实:沙箱磁盘上的文件内容也要对得上(不是只信事件流自称)——目标行换了,其余行原样。
    t.sandbox.fileChanged(relPath);
    await t.group("目标行换了,其余行原样", () => {
      t.check(t.sandbox.file(relPath), includes(newMarker));
      t.check(t.sandbox.file(relPath), excludes(oldMarker));
      t.check(t.sandbox.file(relPath), includes("alpha"));
      t.check(t.sandbox.file(relPath), includes("omega"));
    });
  },
});
