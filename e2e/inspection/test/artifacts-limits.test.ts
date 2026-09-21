// rerun: pnpm e2e test --repo inspection -- --run test/artifacts-limits.test.ts
import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

test.concurrent("附件拒绝非法输入和超限时仍保存接管的快照并形成 errored Attempt [necase_4G8QVYJM9TW1HDSX]", async () => {
  await inspectionE2E.case("artifacts-limits", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const experimentPath = join(projectRoot, "experiments", "artifacts-limits.ts");
    const source = await readFile(experimentPath, "utf8");
    for (const mode of ["invalid", "item", "count", "total"]) {
      await writeFile(experimentPath, source.replace('mode: "invalid"', `mode: "${mode}"`));
      const run = await niceeval.run(["exp", "artifacts-limits", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      const event = only(run.expEvalEvents(), (entry) => entry.evalId === "artifacts-limits", run.diagnostic());
      expect(event).toMatchObject({ verdict: "errored" });
      expect(await readFile(join(projectRoot, "attachment-rejection.txt"), "utf8")).toBe(
        mode === "invalid" ? "adapter-attachment-invalid" : "adapter-attachment-limit",
      );
      const locator = event.locator.startsWith("@") ? event.locator : `@${event.locator}`;
      const artifactId = await readFile(join(projectRoot, "accepted-artifact-id.txt"), "utf8");
      const requestPath = join(projectRoot, "artifact-limit.request.json");
      await writeFile(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator, artifactId } }));
      const read = await niceeval.run(["query", "run", "--request", requestPath]);
      expect(read.exitCode, read.diagnostic()).toBe(0);
      expect(read.querySuccess("attempt.artifact").artifact).toMatchObject({
        state: "available", name: "retained", byteLength: 3, base64: "AQID", nextOffset: null,
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      });
    }
  });
}, 240_000);
