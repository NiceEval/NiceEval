// owner: docs/engineering/testing/e2e/cli.md#cli-sandbox-project-preflight
// rerun: pnpm e2e test --repo cli -- --run test/sandbox-project-preflight.test.ts

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test("Sandbox 管理命令准备项目凭据但不求值项目配置", async () => {
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

    const receipt = await niceeval.run(["sandbox", "list"]);

    expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
    expect(receipt.stdout).toBe("No kept sandboxes.\n");
    expect(receipt.stderr).toBe("");
  });

  await cliE2E.case("sandbox-credentials-preflight", async ({ commands: { niceeval }, paths }) => {
    await mkdir(join(paths.projectRoot, ".niceeval"));
    await writeFile(
      join(paths.projectRoot, "niceeval.config.ts"),
      'throw new Error("sandbox config must stay unloaded");\nexport default {};\n',
      "utf8",
    );
    await mkdir(join(paths.projectRoot, ".env"));

    const receipt = await niceeval.run(["sandbox", "list"]);

    expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
    expect(receipt.stdout).toBe("");
    expect(receipt.stderr).toMatch(/ProjectCredentialsError|EISDIR|read-dotenv/);
    expect(receipt.stderr).not.toContain("sandbox config must stay unloaded");
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
      ["sandbox", "list", "--json"],
      ["--json", "sandbox", "list"],
    ]) {
      receipts.push(await niceeval.run(argv));
    }
    for (const receipt of receipts) {
      expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
      expect(receipt.stdout).toBe("");
      expect(receipt.stderr).toContain("Unknown option '--json'");
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
      { argv: ["--help", "sandbox", "list"], expected: "niceeval —" },
      { argv: ["sandbox", "list", "--help"], expected: "niceeval sandbox —" },
      { argv: ["docker", "--help"], expected: "niceeval docker —" },
      { argv: ["exp", "--help"], expected: "niceeval exp" },
      { argv: ["query", "--help"], expected: "niceeval query" },
      { argv: ["clean", "--help"], expected: "niceeval clean —" },
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
      { argv: ["sandbox", "list", "--domain", "docker-owned"], option: "--domain" },
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
