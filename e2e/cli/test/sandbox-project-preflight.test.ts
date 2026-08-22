// owner: docs/engineering/testing/e2e/cli.md#cli-sandbox-project-preflight
// rerun: pnpm e2e --repo cli -- --run test/sandbox-project-preflight.test.ts

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
});
