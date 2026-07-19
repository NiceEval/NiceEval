// 协议行为:coding tool——command execution 与文件变更事件都进入标准事件流,调用与结果配对成立。
// 一个 Eval 里同时验两种编码工具形态(写文件 + 跑命令),不为每种形态各开一条 Eval
// (见 docs/engineering/e2e-ci/adapters/README.md「仓库 Eval 预算」)。
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_DIR } from "../agents/codex-sdk.ts";

const relPath = "niceeval-e2e-coding-tool.txt";
const fileMarker = "niceeval-e2e-file-926";
const cmdMarker = "niceeval-e2e-run-926";
const target = join(WORKSPACE_DIR, relPath);

export default defineEval({
  description: "coding tool:command execution 与文件变更事件都进入标准事件流,调用与结果配对成立",
  async test(t) {
    // workspace/ 是宿主机上的真实目录、跨 attempt 复用,先清掉上次跑剩的文件。
    rmSync(target, { force: true });

    // 拆成两轮各一个动作(而不是一条提示词里塞两件事),降低模型只做其中一件的风险——
    // 仍是同一个 Eval、同一条会话线,只是分两步下达指令。
    const createTurn = await t.send(`在当前工作目录创建一个文件 ${relPath},内容只写一行:${fileMarker}。`);
    createTurn.expectOk();

    const runTurn = await t.send(`跑 \`echo ${cmdMarker}\`,把命令的输出告诉我。`);
    runTurn.expectOk();

    t.noFailedActions();

    await t.group("文件变更事件已归一,调用与结果配对", () => {
      t.calledTool("file_edit", { status: "completed", input: { path: new RegExp(relPath) } });
    });
    await t.group("shell 调用已归一,调用与结果配对", () => {
      t.calledTool("shell", { status: "completed", input: { command: new RegExp(cmdMarker) } });
    });

    runTurn.messageIncludes(cmdMarker);

    // 双重核实:host 磁盘上的文件内容也要对得上(不是只信事件流自称)。
    const content = existsSync(target) ? readFileSync(target, "utf8") : "";
    t.check(content, includes(fileMarker));
  },
});
