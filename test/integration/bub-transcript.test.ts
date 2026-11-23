import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, test } from "vitest";
import {
  createJudgeProject,
  HOST_SANDBOX_SOURCE,
  planAndRunExperiment,
} from "./fixtures/judge-harness/harness.ts";

const tapePath = fileURLToPath(new URL("../../e2e/adapter/bub/fixtures/bub-0.6.1.tape.jsonl", import.meta.url));

async function observeTurns(): Promise<unknown> {
  const tape = await readFile(tapePath, "utf8");
  const lines = tape.split("\n");
  const firstFinish = lines.findIndex((line) => JSON.parse(line).payload.name === "loop.finish");
  const firstTurnTape = lines.slice(0, firstFinish + 1).join("\n") + "\n";
  const cwd = await createJudgeProject("niceeval-bub-transcript-", {
    sandbox: HOST_SANDBOX_SOURCE
      .replace("  return {\n    sandboxId:", "  let sends = 0;\n  return {\n    sandboxId:")
      .replace(
        'runShell: (script, options) => run("bash", ["-c", script], options),',
        `runShell: async (script, options) => {
          if (script.startsWith("test -x ")) return { exitCode: 0, stdout: "", stderr: "" };
          if (options?.env?.BUB_MODEL === "openai:fixture") {
            sends++;
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          return run("bash", ["-c", script], options);
        },`,
      )
      .replace(
        'readText: (path) => readFile(at(path), "utf8"),',
        `readText: async (path) => {
          if (!path.endsWith(".jsonl") || sends === 0) return readFile(at(path), "utf8");
          return sends === 1 ? ${JSON.stringify(firstTurnTape)} : ${JSON.stringify(tape)};
        },`,
      ),
    experiments: {
      "bub.ts": `
        import { defineExperiment } from "niceeval";
        import { bubAgent } from "niceeval/adapter";
        import sandbox from "../sandbox.ts";
        export default defineExperiment({
          adapter: bubAgent({ apiKey: "fixture-key", baseUrl: "https://fixture.invalid/v1" }),
          sandbox, model: "fixture", evals: ["observe"], attempts: 1,
        });
      `,
    },
    evals: {
      "observe.eval.ts": `
        import { defineEval } from "niceeval";
        import { writeFile } from "node:fs/promises";
        export default defineEval({ async test(t) {
          const capture = (turn) => ({
            reply: turn.reply,
            input: turn.usage.inputTokens,
            output: turn.usage.outputTokens,
            cache: turn.usage.cacheReadTokens,
            total: turn.usage.totalTokens,
            calls: turn.toolCalls.map(({ name, status, input }) => ({ name, status, input })),
          });
          const first = capture(await t.send("Write notes with a tool."));
          const recall = capture(await t.send("Recall from the prior turn."));
          await writeFile(new URL("../observation.json", import.meta.url), JSON.stringify({ first, recall }));
        }});
      `,
    },
  });
  try {
    await planAndRunExperiment(cwd, "bub", { rerun: "all" });
    return JSON.parse(await readFile(join(cwd, "observation.json"), "utf8"));
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
}

let observation: unknown;
beforeAll(async () => {
  observation = await observeTurns();
}, 15_000);

// @feature docs/feature/adapters/README.md#protocol-normalization
test("Bub assigns native tools and Republic usage to the Turn that produced them", () => {
  expect(observation).toMatchObject({
    first: {
      reply: "Protocol fixture complete.",
      input: { state: "exact", value: 16 },
      output: { state: "exact", value: 10 },
      cache: { state: "exact", value: 6 },
      total: { state: "exact", value: 32 },
      calls: [{ name: "file_write", status: "completed", input: { path: "notes.txt", content: "fixture file" } }],
    },
    recall: {
      reply: "Protocol fixture complete.",
      input: { state: "exact", value: 8 },
      output: { state: "exact", value: 5 },
      cache: { state: "exact", value: 3 },
      total: { state: "exact", value: 16 },
      calls: [],
    },
  });
});
