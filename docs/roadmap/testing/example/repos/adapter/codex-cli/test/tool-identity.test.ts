import { expect, test } from "vitest";
import { parseJson, runProcess } from "./support/process.ts";
import { only } from "./support/assert.ts";

// NiceEval 根目录：pnpm e2e --repo adapter/codex-cli
// 已安装候选包的独立 codex-cli Repo 根：pnpm test

interface HistorySection {
  experimentId: string;
  evalId: string;
  attempts: Array<{ locator: string; verdict: string }>;
}

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: { sections: HistorySection[] };
}

interface ToolReply {
  kind: "tool";
  name: string;
  tool?: string;
  input?: { command?: string };
}

interface ConversationRound {
  replies: Array<ToolReply | { kind: string }>;
}

interface ExecutionDocument {
  format: "niceeval.show";
  view: "execution";
  data: {
    locator: string;
    conversation: { rounds: ConversationRound[] } | null;
  };
}

const CMD_MARKER = "niceeval-e2e-echo-914";

// 规范身份契约：codexAgent 的真实命令调用必须以规范 ToolName "shell" 出现在公开执行
// 证据里，不能退化成协议原始名（command_execution）或 unknown——identity 一旦丢失，
// 用户侧 calledTool("shell") 会静默失配（同类故障家族见 memory/sdk-stream-transformers-
// missing-canonical-tool.md，Codex CLI 解析路径自始带规范名，本测试防止它回归）。
test("Codex CLI 的真实命令调用能从公开执行证据读回为规范 shell", async () => {
  const run = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "tool-call", "--rerun", "all", "--json",
  ]);
  expect(run.exitCode, run.diagnostic()).toBe(0);

  const history = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "tool-call/shell", "--history", "--json",
  ]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  const historyDocument = parseJson<HistoryDocument>(history.stdout, history.diagnostic());
  const section = only(
    historyDocument.data.sections,
    (item) => item.evalId === "tool-call/shell",
    history.diagnostic(),
  );
  const attempt = only(section.attempts, (item) => item.verdict === "passed", history.diagnostic());

  const shown = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", attempt.locator, "--execution", "--json",
  ]);
  expect(shown.exitCode, shown.diagnostic()).toBe(0);
  const document = parseJson<ExecutionDocument>(shown.stdout, shown.diagnostic());
  expect(document.view).toBe("execution");
  expect(document.data.locator).toBe(attempt.locator);

  const toolReplies = (document.data.conversation?.rounds ?? [])
    .flatMap((round) => round.replies)
    .filter((reply): reply is ToolReply => reply.kind === "tool");
  const canonicalTools = toolReplies.map((reply) => reply.tool);
  expect(canonicalTools).toContain("shell");
  expect(canonicalTools).not.toContain("unknown");

  // 入参保真同样穿到展示面：命令文本在公开执行证据里。
  const shellCall = only(toolReplies, (reply) => reply.tool === "shell", shown.diagnostic());
  expect(shellCall.input?.command).toMatch(new RegExp(CMD_MARKER));
});
