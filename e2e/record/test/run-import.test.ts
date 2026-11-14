import { join, resolve } from "node:path";
import { createE2EContext } from "@niceeval/testkit";
import { decodeRunDocument } from "niceeval/run";
import { expect, test } from "vitest";

const binary = join(process.cwd(), "node_modules", ".bin", "niceeval");
const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-import-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [binary] },
});

// @feature docs/feature/run/README.md
test.concurrent("汇入外部 Record 后立即可读，重复汇入幂等跳过", async () => {
  await e2e.case("run-import-idempotence", async ({ paths, commands: { niceeval } }) => {
    const evaluated = await niceeval.run(["exp", "migration-agent", "--rerun", "all", "--json"]);
    expect(evaluated.exitCode, evaluated.diagnostic()).toBe(0);
    const runId = evaluated.expReceipt().createdRunIds[0]!;
    const file = join(paths.projectRoot, "delivered.sqlite");
    const exported = await niceeval.run(["run", "export", "--run", runId, "--out", file, "--json"]);
    expect(exported.exitCode, exported.diagnostic()).toBe(0);
    await e2e.case("run-import-recipient", async ({ commands: { niceeval: recipient } }) => {
      const existing = await recipient.run(["exp", "migration-custom", "--rerun", "all", "--json"]);
      expect(existing.exitCode, existing.diagnostic()).toBe(0);
      const existingId = existing.expReceipt().createdRunIds[0]!;
      const imported = await recipient.run(["run", "import", file, "--json"]);
      expect(imported.exitCode, imported.diagnostic()).toBe(0);
      const decoded = decodeRunDocument(imported.json<unknown>());
      expect(decoded.success, decoded.success ? "" : decoded.reason).toBe(true);
      if (!decoded.success) throw new Error(decoded.reason);
      expect(decoded.value).toMatchObject({
        operation: "run.import",
        outcome: "imported",
        imported: [runId],
        alreadyPresent: [],
      });
      const listed = await recipient.run(["run", "list", "--json"]);
      expect(listed.exitCode, listed.diagnostic()).toBe(0);
      expect(listed.runListDocument().runs).toHaveLength(2);
      expect(listed.runListDocument().runs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ runId, state: "completed", coverage: { published: 1, expected: 1, missing: 0 } }),
          expect.objectContaining({ runId: existingId, state: "completed" }),
        ]),
      );
      const repeated = await recipient.run(["run", "import", file, "--json"]);
      expect(repeated.exitCode, repeated.diagnostic()).toBe(0);
      const again = decodeRunDocument(repeated.json<unknown>());
      expect(again.success, again.success ? "" : again.reason).toBe(true);
      if (!again.success) throw new Error(again.reason);
      expect(again.value).toMatchObject({
        operation: "run.import",
        outcome: "already-present",
        imported: [],
        alreadyPresent: [runId],
      });
      const after = await recipient.run(["run", "list", "--json"]);
      expect(after.exitCode, after.diagnostic()).toBe(0);
      expect(after.runListDocument()).toEqual(listed.runListDocument());
    });
  });
});
