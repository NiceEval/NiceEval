// rerun: pnpm e2e test --repo cli -- --run test/sandbox-project-preflight.test.ts

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";
// @feature docs/feature/sandbox-nested-docker/README.md

test("Sandbox Provider 诊断独立于项目配置和凭据，命令路由先完成用法检查", async () => {
  await cliE2E.case("sandbox-config-free", async ({ commands: { niceeval }, paths }) => {
    await mkdir(join(paths.projectRoot, ".niceeval"));
    await writeFile(
      join(paths.projectRoot, "niceeval.config.ts"),
      'throw new Error("sandbox config must stay unloaded");\nexport default {};\n',
      "utf8",
    );
    await writeFile(
      join(paths.projectRoot, ".env"),
      "NICEEVAL_E2E_SANDBOX_CREDENTIAL=delivered\n",
      "utf8",
    );

    const descriptor = join(paths.projectRoot, "missing-incus-provider.json");
    const receipt = await niceeval.run(["sandbox", "provider", "doctor", "incus"], {
      env: {
        NICEEVAL_HOME: join(paths.projectRoot, "maintenance-home"),
        NICEEVAL_INCUS_DESCRIPTOR: descriptor,
      },
    });

    expect(receipt.exitCode, receipt.diagnostic()).toBe(1);
    expect(receipt.stdout).toContain("niceeval sandbox provider doctor incus");
    expect(receipt.stdout).toContain("domain: reference");
    expect(receipt.stdout).toContain(`descriptor: ${descriptor}`);
    expect(receipt.stdout).toContain("status: FAIL (fail closed)");
    expect(receipt.stdout).toContain("descriptor: FAIL [incus-undeployed]");
    expect(receipt.stderr).toBe("");
  });

  await cliE2E.case("sandbox-with-unreadable-project-credentials", async ({ commands: { niceeval }, paths }) => {
    await mkdir(join(paths.projectRoot, ".niceeval"));
    await writeFile(
      join(paths.projectRoot, "niceeval.config.ts"),
      'throw new Error("sandbox config must stay unloaded");\nexport default {};\n',
      "utf8",
    );
    await mkdir(join(paths.projectRoot, ".env"));

    const descriptor = join(paths.projectRoot, "missing-incus-provider.json");
    const receipt = await niceeval.run(["sandbox", "provider", "doctor", "incus"], {
      env: {
        NICEEVAL_HOME: join(paths.projectRoot, "maintenance-home"),
        NICEEVAL_INCUS_DESCRIPTOR: descriptor,
      },
    });

    expect(receipt.exitCode, receipt.diagnostic()).toBe(1);
    expect(receipt.stdout).toContain(`descriptor: ${descriptor}`);
    expect(receipt.stdout).toContain("descriptor: FAIL [incus-undeployed]");
    expect(receipt.stderr).toBe("");
  });

  await cliE2E.case("sandbox-owned-options", async ({ commands: { niceeval }, paths }) => {
    await mkdir(join(paths.projectRoot, ".niceeval"));
    await writeFile(
      join(paths.projectRoot, "niceeval.config.ts"),
      'throw new Error("sandbox config must stay unloaded");\nexport default {};\n',
      "utf8",
    );
    await mkdir(join(paths.projectRoot, ".env"));

    const receipts = [];
    for (const argv of [
      ["sandbox", "provider", "doctor", "incus", "--json"],
      ["--json", "sandbox", "provider", "doctor", "incus"],
    ]) {
      receipts.push(await niceeval.run(argv));
    }
    for (const receipt of receipts) {
      expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
      expect(receipt.stdout).toBe("");
      expect(receipt.stderr).toContain("Incus maintenance flags require inventory or gc.");
      expect(receipt.stderr).not.toMatch(/ProjectCredentialsError|EISDIR|read-dotenv/);
      expect(receipt.stderr).not.toContain("sandbox config must stay unloaded");
    }
  });

  await cliE2E.case("contribution-routing-before-project-preflight", async ({ commands: { niceeval }, paths }) => {
    await writeFile(
      join(paths.projectRoot, "niceeval.config.ts"),
      'throw new Error("contribution routing must stay before project preflight");\nexport default {};\n',
      "utf8",
    );
    await mkdir(join(paths.projectRoot, ".env"));

    const helpCases = [
      { argv: ["--help", "sandbox", "provider", "doctor", "incus"], expected: "niceeval —" },
      { argv: ["sandbox", "provider", "doctor", "incus", "--help"], expected: "niceeval sandbox provider doctor —" },
      { argv: ["docker", "--help"], expected: "niceeval docker —" },
      { argv: ["exp", "--help"], expected: "niceeval exp" },
      { argv: ["show", "--help"], expected: "niceeval show" },
      { argv: ["run", "--help"], expected: "niceeval run" },
      { argv: ["init", "--help"], expected: "niceeval init —" },
    ] as const;

    for (const { argv, expected } of helpCases) {
      const receipt = await niceeval.run(argv);
      expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
      expect(receipt.stdout).toContain(expected);
      expect(receipt.stderr).not.toMatch(/ProjectCredentialsError|EISDIR|read-dotenv/);
      expect(receipt.stderr).not.toContain("contribution routing must stay before project preflight");
    }

    const rejectedCases = [
      { argv: ["docker", "cache", "inventory", "--record", ".niceeval/record"], option: "--record" },
      { argv: ["sandbox", "provider", "doctor", "incus", "--domain", "docker-owned"], option: "--domain" },
    ] as const;

    for (const { argv, option } of rejectedCases) {
      const receipt = await niceeval.run(argv);
      expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
      expect(receipt.stdout).toBe("");
      expect(receipt.stderr).toContain(`Unknown option '${option}'`);
      expect(receipt.stderr).not.toMatch(/ProjectCredentialsError|EISDIR|read-dotenv/);
      expect(receipt.stderr).not.toContain("contribution routing must stay before project preflight");
    }
  });
});
