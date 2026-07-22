// 本仓库 scripts/evidence.ts 及所有 scripts/verify-<domain>.ts 模块共用的 shell 命令执行辅助函数
// (docs/engineering/testing/e2e/verification.md「执行 niceeval 命令」)。命令在调用方代码里以
// shell 字面量字符串的形式出现——就是开发者会敲的原样命令,可以直接复制出去手动重跑。这是唯一
// 拥有 spawnSync 底层逻辑的地方,这样各个 domain 脚本就不用各自重新实现一遍。

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

/**
 * 通过 shell 执行 `cmd`,断言其退出码与 `expect` 相符,并返回 stdout。
 * `expect: "nonzero"` 让一次预期会失败的调用(例如 deliberate-fail)成为一等公民场景,
 * 而不是被当作异常抛出。
 */
export function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(
    ok,
    `${cmd}\nexited ${exit}, expected ${expect}. stderr tail:\n${res.stderr.slice(-2000)}\nstdout tail:\n${res.stdout.slice(-2000)}`,
  );
  return res.stdout;
}
