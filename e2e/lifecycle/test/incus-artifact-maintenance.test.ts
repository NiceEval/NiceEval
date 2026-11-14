import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { command, withProjectCopy, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";

const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const artifactProject = "niceeval-artifacts-dev";
const pool = "niceeval-sandbox-dev";

// @feature docs/feature/sandbox-nested-docker/README.md
// @regression memory/incus-artifact-maintenance.md
test.concurrent("Incus artifact maintenance diagnoses missing pairs and reclaims only the previewed intents", async () => {
  await withProjectCopy(
    {
      from: process.cwd(),
      prefix: "niceeval-e2e-incus-maintenance-",
      omitTopLevel: [".niceeval", "node_modules", "test"],
      links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
    },
    async ({ root }) => {
      await withTempDir("niceeval-incus-maintenance-runtime-", async (runtime) => {
        const bin = join(runtime, "bin");
        const descriptor = join(runtime, "descriptor.json");
        const state = join(runtime, "provider.json");
        const journal = join(runtime, "provider.ndjson");
        await mkdir(bin);
        await writeFile(
          join(bin, "incus"),
          `#!/usr/bin/env node\nawait import(${JSON.stringify(pathToFileURL(resolve("fixtures/fake-incus.mjs")).href)});\n`,
        );
        await chmod(join(bin, "incus"), 0o755);
        await writeFile(
          descriptor,
          JSON.stringify({
            schemaVersion: "niceeval.incus-provider/v2",
            domains: [
              {
                name: "development",
                status: "configured",
                executionDomainId: "maintenance-development",
                project: "niceeval-eval-dev",
                storagePool: pool,
                network: "niceeval-dev",
                storage: "development-dir",
                quota: "unattested",
                maxInstances: 4,
                artifactProject,
                artifactMaxInstances: 4,
                artifactStorageReserveBytes: 1024,
                artifactEstimatedBytes: 2048,
                dockerDataBytes: 1024 ** 3,
                workdir: "/home/sandbox/workspace",
                user: "node",
                hostGateway: "10.0.0.1",
                trustedBaseImages: [`niceeval/docker-execution-v1@sha256:${digest}`],
              },
            ],
          }),
        );
        const env = {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          NICEEVAL_HOME: join(runtime, "user"),
          XDG_STATE_HOME: join(runtime, "xdg"),
          NICEEVAL_INCUS_DESCRIPTOR: descriptor,
          NICEEVAL_E2E_FAKE_INCUS_STATE: state,
          NICEEVAL_E2E_FAKE_INCUS_JOURNAL: journal,
        };
        const cli = command(["pnpm", "--silent", "exec", "niceeval"]);
        const empty = await cli.run(["sandbox", "provider", "inventory", "incus", "--development"], { cwd: root, env });
        expect(empty.exitCode, empty.diagnostic()).toBe(0);
        expect(empty.stdout).toContain("0 entries");

        await writeFile(
          join(root, "experiments/incus-maintenance.ts"),
          `
import { defineExperiment } from "niceeval";
import { incusSandbox, shell } from "niceeval/sandbox";
import { quickAgent } from "../agents/deterministic.ts";
export default defineExperiment({ adapter: quickAgent,
  sandbox: incusSandbox({ image: "niceeval/docker-execution-v1@sha256:${digest}",
    project: "niceeval-eval-dev", storagePool: "${pool}", acceptDevelopmentDomain: true,
    resources: { dockerDataBytes: ${1024 ** 3} } }).before(shell({ id: "maintenance-prefix", command: "true" })),
  evals: ["probe"], attempts: 1, maxConcurrency: 1 });
`,
        );
        const cold = await cli.run(["exp", "incus-maintenance", "probe", "--rerun=all"], { cwd: root, env });
        expect(cold.exitCode, "the external provider fixture fails agent.install after copying the artifact").not.toBe(
          0,
        );
        const healthy = await cli.run(["sandbox", "provider", "doctor", "incus", "--development"], { cwd: root, env });
        expect(healthy.exitCode, `${cold.diagnostic()}\n${healthy.diagnostic()}`).toBe(0);
        expect(healthy.stdout).toContain("1 committed intents, 1 verified object pairs");
        expect(healthy.stdout).toContain("artifact-storage: PASS");

        // Only the external provider's state is fault-injected. NiceEval's durable
        // intents are created and observed exclusively through installed CLI calls.
        const provider = JSON.parse(await readFile(state, "utf8"));
        const original = structuredClone(provider);
        provider.volumes[`${artifactProject}\u0000${pool}`] = {};
        await writeFile(state, JSON.stringify(provider));
        const partial = await cli.run(["sandbox", "provider", "doctor", "incus", "--development"], { cwd: root, env });
        expect(partial.exitCode, partial.diagnostic()).toBe(1);
        expect(partial.stdout).toContain("dangling");
        const excluded = await cli.run(["sandbox", "provider", "gc", "incus", "--development", "--unused-for", "1ms"], {
          cwd: root,
          env,
        });
        expect(excluded.exitCode, excluded.diagnostic()).toBe(0);
        expect(excluded.stdout).toContain("0 candidates");

        await writeFile(state, JSON.stringify(original));
        const preview = await cli.run(["sandbox", "provider", "gc", "incus", "--development", "--unused-for", "1ms"], {
          cwd: root,
          env,
        });
        expect(preview.exitCode, preview.diagnostic()).toBe(0);
        expect(preview.stdout).toContain("1 candidates");
        expect(preview.stdout).toContain("unused");
        const planId = /GC preview ([a-f0-9-]+)/u.exec(preview.stdout)?.[1];
        expect(planId, preview.diagnostic()).toBeTruthy();

        // A new successful lease after preview invalidates this candidate's use
        // evidence, even once the consumer has settled and released the lease.
        await cli.run(["exp", "incus-maintenance", "probe", "--rerun=all"], { cwd: root, env });
        const drift = await cli.run(["sandbox", "provider", "gc", "incus", "--development", "--apply", planId!], {
          cwd: root,
          env,
        });
        expect(drift.exitCode, drift.diagnostic()).toBe(1);
        expect(drift.stdout).toContain("skipped");

        provider.instances[artifactProject] = {};
        await writeFile(state, JSON.stringify(provider));
        const missing = await cli.run(["sandbox", "provider", "inventory", "incus", "--development"], {
          cwd: root,
          env,
        });
        expect(missing.exitCode, missing.diagnostic()).toBe(0);
        expect(missing.stdout).toContain("dangling");
        const absentPreview = await cli.run(["sandbox", "provider", "gc", "incus", "--development"], {
          cwd: root,
          env,
        });
        expect(absentPreview.exitCode, absentPreview.diagnostic()).toBe(0);
        expect(absentPreview.stdout).toContain("dangling-intent");
        const absentPlan = /GC preview ([a-f0-9-]+)/u.exec(absentPreview.stdout)?.[1];
        expect(absentPlan).toBeTruthy();
        const beforeApply = await readFile(journal, "utf8");
        const applied = await cli.run(["sandbox", "provider", "gc", "incus", "--development", "--apply", absentPlan!], {
          cwd: root,
          env,
        });
        expect(applied.exitCode, applied.diagnostic()).toBe(0);
        expect(applied.stdout).toContain("already-absent");
        const afterApply = (await readFile(journal, "utf8")).slice(beforeApply.length);
        expect(afterApply).not.toContain('"method":"DELETE"');
        const repeated = await cli.run(
          ["sandbox", "provider", "gc", "incus", "--development", "--apply", absentPlan!],
          { cwd: root, env },
        );
        expect(repeated.exitCode, repeated.diagnostic()).toBe(0);
        expect(repeated.stdout).toBe(applied.stdout);
        const released = await cli.run(["sandbox", "provider", "inventory", "incus", "--development"], {
          cwd: root,
          env,
        });
        expect(released.exitCode, released.diagnostic()).toBe(0);
        expect(released.stdout).toContain("released");
        const finalDoctor = await cli.run(["sandbox", "provider", "doctor", "incus", "--development"], {
          cwd: root,
          env,
        });
        expect(finalDoctor.exitCode, finalDoctor.diagnostic()).toBe(0);
        expect(finalDoctor.stdout).toContain("4 free of 4");

        // Rebuild through the public entry, then exercise a real pair deletion.
        await cli.run(["exp", "incus-maintenance", "probe", "--rerun=all"], { cwd: root, env });
        const rebuilt = JSON.parse(await readFile(state, "utf8"));
        const names = Object.keys(rebuilt.instances[artifactProject]);
        expect(names).toHaveLength(1);
        expect(Object.keys(rebuilt.volumes[`${artifactProject}\u0000${pool}`])).toHaveLength(1);
        const exact = structuredClone(rebuilt);
        rebuilt.instances[artifactProject][names[0]!].config["user.niceeval.manifestDigest"] =
          "drifted-external-metadata";
        await writeFile(state, JSON.stringify(rebuilt));
        const driftInventory = await cli.run(["sandbox", "provider", "inventory", "incus", "--development"], {
          cwd: root,
          env,
        });
        expect(driftInventory.exitCode, driftInventory.diagnostic()).toBe(0);
        expect(driftInventory.stdout).toContain("metadata-drift");
        const driftPreview = await cli.run(
          ["sandbox", "provider", "gc", "incus", "--development", "--unused-for", "1ms"],
          { cwd: root, env },
        );
        expect(driftPreview.exitCode, driftPreview.diagnostic()).toBe(0);
        expect(driftPreview.stdout).toContain("0 candidates");
        expect(Object.keys(JSON.parse(await readFile(state, "utf8")).instances[artifactProject])).toEqual(names);

        await writeFile(state, JSON.stringify(exact));
        const deletePreview = await cli.run(
          ["sandbox", "provider", "gc", "incus", "--development", "--unused-for", "1ms"],
          { cwd: root, env },
        );
        expect(deletePreview.exitCode, deletePreview.diagnostic()).toBe(0);
        expect(deletePreview.stdout).toContain("1 candidates");
        const deletePlan = /GC preview ([a-f0-9-]+)/u.exec(deletePreview.stdout)?.[1];
        expect(deletePlan).toBeTruthy();
        await writeFile(`${state}.fail-next`, `DELETE /1.0/instances/${names[0]!}`);
        const failedDelete = await cli.run(
          ["sandbox", "provider", "gc", "incus", "--development", "--apply", deletePlan!],
          { cwd: root, env },
        );
        expect(failedDelete.exitCode, failedDelete.diagnostic()).toBe(1);
        expect(failedDelete.stdout).toContain("1 failed");
        expect(Object.keys(JSON.parse(await readFile(state, "utf8")).instances[artifactProject])).toEqual(names);

        // A durable failed outcome must not strand the invalidated intent. Fresh
        // previews continue its recorded retirement without choosing another LRU cutoff.
        const retryPreview = await cli.run(["sandbox", "provider", "gc", "incus", "--development"], { cwd: root, env });
        expect(retryPreview.exitCode, retryPreview.diagnostic()).toBe(0);
        expect(retryPreview.stdout).toContain("1 candidates");
        const retryPlan = /GC preview ([a-f0-9-]+)/u.exec(retryPreview.stdout)?.[1];
        expect(retryPlan).toBeTruthy();
        const stalePreview = await cli.run(["sandbox", "provider", "gc", "incus", "--development"], { cwd: root, env });
        expect(stalePreview.exitCode, stalePreview.diagnostic()).toBe(0);
        expect(stalePreview.stdout).toContain("1 candidates");
        const stalePlan = /GC preview ([a-f0-9-]+)/u.exec(stalePreview.stdout)?.[1];
        expect(stalePlan).toBeTruthy();
        const volumeNames = Object.keys(exact.volumes[`${artifactProject}\u0000${pool}`]);
        await writeFile(`${state}.fail-next`, `DELETE /1.0/storage-pools/${pool}/volumes/custom/${volumeNames[0]!}`);
        const partialDelete = await cli.run(
          ["sandbox", "provider", "gc", "incus", "--development", "--apply", retryPlan!],
          { cwd: root, env },
        );
        expect(partialDelete.exitCode, partialDelete.diagnostic()).toBe(1);
        expect(partialDelete.stdout).toContain("1 failed");
        const interrupted = JSON.parse(await readFile(state, "utf8"));
        expect(Object.keys(interrupted.instances[artifactProject])).toEqual([]);
        expect(Object.keys(interrupted.volumes[`${artifactProject}\u0000${pool}`])).toEqual(volumeNames);

        const beforeStale = await readFile(journal, "utf8");
        const staleApply = await cli.run(
          ["sandbox", "provider", "gc", "incus", "--development", "--apply", stalePlan!],
          { cwd: root, env },
        );
        expect(staleApply.exitCode, staleApply.diagnostic()).toBe(1);
        expect(staleApply.stdout).toContain("1 skipped");
        expect((await readFile(journal, "utf8")).slice(beforeStale.length)).not.toContain('"method":"DELETE"');

        const driftedRemainder = structuredClone(interrupted);
        driftedRemainder.volumes[`${artifactProject}\u0000${pool}`][volumeNames[0]!].config[
          "user.niceeval.manifestDigest"
        ] = "drifted-during-retirement";
        await writeFile(state, JSON.stringify(driftedRemainder));
        const unsafeRetry = await cli.run(["sandbox", "provider", "gc", "incus", "--development"], { cwd: root, env });
        expect(unsafeRetry.exitCode, unsafeRetry.diagnostic()).toBe(0);
        expect(unsafeRetry.stdout).toContain("0 candidates");
        await writeFile(state, JSON.stringify(interrupted));
        const resumePreview = await cli.run(["sandbox", "provider", "gc", "incus", "--development"], {
          cwd: root,
          env,
        });
        expect(resumePreview.exitCode, resumePreview.diagnostic()).toBe(0);
        expect(resumePreview.stdout).toContain("1 candidates");
        const resumePlan = /GC preview ([a-f0-9-]+)/u.exec(resumePreview.stdout)?.[1];
        expect(resumePlan).toBeTruthy();
        const deleted = await cli.run(["sandbox", "provider", "gc", "incus", "--development", "--apply", resumePlan!], {
          cwd: root,
          env,
        });
        expect(deleted.exitCode, deleted.diagnostic()).toBe(0);
        expect(deleted.stdout).toContain("1 deleted");
        const afterDelete = JSON.parse(await readFile(state, "utf8"));
        expect(Object.keys(afterDelete.instances[artifactProject])).toEqual([]);
        expect(Object.keys(afterDelete.volumes[`${artifactProject}\u0000${pool}`])).toEqual([]);
        const afterDeleteInventory = await cli.run(["sandbox", "provider", "inventory", "incus", "--development"], {
          cwd: root,
          env,
        });
        expect(afterDeleteInventory.exitCode, afterDeleteInventory.diagnostic()).toBe(0);
        expect(afterDeleteInventory.stdout).toContain("released");
        expect(afterDeleteInventory.stdout).not.toContain(" · committed · ");
        const beforeReplay = await readFile(journal, "utf8");
        const oldReplay = await cli.run(
          ["sandbox", "provider", "gc", "incus", "--development", "--apply", deletePlan!],
          { cwd: root, env },
        );
        expect(oldReplay.exitCode, oldReplay.diagnostic()).toBe(1);
        expect(oldReplay.stdout).toBe(failedDelete.stdout);
        expect((await readFile(journal, "utf8")).slice(beforeReplay.length)).not.toContain('"method":"DELETE"');
      });
    },
  );
});
