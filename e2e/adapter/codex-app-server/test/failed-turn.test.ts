// owner: docs/engineering/testing/e2e/adapter/codex-cli.md#adapter-codex-app-server-failed-turn
// rerun: pnpm e2e test --repo adapter/codex-app-server

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { join } from "node:path";
import { codexAppServerE2E } from "./context.ts";
import { runInspectionQuery, type InspectionDocument } from "./query.ts";

test("协议内 failed Turn 保留原生原因并归为 failed", async () => {
  await codexAppServerE2E.case(
    "failed-turn",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const result = await niceeval.run(
        ["exp", "failed-turn", "--rerun", "all"],
        { env: { HOME: join(paths.projectRoot, "home") } },
      );

      expect(result.exitCode, result.diagnostic()).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("turn succeeded · expected completed · received failed");
      expect(result.stdout).toContain("reason codex fixture terminal failure");
      expect(result.stdout).not.toContain("Codex app-server turn failed");
      expect(result.stdout).not.toContain("error: failed");
      expect(result.stdout).toContain("0 passed · 1 failed · 0 errored");

      const recorded = await niceeval.run([
        "exp",
        "failed-turn",
        "--rerun",
        "all",
        "--json",
      ]);
      expect(recorded.exitCode, recorded.diagnostic()).toBe(1);
      const event = only(recorded.expEvalEvents(), () => true, recorded.diagnostic());
      expect(event).toMatchObject({ evalId: "failed-turn", verdict: "failed", attempts: 1, passed: 0 });

      const queried = await runInspectionQuery(niceeval, {
        kind: "attempt.get",
        locator: event.locator,
      });
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const document = queried.json<InspectionDocument>();
      expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.get" });
      const attempt = JSON.stringify(document.attempt);
      expect(attempt).toContain('"outcome":"completed"');
      expect(attempt).toContain("failed");
      expect(attempt).toContain("stream-error");
      expect(attempt).toContain("codex");
      expect(attempt).toContain("fixture terminal failure");
    },
  );
});
