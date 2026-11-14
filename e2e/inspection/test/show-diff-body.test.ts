import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("按 change ID 查看封存正文与 unified diff，截断和二进制端保留真实状态", async () => {
  await inspectionE2E.case("show-diff-body", async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "diff-body", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), item => item.evalId === "diff-body");
    const listed = await niceeval.run(["show", event.locator, "--json", "diff"]);
    const diff = listed.inspectionSuccess("attempt.diff").diff;
    expect(diff.state).toBe("complete");
    const changes = diff.windows.flatMap(window => window.changes);
    expect(changes.map(change => change.path).sort()).toEqual(["binary.txt", "large.txt", "small.txt"]);
    const humanList = await niceeval.run(["show", event.locator, "diff"]);
    for (const path of ["small.txt", "large.txt", "binary.txt"]) {
      const change = only(changes, item => item.path === path);
      if (path !== "binary.txt") expect(humanList.stdout.replace(/\s+/gu, " ")).toContain(`niceeval show ${event.locator} ${change.changeId}`);
      const shown = await niceeval.run(["show", event.locator, "--json", change.changeId]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const direct = await niceeval.run(["show", event.locator, "diff", change.changeId, "--json"]);
      expect(shown.stdout).toBe(direct.stdout);
      const result = shown.inspectionSuccess("attempt.diff").diff;
      if (!("detail" in result) || result.detail === undefined) throw new Error(shown.diagnostic());
      if (path === "small.txt") {
        expect(result.detail).toMatchObject({ before: { state: "available", text: "before\n", truncated: false }, after: { state: "available", text: "after\n", truncated: false }, hunks: { state: "available", text: "--- a/small.txt\n+++ b/small.txt\n@@ -1,1 +1,1 @@\n-before\n+after\n", truncated: false } });
        const human = await niceeval.run(["show", event.locator, change.changeId]);
        expect(human.stdout).toContain("-before\n+after\n");
      } else if (path === "large.txt") {
        expect(result.detail).toMatchObject({ before: { state: "available", truncated: true, byteLength: 30001 }, after: { state: "available", truncated: true }, hunks: { truncated: true } });
        if (result.detail.before.state === "available") expect(Buffer.byteLength(result.detail.before.text)).toBeLessThanOrEqual(16384);
        expect(Buffer.byteLength(result.detail.hunks.text)).toBeLessThanOrEqual(32768);
      } else expect(result.detail).toMatchObject({ before: { state: "binary" }, after: { state: "binary" }, hunks: { state: "unavailable", text: "" } });
    }
  });
});
