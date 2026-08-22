// owner: docs/engineering/testing/e2e/cli.md#cli-cache-inventory
// rerun: pnpm e2e --repo cli -- --run test/cache-inventory.test.ts

import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test("共享 BuildKit 容量只作为未验证 Provider observation 展示", async () => {
  await cliE2E.case("cache-inventory", {}, async ({ commands: { niceeval }, paths }) => {
    const fakeBin = join(paths.projectRoot, "fixtures/cache-inventory/bin");
    const result = await niceeval.run(["cache", "inventory", "--json"], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    });

    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.stderr).toBe("");
    const document = JSON.parse(result.stdout) as {
      format: string;
      domains: unknown[];
      providerObservations: Array<Record<string, unknown>>;
    };
    expect(document.format).toBe("niceeval.cache-inventory");
    expect(document.domains).toEqual([]);
    expect(document.providerObservations).toEqual([{
      scope: "provider",
      backendKind: "buildkit",
      state: "unverified",
      observedAt: expect.any(String),
      totalBytes: 40_300_000_000,
      reclaimableEstimateBytes: 21_500_000_000,
      reason: "shared-builder-unattributed",
    }]);
    expect(result.stdout).not.toContain("domainId");
    expect(result.stdout).not.toContain("evictable");
    expect(result.stdout).not.toContain("planId");
  });
});
