// 跨进程保证：外部程序与 Provider——通过宿主 journal、Unix socket 与 SQLite 检查 capture、恢复及租约交接。
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { expect, test } from "vitest";

// @feature docs/feature/sandbox/README.md#shared-builds
test.each([
  ["short append and journal reopen", "before-cache-journal-tla-repro.py"],
  ["concurrent seed publication, reservation release and daemon rotation", "before-cache-contention-tla-repro.py"],
  ["leased image handoff", "before-cache-image-lease-tla-repro.mjs"],
])("%s", { timeout: 20_000 }, async (_, fixture) => {
  const path = fileURLToPath(new URL(`../host/${fixture}`, import.meta.url));
  const result = fixture.endsWith(".py")
    ? await execa("python3", ["-B", path], { reject: false, timeout: 15_000 })
    : await execa(process.execPath, ["--conditions=niceeval-source", path], { reject: false, timeout: 15_000 });
  expect(result.exitCode, result.stderr).toBe(0);
});
