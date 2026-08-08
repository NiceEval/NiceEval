// feature: docs/feature/adapters/sdk/ai-sdk/README.md
import { resolve } from "node:path";
import {
  command,
  defined,
  only,
  startProcess,
  waitForOutput,
  withProjectCopy,
  type ProcessHandle,
} from "@niceeval/testkit";
import { afterAll, beforeAll, expect, test } from "vitest";

// Adapter 兼容性 Repo；exp/show 只是公开证据读回手段，不承担通用功能矩阵。
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

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
// 被测应用（pnpm start）留在原 Repo，只把 CLI 产物隔离进每 case 的私有副本。
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-ai-sdk-identity-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;
let backendUrl: string | undefined;
let backend: ProcessHandle | undefined;

beforeAll(async () => {
  const proc = startProcess(["pnpm", "--silent", "start"], { env: { PORT: "0" } });
  backend = proc;
  backendUrl = await waitForOutput(
    proc,
    "stdout",
    /http:\/\/127\.0\.0\.1:\d+/,
    { timeoutMs: 20_000, label: "pnpm start（ai-sdk 被测应用）" },
  );
}, 30_000);

afterAll(async () => {
  await backend?.dispose();
}, 15_000);

// 契约：UI Message Stream 没有命名空间概念，保留应用声明的原始 `name`——
// 公开执行证据必须读到 get_weather，且 calculate（反例）不得出现。
// 这个协议只承诺原始 name，不承诺 `tool` 规范分类，因此这里只断言 name，不虚构 unknown。
test("AI SDK 真实工具调用从公开执行证据读回为不带命名空间的工具名", async () => {
  const url = defined(backendUrl, "被测应用应已就绪");
  expect(url, "被测应用应已就绪").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    const run = await niceeval.run(
      ["exp", "tool-call", "--rerun", "all", "--json"],
      { cwd: root, env: { AI_SDK_URL: url } },
    );
    expect(run.exitCode, run.diagnostic()).toBe(0);

    const history = await niceeval.run(["show", "tool-call/weather", "--history", "--json"], { cwd: root });
    expect(history.exitCode, history.diagnostic()).toBe(0);
    const historyDocument = history.json<HistoryDocument>();
    const section = only(
      historyDocument.data.sections,
      (item) => item.evalId === "tool-call/weather",
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
    expect(toolReplies.map((reply) => reply.name)).toContain("get_weather");
    expect(toolReplies.map((reply) => reply.name)).not.toContain("calculate");

    // 入参保真同样穿到展示面：天气城市在公开执行证据里。
    const weatherCall = only(toolReplies, (reply) => reply.name === "get_weather", shown.diagnostic());
    expect(weatherCall.input?.city).toMatch(/北京/);
  });
});
