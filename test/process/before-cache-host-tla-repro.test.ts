// 跨进程保证：文件与锁——生产者私有 clone 失败时保留读者已租用的普通 Docker 镜像。
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { expect, test } from "vitest";

// @feature docs/feature/sandbox/README.md#shared-builds
test("leased image handoff", { timeout: 20_000 }, async () => {
  const path = fileURLToPath(new URL("../host/before-cache-image-lease-tla-repro.mjs", import.meta.url));
  const result = await execa(process.execPath, ["--conditions=niceeval-source", path], {
    reject: false,
    timeout: 15_000,
  });
  expect(result.exitCode, result.stderr).toBe(0);
});
