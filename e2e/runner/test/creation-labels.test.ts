import { createE2EContext } from "@niceeval/testkit";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

const context = createE2EContext({
  repoId: "runner",
  project: { from: process.cwd(), prefix: "niceeval-labels-", omitTopLevel: ["node_modules", "test", ".niceeval", ".e2e-artifacts"], links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }] },
  commands: { niceeval: [resolve("node_modules/.bin/niceeval")] },
});

// @feature docs/feature/sandbox/README.md
test.concurrent("Docker instances identify their first Attempt and Eval unless the Experiment selects run-only labels", async () => {
  await context.case("creation-labels", {}, async ({ commands: { niceeval } }) => {
    const digests: string[] = [];
    for (const mode of ["default", "run-only"]) {
      const result = await niceeval.run(["exp", "creation-labels", "--rerun", "all", "--json"], {
        env: { NICEEVAL_LABEL_MODE: mode }, timeoutMs: 120_000,
      });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.expEvalEvents(), result.diagnostic()).toEqual([
        expect.objectContaining({ evalId: "creation-labels", verdict: "passed" }),
      ]);
      const locator = result.expEvalEvents()[0]!.locator!;
      const queried = await niceeval.run(["query", "run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.get", locator } })]);
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      digests.push(queried.attempt().attempt.core.executionIdentityDigest);
    }
    expect(digests[1]).toBe(digests[0]);
  });
});

// @feature docs/feature/sandbox/README.md
test.concurrent("remote Provider creation metadata identifies its first Attempt and Eval and honors run-only", async () => {
  await context.case("remote-creation-labels", {}, async ({ commands: { niceeval }, paths }) => {
    for (const mode of ["default", "run-only"]) {
      const receipt = join(paths.projectRoot, `labels-${mode}.json`);
      const result = await niceeval.run(["exp", "creation-labels", "--rerun", "all", "--json"], {
        env: { NICEEVAL_LABEL_PROVIDER: "e2b", NICEEVAL_LABEL_MODE: mode, NICEEVAL_LABEL_RECEIPT: receipt,
          NODE_OPTIONS: `--import=${pathToFileURL(join(paths.projectRoot, "fixtures/labels-e2b-preload.mjs")).href}` },
      });
      expect(result.expEvalEvents(), result.diagnostic()).toEqual([expect.objectContaining({ verdict: "errored" })]);
      const labels = JSON.parse(await readFile(receipt, "utf8"));
      expect(labels["niceeval.run_id"]).toBe(result.expReceipt().createdRunIds[0]);
      if (mode === "run-only") {
        expect(labels).not.toHaveProperty("niceeval.created_for_attempt");
        expect(labels).not.toHaveProperty("niceeval.created_for_eval");
      } else {
        expect(labels["niceeval.created_for_attempt"]).toMatch(/^[0-9a-f-]{36}$/u);
        expect(labels["niceeval.created_for_eval"]).toBe("creation-labels");
      }
    }
  });
});
