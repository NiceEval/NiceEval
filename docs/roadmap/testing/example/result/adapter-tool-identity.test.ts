import { expect, test } from "vitest";
import { parseJson, runProcess } from "../support/process.ts";

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: {
    sections: Array<{
      evalId: string;
      attempts: Array<{ locator: string; verdict: string }>;
    }>;
  };
}

interface ExecutionDocument {
  format: "niceeval.show";
  view: "execution";
  data: unknown;
}

function toolValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(toolValues);
  if (value === null || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  return [
    ...(typeof record.tool === "string" ? [record.tool] : []),
    ...Object.values(record).flatMap(toolValues),
  ];
}

// regression: 060a6a05（Codex SDK command_execution 没有规范 tool，calledTool("shell") 静默失配）
test("Codex SDK 的真实命令调用能从公开执行证据读回为 shell", async () => {
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
  const section = historyDocument.data.sections.find((item) => item.evalId === "tool-call/shell");
  expect(section?.attempts).toHaveLength(1);
  expect(section?.attempts[0]?.verdict).toBe("passed");
  const locator = section!.attempts[0]!.locator;

  const shown = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", locator, "--execution", "--json",
  ]);
  expect(shown.exitCode, shown.diagnostic()).toBe(0);

  const document = parseJson<ExecutionDocument>(shown.stdout, shown.diagnostic());
  expect(document.view).toBe("execution");
  expect(toolValues(document.data)).toContain("shell");
  expect(toolValues(document.data)).not.toContain("unknown");
});
