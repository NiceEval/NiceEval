// rerun: pnpm e2e test --candidate source --lane main --repo instabox -- --run test/before-cache.test.ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { context } from "./context.ts";

// @use-case docs/feature/sandbox/use-case/sandbox-cloud-before-cache.md
test.concurrent("Instabox 冷链的多个发布点继续使用同一源 Machine", async () => {
  await context.case("continuous-before-cache", async ({ commands: { niceeval }, paths }) => {
    await writeFile(
      join(paths.projectRoot, "experiments/before-cache.ts"),
      `import { defineExperiment } from "niceeval";
import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { instaboxSandbox, shell } from "niceeval/sandbox";
export default defineExperiment({
  sandboxCache: { before: "use" },
  adapter: defineSandboxAgent({ name: "prepare-fixture", evidenceCoverage: completeEvidenceCoverage,
    ensure: { identity: { agent: "prepare-fixture", version: "1", revision: "1" }, probe: shell("true") },
    send: async () => ({ status: "completed", events: [] }) }),
  sandbox: instaboxSandbox({ template: "minimal", lifetimeMs: 600000 }).before(
    shell({ id: "first", changeFrequency: 10, command: "sudo groupadd niceeval-access && sudo usermod -aG niceeval-access $(id -un) && printf first | sudo tee niceeval-first >/dev/null && sudo chown root:niceeval-access niceeval-first && sudo chmod 640 niceeval-first" })).before(
    shell({ id: "second", changeFrequency: 20, command: "id; id $(id -un); test $(cat niceeval-first) = first && printf second > niceeval-second" })),
  evals: ["before-cache"],
});`,
    );
    await writeFile(
      join(paths.projectRoot, "evals/before-cache.eval.ts"),
      `import { defineEval } from "niceeval";
export default defineEval({ async test(t) {
  if (await t.sandbox.readText("niceeval-first") !== "first" || await t.sandbox.readText("niceeval-second") !== "second") throw new Error("Prepared state missing");
} });`,
    );
    const receipt = join(paths.projectRoot, "prepare-resources.ndjson");
    const headers = { "X-API-Key": process.env.INSTABOX_API_KEY! };
    const env = {
      NICEEVAL_HOME: join(paths.projectRoot, ".prepare-home"),
      NICEEVAL_PREPARE_RECEIPT: receipt,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${join(paths.projectRoot, "fixtures/before-cache.mjs")}`,
    };
    try {
      const result = await niceeval.run(["exp", "before-cache", "--rerun", "all", "--json"], {
        env,
        timeoutMs: 480_000,
      });
      if (result.exitCode !== 0) console.info("Instabox result tail:", result.stdout.slice(-6000));
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.expEvalEvents().map(({ verdict }) => verdict)).toEqual(["passed"]);
      console.info(
        "Instabox preparation result:",
        JSON.stringify(result.expTerminal().summary.beforeCaches),
        result.stdout.slice(-4000),
      );
      const records = (await readFile(receipt, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const snapshots = records.filter((record) => record.snapshot);
      expect(snapshots).toHaveLength(2);
      expect(new Set(snapshots.map((record) => record.snapshot)).size).toBe(2);
      expect(new Set(snapshots.map((record) => record.source)).size).toBe(1);
      for (const { snapshot, source } of snapshots) {
        const response = await fetch(`https://api.instabox.sh/v1/snapshots/${encodeURIComponent(snapshot)}`, {
          headers,
        });
        expect(response.status, `Read Instabox snapshot ${snapshot}`).toBe(200);
        expect(await response.json()).toMatchObject({ id: snapshot, sourceMachineId: source, status: "ready" });
      }
      console.info("Instabox preparation resources:", JSON.stringify(records));
    } finally {
      console.info("Instabox cleanup receipt:", await readFile(receipt, "utf8").catch(() => ""));
      const records = await readFile(receipt, "utf8").catch(() => "");
      for (const record of records
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))) {
        if (record.snapshot) {
          const removed = await fetch(`https://api.instabox.sh/v1/snapshots/${record.snapshot}`, {
            method: "DELETE",
            headers: {
              ...headers,
              "X-Confirm-Delete": record.snapshot,
              "Idempotency-Key": `delete-${record.snapshot}`,
            },
          });
          expect([200, 204, 404]).toContain(removed.status);
          expect((await fetch(`https://api.instabox.sh/v1/snapshots/${record.snapshot}`, { headers })).status).toBe(
            404,
          );
        }
        if (record.machine) {
          const found = await fetch(`https://api.instabox.sh/v1/machines/${record.machine}`, { headers });
          expect(found.status, `Machine ${record.machine} must be released by NiceEval`).toBe(404);
        }
      }
    }
  });
}, 600_000);
