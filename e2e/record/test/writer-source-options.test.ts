import { join, resolve } from "node:path";
import { createE2EContext } from "@niceeval/testkit";
import { expect, test } from "vitest";

const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-writer-source-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")] },
});

// @feature docs/feature/run/README.md
test.concurrent("评估与采用命令拒绝选择其它可写 Record", async () => {
  await e2e.case("canonical-writer-source", async ({ commands: { niceeval } }) => {
    const baseline = await niceeval.run(["exp", "migration-agent", "--rerun", "all", "--json"]);
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    const sourceRunId = baseline.expReceipt().createdRunIds[0]!;
    const receipts = await Promise.all([
      niceeval.run(["exp", "migration-agent", "--dry", "--json", "--record", "another-record"]),
      niceeval.run(["accept", "--run", sourceRunId, "--dry", "--record", "another-record"]),
    ]);
    expect(
      receipts.every((receipt) => receipt.exitCode !== 0),
      receipts.map((receipt) => receipt.diagnostic()).join("\n"),
    ).toBe(true);
    for (const receipt of receipts) {
      expect(receipt.stdout, receipt.diagnostic()).toBe("");
      expect(receipt.stderr, receipt.diagnostic()).toContain("Unknown option '--record'");
    }
  });
});
