// owner: docs/engineering/testing/e2e/migrate.md#report-migration-metric-guard

import { expect, test } from "vitest";
import { e2e } from "./support.ts";

test("Report 拒绝 ledger 缺 Slot 的伪造 metric", async () => {
  await e2e.case("report-incomplete-ledger", async ({ commands: { candidate } }) => {
    const produced = await candidate.run(["exp", "handoff", "--rerun", "all", "--json"]);
    expect(produced.exitCode, produced.diagnostic()).toBe(0);
    const [runId] = produced.expReceipt().runIds;
    expect(runId, produced.diagnostic()).toBeDefined();
    const rejected = await candidate.run(["show", "--run", runId!, "--report", "./reports/invalid-migration-metric.tsx", "--page", "/invalid-migration-metric"]);
    expect(rejected.exitCode, rejected.diagnostic()).toBe(1);
    expect(rejected.stderr, rejected.diagnostic()).toContain("Table rows[0].metric has unsupported object type");
  });
});
