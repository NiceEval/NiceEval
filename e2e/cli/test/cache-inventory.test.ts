// owner: docs/engineering/testing/e2e/cli.md#cli-cache-inventory
// rerun: pnpm e2e test --repo cli -- --run test/cache-inventory.test.ts

import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test("共享 BuildKit 容量只作为未验证 Provider observation 展示", async () => {
  await cliE2E.case("cache-inventory", {}, async ({ commands: { niceeval }, paths }) => {
    const fakeBin = join(paths.projectRoot, "fixtures/cache-inventory/bin");
    const stateRoot = join(paths.projectRoot, "state");
    const rootHelp = await niceeval.run(["--help"]);
    expect(rootHelp.exitCode, rootHelp.diagnostic()).toBe(0);
    expect(rootHelp.stdout).toContain("niceeval docker");
    expect(rootHelp.stdout).not.toContain("niceeval cache");

    const dockerHelp = await niceeval.run(["docker", "--help"]);
    expect(dockerHelp.exitCode, dockerHelp.diagnostic()).toBe(0);
    expect(dockerHelp.stdout).toContain("profile");
    expect(dockerHelp.stdout).toContain("cache");

    const cacheHelp = await niceeval.run(["docker", "cache", "--help"]);
    expect(cacheHelp.exitCode, cacheHelp.diagnostic()).toBe(0);
    expect(cacheHelp.stdout).toContain("docker cache inventory");
    expect(cacheHelp.stdout).toContain("docker cache gc");

    const unknownDocker = await niceeval.run(["docker", "volume", "list"]);
    expect(unknownDocker.exitCode, unknownDocker.diagnostic()).not.toBe(0);
    expect(unknownDocker.stderr).toContain('Unknown Docker command "volume"');

    const removedRoot = await niceeval.run(["cache", "inventory", "--json"]);
    expect(removedRoot.exitCode, removedRoot.diagnostic()).not.toBe(0);
    expect(removedRoot.stderr).toContain('Unknown command "cache"');

    const result = await niceeval.run(["docker", "cache", "inventory", "--json"], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, XDG_STATE_HOME: stateRoot },
    });

    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.stderr).toBe("");
    const document = JSON.parse(result.stdout) as {
      format: string;
      domains: unknown[];
      providerObservations: Array<Record<string, unknown>>;
    };
    expect(document.format).toBe("niceeval.cache-inventory");
    expect(document.domains).toEqual([{
      domainId: expect.any(String),
      providerFamily: "docker",
      backendKind: "docker-images",
      state: "verified-managed",
      entryCount: 0,
    }]);
    expect(document.providerObservations).toEqual([{
      scope: "provider",
      providerFamily: "docker",
      backendKind: "buildkit",
      state: "unverified",
      observedAt: expect.any(String),
      totalBytes: 40_300_000_000,
      reclaimableEstimateBytes: 21_500_000_000,
      reason: "shared-builder-unattributed",
    }]);
    expect(result.stdout).not.toContain("evictable");
    expect(result.stdout).not.toContain("planId");

    const human = await niceeval.run(["--", "docker", "cache", "inventory"], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, XDG_STATE_HOME: stateRoot },
    });
    expect(human.exitCode, human.diagnostic()).toBe(0);
    expect(human.stderr).toBe("");
    expect(human.stdout).toContain("Docker images · managed");
    expect(human.stdout).toContain("BuildKit · unverified shared-builder capacity");
    expect(human.stdout).toContain("NiceEval ownership unknown · not eligible for NiceEval GC");

    const domainId = (document.domains[0] as { domainId: string }).domainId;
    const detail = await niceeval.run(["docker", "cache", "inventory", "--domain", domainId, "--json"], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, XDG_STATE_HOME: stateRoot },
    });
    expect(detail.exitCode, detail.diagnostic()).toBe(0);
    expect(JSON.parse(detail.stdout)).toMatchObject({
      scope: { kind: "domain", domainId },
      entries: [],
      providerObservations: [],
    });

    const preview = await niceeval.run(["docker", "cache", "gc", "--domain", domainId, "--json"], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, XDG_STATE_HOME: stateRoot },
    });
    expect(preview.exitCode, preview.diagnostic()).toBe(0);
    const previewDocument = JSON.parse(preview.stdout) as { format: string; plan: { planId: string; candidates: unknown[] } };
    expect(previewDocument.format).toBe("niceeval.cache-gc-plan");
    expect(previewDocument.plan.candidates).toEqual([]);

    const apply = await niceeval.run(["docker", "cache", "gc", "--domain", domainId, "--apply", previewDocument.plan.planId, "--json"], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, XDG_STATE_HOME: stateRoot },
    });
    expect(apply.exitCode, apply.diagnostic()).toBe(0);
    expect(JSON.parse(apply.stdout)).toMatchObject({ format: "niceeval.cache-gc-outcome", outcomes: [] });
  });
});
