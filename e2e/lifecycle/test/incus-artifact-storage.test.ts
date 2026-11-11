import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { command, withProjectCopy, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";

// @feature docs/feature/sandbox-nested-docker/README.md
// @regression memory/incus-artifact-maintenance.md
test.concurrent("Incus rejects capture without storage bytes and admits the next invocation after recovery", async () => {
  await withProjectCopy({
    from: process.cwd(), prefix: "niceeval-e2e-incus-storage-",
    omitTopLevel: [".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  }, async ({ root }) => {
    await withTempDir("niceeval-incus-storage-runtime-", async (runtime) => {
      const bin = join(runtime, "bin");
      const descriptor = join(runtime, "descriptor.json");
      const state = join(runtime, "provider.json");
      const journal = join(runtime, "provider.ndjson");
      const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      await mkdir(bin);
      await writeFile(join(bin, "incus"), `#!/usr/bin/env node\nawait import(${JSON.stringify(pathToFileURL(resolve("fixtures/fake-incus.mjs")).href)});\n`);
      await chmod(join(bin, "incus"), 0o755);
      await writeFile(descriptor, JSON.stringify({ schemaVersion: "niceeval.incus-provider/v2", domains: [{
        name: "development", status: "configured", executionDomainId: "storage-development",
        project: "niceeval-eval-dev", storagePool: "niceeval-sandbox-dev", network: "niceeval-dev",
        storage: "development-dir", quota: "unattested", maxInstances: 4,
        artifactProject: "niceeval-artifacts-dev", artifactMaxInstances: 4,
        dockerDataBytes: 1024 ** 3,
        workdir: "/home/sandbox/workspace", user: "node", hostGateway: "10.0.0.1",
        trustedBaseImages: [`niceeval/docker-execution-v1@sha256:${digest}`],
      }] }));
      await writeFile(join(root, "experiments/incus-storage.ts"), `
import { defineExperiment } from "niceeval";
import { incusSandbox, shell } from "niceeval/sandbox";
import { quickAgent } from "../agents/deterministic.ts";
export default defineExperiment({ adapter: quickAgent,
  sandbox: incusSandbox({ image: "niceeval/docker-execution-v1@sha256:${digest}",
    project: "niceeval-eval-dev", storagePool: "niceeval-sandbox-dev", acceptDevelopmentDomain: true,
    resources: { dockerDataBytes: ${1024 ** 3} } }).before(shell({ id: "storage-prefix", command: "true" })),
  evals: ["probe"], attempts: 1, maxConcurrency: 1 });
`);
      const env = {
        ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`,
        NICEEVAL_HOME: join(runtime, "user"), XDG_STATE_HOME: join(runtime, "xdg"),
        NICEEVAL_INCUS_DESCRIPTOR: descriptor,
        NICEEVAL_E2E_FAKE_INCUS_STATE: state, NICEEVAL_E2E_FAKE_INCUS_JOURNAL: journal,
      };
      const cli = command(["pnpm", "--silent", "exec", "niceeval"]);
      await writeFile(state, JSON.stringify({ instances: {}, volumes: {}, storageResources: { space: { total: 4096, used: 4000 } } }));
      // A count-only descriptor must not certify a pool with no usable bytes.
      // The old CLI passes this check despite the exhausted external pool.
      const legacy = await cli.run(["sandbox", "provider", "doctor", "incus", "--development"], { cwd: root, env });
      expect(legacy.exitCode, legacy.diagnostic()).toBe(1);
      const configured = JSON.parse(await readFile(descriptor, "utf8"));
      configured.domains[0].artifactStorageReserveBytes = 1024;
      configured.domains[0].artifactEstimatedBytes = 2048;
      await writeFile(descriptor, JSON.stringify(configured));
      const low = await cli.run(["sandbox", "provider", "doctor", "incus", "--development"], { cwd: root, env });
      expect(low.exitCode, low.diagnostic()).toBe(1);
      expect(low.stdout).toContain("artifact-storage: FAIL");
      expect(low.stdout).toContain("storage-bytes");
      expect(low.stdout).toContain("4 free of 4");
      const refused = await cli.run(["exp", "incus-storage", "probe", "--rerun=all", "--json"], { cwd: root, env });
      expect(refused.exitCode, refused.diagnostic()).not.toBe(0);
      expect(refused.expTerminal().summary.beforeCaches).toEqual({ total: 1, hit: 0, prepared: 0, degraded: 1, failed: 0 });
      // Cache admission cannot copy into the exhausted pool, but a cache
      // failure still dispatches the Attempt from Base (this fake fails ensure).
      expect(refused.expEvalEvents()).toEqual([expect.objectContaining({ evalId: "probe", verdict: "errored", locator: expect.any(String) })]);
      expect(await readFile(journal, "utf8")).not.toContain('"type":"copy"');

      const provider = JSON.parse(await readFile(state, "utf8"));
      provider.storageResources = {};
      await writeFile(state, JSON.stringify(provider));
      const unknown = await cli.run(["sandbox", "provider", "doctor", "incus", "--development"], { cwd: root, env });
      expect(unknown.exitCode, unknown.diagnostic()).toBe(1);
      expect(unknown.stdout).toContain("artifact-storage: FAIL");
      expect(unknown.stdout).toContain("unknown");

      delete provider.storageResources;
      await writeFile(state, JSON.stringify(provider));
      const recovered = await cli.run(["exp", "incus-storage", "probe", "--rerun=all"], { cwd: root, env });
      const inventory = await cli.run(["sandbox", "provider", "inventory", "incus", "--development"], { cwd: root, env });
      expect(inventory.exitCode, `${recovered.diagnostic()}\n${inventory.diagnostic()}`).toBe(0);
      expect(inventory.stdout).toContain("committed");
      expect(inventory.stdout).toContain("4096 bytes estimate");
      expect(inventory.stdout).toContain("verified");
    });
  });
});
