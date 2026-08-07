// feature: docs/feature/adapters/sdk/codex-cli/README.md
import { resolve } from "node:path";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// Adapter 兼容性 Repo；exp/show 只是公开证据读回手段，不承担通用功能矩阵。
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
const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-codex-identity-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

// 规范身份契约：codexAgent 的真实命令调用必须以规范 ToolName "shell" 出现在公开执行
// 证据里；同时原始协议名 command_execution 原样保留在 name——unknown/规范分类不能
// 覆盖原名（identity 一旦丢失，用户侧 calledTool("shell") 会静默失配；同类故障家族见
// memory/sdk-stream-transformers-missing-canonical-tool.md，Codex CLI 解析路径自始带
// 规范名，本测试防止它回归）。
test("Codex CLI 的真实命令调用能从公开执行证据读回为规范 shell 且保留原名", async () => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    const run = await niceeval.run(["exp", "tool-call", "--rerun", "all", "--json"], { cwd: root });
    expect(run.exitCode, run.diagnostic()).toBe(0);

    const history = await niceeval.run(["show", "tool-call/shell", "--history", "--json"], { cwd: root });
    expect(history.exitCode, history.diagnostic()).toBe(0);
    const historyDocument = history.json<HistoryDocument>();
    const section = only(
      historyDocument.data.sections,
      (item) => item.evalId === "tool-call/shell",
      history.diagnostic(),
    );
    const attempt = only(section.attempts, (item) => item.verdict === "passed", history.diagnostic());

    const shown = await niceeval.run(["show", attempt.locator, "--execution", "--json"], { cwd: root });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const document = shown.json<ExecutionDocument>();
    expect(document.view).toBe("execution");
    expect(document.data.locator).toBe(attempt.locator);

    const toolReplies = (document.data.conversation?.rounds ?? [])
      .flatMap((round) => round.replies)
      .filter((reply): reply is ToolReply => reply.kind === "tool");
    // 原始协议名原样保留：unknown/规范分类是叠加字段，不能覆盖 name。
    expect(toolReplies.map((reply) => reply.name)).toContain("command_execution");
    const canonicalTools = toolReplies.map((reply) => reply.tool);
    expect(canonicalTools).toContain("shell");
    expect(canonicalTools).not.toContain("unknown");

    // 入参保真同样穿到展示面：命令文本在公开执行证据里。
    const shellCall = only(toolReplies, (reply) => reply.tool === "shell", shown.diagnostic());
    expect(shellCall.input?.command).toMatch(new RegExp(CMD_MARKER));
  });
});
