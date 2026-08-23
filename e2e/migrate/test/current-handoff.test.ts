// owner: docs/engineering/testing/e2e/migrate.md#current-to-current-handoff-bootstrap

import { createE2EContext, type ExpEvalEvent, type ExpEvent } from "@niceeval/testkit";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const installedNiceeval = [process.execPath, join(process.cwd(), "node_modules", "niceeval", "bin", "niceeval.js")] as const;
const e2e = createE2EContext({
  repoId: "migrate",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-migrate-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  // Both identities intentionally point at the current candidate today. A future
  // compatibility owner replaces only producer's prefix with an attested old build.
  commands: {
    producer: installedNiceeval,
    candidate: installedNiceeval,
  },
});

test("source-first current producer 的持久化结果可由独立 candidate 读回", async () => {
  await e2e.case(
    "current-handoff",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { producer, candidate } }) => {
      const run = await producer.run(["exp", "handoff", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const receipt = run.expReceipt();
      expect(receipt.completion, run.diagnostic()).toBe("completed");
      expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
      const evalEvent = run.ndjson<ExpEvent>().find(
        (event): event is ExpEvalEvent =>
          "event" in event && event.event === "eval" && event.evalId === "handoff",
      );
      expect(evalEvent, run.diagnostic()).toMatchObject({ verdict: "passed" });
      const migration = await candidate.run(["migrate"]);
      expect(migration.exitCode, migration.diagnostic()).toBe(0);
      expect(migration.stdout, migration.diagnostic()).toContain(
        "Record migration plan: already-current\nformat: niceeval.record.source-receipts\n",
      );
      expect(migration.stdout, migration.diagnostic()).toContain("Record migration already-current.");

      const shown = await candidate.run(["show", "--run", receipt.runIds[0]!, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const selection = shown
        .json<{ selection: { kind: "explicit-runs"; runIds: readonly string[] } }>()
        .selection;
      expect(selection.runIds, shown.diagnostic()).toEqual([receipt.runIds[0]!]);
    },
  );
});
