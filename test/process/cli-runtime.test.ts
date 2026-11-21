// 跨进程保证：运行环境——真实 CLI 入口对不支持的宿主提前输出诊断并退出
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { expect, test } from "vitest";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const args = ["--conditions=niceeval-source", cli, "--help"];
const bun = await execa("bun", ["--version"], { reject: false });
const nodeCommand = "Run with a supported Node.js installation: node ./node_modules/niceeval/bin/niceeval.js --help";

// @feature docs/cli.md#cli-startup
test.skipIf(bun.failed && bun.code === "ENOENT")(
  "Bun receives the Node.js requirement and an executable alternative",
  async () => {
    expect(bun.exitCode, bun.stderr).toBe(0);
    const result = await execa("bun", args, { reject: false });

    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `niceeval error: NiceEval requires Node.js >=24.15.0 (running on Bun ${bun.stdout}).\n${nodeCommand}`,
    );
  },
);

// @feature docs/cli.md#cli-startup
test("Node.js below the minimum version receives the same early diagnostic", async () => {
  const version = "24.14.0";
  const override = `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });`;
  const result = await execa(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(override)}`, ...args], {
    reject: false,
  });

  expect(result.exitCode, result.stderr).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    `niceeval error: NiceEval requires Node.js >=24.15.0 (running on Node.js ${version}).\n${nodeCommand}`,
  );
});
