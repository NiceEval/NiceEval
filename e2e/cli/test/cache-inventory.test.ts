// owner: docs/engineering/testing/e2e/cli.md#cli-cache-inventory
// rerun: pnpm e2e --repo cli -- --run test/cache-inventory.test.ts

import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test("共享 BuildKit 容量只作为未验证 Provider observation 展示", async () => {
  await cliE2E.case("cache-inventory", {}, async ({ commands: { niceeval }, paths }) => {
    const fakeBin = join(paths.projectRoot, "fixtures/cache-inventory/bin");
    const stateRoot = join(paths.projectRoot, "state");
    const result = await niceeval.run(["cache", "inventory", "--json"], {
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

    const domainId = (document.domains[0] as { domainId: string }).domainId;
    const detail = await niceeval.run(["cache", "inventory", "--domain", domainId, "--json"], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, XDG_STATE_HOME: stateRoot },
    });
    expect(detail.exitCode, detail.diagnostic()).toBe(0);
    expect(JSON.parse(detail.stdout)).toMatchObject({
      scope: { kind: "domain", domainId },
      entries: [],
      providerObservations: [],
    });

    const preview = await niceeval.run(["cache", "gc", "--domain", domainId, "--json"], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, XDG_STATE_HOME: stateRoot },
    });
    expect(preview.exitCode, preview.diagnostic()).toBe(0);
    const previewDocument = JSON.parse(preview.stdout) as { format: string; plan: { planId: string; candidates: unknown[] } };
    expect(previewDocument.format).toBe("niceeval.cache-gc-plan");
    expect(previewDocument.plan.candidates).toEqual([]);

    const apply = await niceeval.run(["cache", "gc", "--domain", domainId, "--apply", previewDocument.plan.planId, "--json"], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}`, XDG_STATE_HOME: stateRoot },
    });
    expect(apply.exitCode, apply.diagnostic()).toBe(0);
    expect(JSON.parse(apply.stdout)).toMatchObject({ format: "niceeval.cache-gc-outcome", outcomes: [] });
  });
});
