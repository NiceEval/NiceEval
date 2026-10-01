// rerun: pnpm e2e test --repo inspection -- --run test/execution-display-rejection.test.ts
import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("非法展示块拒绝整份快照并保留已接纳事件与采集失败原因", async () => {
  await inspectionE2E.case("execution-display-rejection", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "invalid-execution-display", "--rerun", "all", "--json"]);
    // A rejected snapshot is a capture failure: the Attempt errors even though the author caught each rejection.
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const result = only(run.expEvalEvents(), (entry) => entry.evalId === "invalid-execution-display", run.diagnostic());
    expect(result.verdict).toBe("errored");
    expect(run.stdout).toContain("events[0].display[0].text: contains a control or bidirectional formatting character.");
    const failures = (await readFile(join(projectRoot, "execution-display-rejections.txt"), "utf8")).split("\n");
    expect(failures).toHaveLength(8);
    for (const [mode, field] of [["escape", "text"], ["empty", "length"], ["non-image", "artifactId"], ["unknown-kind", "kind"], ["non-finite", "value"], ["unknown-field", "extra"], ["newline-label", "label"], ["bidi", "speaker"]]) {
      const failure = only(failures, (line) => line.startsWith(`${mode}:`), failures.join("\n"));
      expect(failure).toContain("execution-display-invalid");
      expect(failure).toContain("events[0].display");
      expect(failure).toContain(field!);
    }
    const locator = result.locator.startsWith("@") ? result.locator : `@${result.locator}`;
    const request = join(projectRoot, "display-rejection.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace", locator } }));
    const query = await niceeval.run(["query", "run", "--request", request]);
    expect(query.exitCode, query.diagnostic()).toBe(0);
    const execution = query.querySuccess("attempt.trace").trace.execution;
    expect(execution.state).toBe("partial");
    expect(execution.events).toHaveLength(1);
    expect(execution.events[0]).toMatchObject({ summary: "Retained valid display", display: { state: "present", blocks: [{ kind: "text", text: { preview: "Still readable after rejection", omittedBytes: 0 } }] } });
    expect(execution.limitations).toContainEqual({ code: "capture-failed", stage: "adapter" });
  });
});
