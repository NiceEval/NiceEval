// 跨进程保证：运行环境——真实 CLI 入口在独立 cwd 交付机器文档和退出码
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { expect, test } from "vitest";
import { decodeRunDocument } from "niceeval/run";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
// @use-case docs/feature/run/use-case/查看运行.md#list
test("the real CLI exits successfully after streaming a complete Run list document", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "niceeval-cli-process-"));
  try {
    const result = await execa(process.execPath, [...process.execArgv, cli, "run", "list", "--json"], {
      cwd,
      reject: false,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(decodeRunDocument(JSON.parse(result.stdout))).toEqual({
      success: true,
      value: { operation: "run.list", runs: [], omitted: 0 },
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
