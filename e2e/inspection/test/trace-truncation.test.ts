import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("tool details disclose producer truncation and retained bytes", async () => {
  await inspectionE2E.case(
    "trace-truncation",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const agent = join(projectRoot, "agents/deterministic.ts");
      await writeFile(agent, (await readFile(agent, "utf8")).replaceAll("repeat(900)", "repeat(9000)"));
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const { locator } = only(run.expEvalEvents(), (entry) => entry.evalId === "inspection");
      const execution = await niceeval.run(["show", locator, "execution", "--json"]);
      const trace = execution.inspectionSuccess("attempt.trace");
      const link = trace.links.find((entry) => entry.rel === "execution-item" && entry.command.includes("tool_"));
      expect(link).toBeDefined();
      const args = link!.command.slice("niceeval ".length).split(" ");
      const tool = await niceeval.run([...args, "--json"]);
      expect(tool.exitCode, tool.diagnostic()).toBe(0);
      const detail = tool.inspectionSuccess("attempt.trace.detail").detail;
      expect(detail.kind).toBe("tool-occurrence");
      if (detail.kind !== "tool-occurrence") throw new Error("Expected tool occurrence");
      expect(detail.result).toMatchObject({
        outputTruncation: { state: "truncated", retainedBytes: 16384, originalBytes: 108059 },
      });
      const item = await niceeval.run(["show", locator, detail.result!.itemId, "--json"]);
      expect(item.inspectionSuccess("attempt.trace.detail").detail).toMatchObject({
        kind: "item",
        item: { outputTruncation: { state: "truncated", retainedBytes: 16384, originalBytes: 108059 } },
      });
      const human = await niceeval.run(args);
      expect(human.stdout).toMatch(/truncated/i);
    },
  );
});
