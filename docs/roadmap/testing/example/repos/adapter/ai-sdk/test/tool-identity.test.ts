import { afterAll, beforeAll, expect, test } from "vitest";
import { parseJson, runProcess, startProcess, waitForOutputLine } from "./support/process.ts";
import { only } from "./support/assert.ts";

// NiceEval 根目录：pnpm e2e --repo adapter/ai-sdk
// 已安装候选包的独立 ai-sdk Repo 根：pnpm test

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
  input?: { city?: string };
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

let backendUrl: string | undefined;
let backend: ReturnType<typeof startProcess> | undefined;

beforeAll(async () => {
  const proc = startProcess(["pnpm", "--silent", "start"], { env: { PORT: "0" } });
  backend = proc;
  const stdout = proc.stdout;
  expect(stdout, "被测应用 stdout 应可读").not.toBeNull();
  const line = await waitForOutputLine(
    stdout as NodeJS.ReadableStream,
    /http:\/\/127\.0\.0\.1:\d+/,
    20_000,
    "pnpm start（ai-sdk 被测应用）",
  );
  backendUrl = line;
}, 30_000);

afterAll(async () => {
  if (backend) {
    backend.send("SIGTERM");
    await backend.done;
  }
}, 15_000);

// 契约：UI Message Stream 没有命名空间概念，协议原样的工具名就是规范身份——
// 公开执行证据必须读到 get_weather，且 calculate（反例）不得出现。
test("AI SDK 真实工具调用从公开执行证据读回为不带命名空间的工具名", async () => {
  const url = backendUrl;
  expect(url, "被测应用应已就绪").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

  const run = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "tool-call", "--rerun", "all", "--json",
  ], { env: { AI_SDK_URL: url } });
  expect(run.exitCode, run.diagnostic()).toBe(0);

  const history = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "tool-call/weather", "--history", "--json",
  ]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  const historyDocument = parseJson<HistoryDocument>(history.stdout, history.diagnostic());
  const section = only(
    historyDocument.data.sections,
    (item) => item.evalId === "tool-call/weather",
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
  expect(toolReplies.map((reply) => reply.name)).toContain("get_weather");
  expect(toolReplies.map((reply) => reply.name)).not.toContain("calculate");

  // 入参保真同样穿到展示面：天气城市在公开执行证据里。
  const weatherCall = only(toolReplies, (reply) => reply.name === "get_weather", shown.diagnostic());
  expect(weatherCall.input?.city).toMatch(/北京/);
});
