import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { command, only, withProjectCopy, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";

// @feature docs/feature/inspection/README.md
// @issue docs/issues/show-cache-degraded-reason.md
test.concurrent("Cache degradation identifies its reason and affected Before node in saved Attempt diagnostics", async () => {
  await withProjectCopy({
    from: process.cwd(), prefix: "niceeval-e2e-show-degraded-",
    omitTopLevel: [".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  }, async ({ root }) => {
    await withTempDir("niceeval-show-degraded-runtime-", async (runtime) => {
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
        artifactStorageReserveBytes: 1024, artifactEstimatedBytes: 2048,
        dockerDataBytes: 1024 ** 3,
        workdir: "/home/sandbox/workspace", user: "node", hostGateway: "10.0.0.1",
        trustedBaseImages: [`niceeval/docker-execution-v1@sha256:${digest}`],
      }] }));
      await writeFile(join(root, "experiments/incus-storage.ts"), `
import { defineExperiment } from "niceeval";
import { incusSandbox, shell } from "niceeval/sandbox";
import { deterministicAgent } from "../agents/deterministic.ts";
export default defineExperiment({ adapter: deterministicAgent(),
  sandbox: incusSandbox({ image: "niceeval/docker-execution-v1@sha256:${digest}",
    project: "niceeval-eval-dev", storagePool: "niceeval-sandbox-dev", acceptDevelopmentDomain: true,
    resources: { dockerDataBytes: ${1024 ** 3} } }).before(shell({ id: "storage-prefix", command: "true" })),
  evals: ["inspection"], attempts: 1, maxConcurrency: 1 });
`);
      const env = {
        ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`,
        NICEEVAL_HOME: join(runtime, "user"), XDG_STATE_HOME: join(runtime, "xdg"),
        NICEEVAL_INCUS_DESCRIPTOR: descriptor,
        NICEEVAL_E2E_FAKE_INCUS_STATE: state, NICEEVAL_E2E_FAKE_INCUS_JOURNAL: journal,
      };
      const cli = command(["pnpm", "--silent", "exec", "niceeval"]);
      await writeFile(state, JSON.stringify({ instances: {}, volumes: {}, storageResources: { space: { total: 4096, used: 4000 } } }));
      const run = await cli.run(["exp", "incus-storage", "inspection", "--rerun=all", "--json"], { cwd: root, env });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      expect(run.expTerminal().summary.beforeCaches?.degraded, run.diagnostic()).toBe(1);
      const attempt = only(run.expEvalEvents(), (event) => event.evalId === "inspection", run.diagnostic());
      expect(attempt.verdict).toBe("errored");
      for (const slice of [[], ["execution"]]) {
        const shown = await cli.run(["show", attempt.locator, ...slice], { cwd: root, env });
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        expect(shown.stdout, shown.diagnostic()).toContain("cache-degraded");
        expect(shown.stdout, shown.diagnostic()).toContain("snapshot-uncertain");
        expect(shown.stdout, shown.diagnostic()).toContain("storage-prefix");
      }
      const provider = JSON.parse(await readFile(state, "utf8"));
      expect(Object.values(provider.instances).flatMap((instances) => Object.keys(instances ?? {}))).toEqual([]);
    });
  });
});
