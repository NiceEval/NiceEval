// 读面 CLI 的用法错误矩阵(docs/engineering/testing/e2e/report.md §4「用法错误矩阵」):
// show / view 的 flag 组合语义在真实进程上以非零退出与 error:/fix: 三段式验收。全部错误都
// 发生在装载与渲染之前,不产生模型调用;对 evidence.resultsRoot 只读,可以排在 verifyReadback
// 之前的任意位置(见 scripts/e2e.ts 文件头的顺序规则)。
//
// 风格遵循 docs/engineering/testing/e2e/verification.md:命令是开发者会敲的 shell 字面量,
// 用 node:assert/strict,遇到第一个被破坏的契约就抛出。错误文案按英文断言,命令前缀固定
// LC_ALL 让断言不随 CI 宿主机 locale 漂移。

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import type { Evidence } from "./evidence.ts";

/** 执行一条预期失败的读面命令:断言非零退出,返回 stdout+stderr 合并文本供文案断言。 */
function shUsageError(cmd: string): string {
  const full = `LC_ALL=en_US.UTF-8 ${cmd}`;
  const res = spawnSync(full, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  assert.notEqual(exit, 0, `${full}\nexpected a usage-error exit, got 0. stdout tail:\n${res.stdout.slice(-2000)}`);
  return `${res.stdout}\n${res.stderr}`;
}

function assertMentions(output: string, needles: string[], cmd: string): void {
  for (const needle of needles) {
    assert.ok(output.includes(needle), `${cmd}\nusage error should mention ${JSON.stringify(needle)}; got:\n${output.slice(-2000)}`);
  }
}

export async function verifyUsageErrors(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;
  const locator = evidence.main.attempts[0]!.locator;
  const scratch = mkdtempSync(join(tmpdir(), "niceeval-usage-errors-"));
  try {
    // --- @<locator>:语法非法、索引未命中、与其它位置参数混用 ---
    let cmd = `pnpm exec niceeval show @not-valid --record ${root}`;
    assertMentions(shUsageError(cmd), ["not a valid attempt locator"], cmd);

    cmd = `pnpm exec niceeval show @1nosuch1 --record ${root}`;
    assertMentions(shUsageError(cmd), ["No attempt found"], cmd);

    cmd = `pnpm exec niceeval show ${locator} tool-call --record ${root}`;
    assertMentions(shUsageError(cmd), ["must be the only positional argument"], cmd);

    // --- --history / --stats 与 --page、--report、locator 的互斥矩阵 ---
    cmd = `pnpm exec niceeval show --history --page report --record ${root}`;
    assertMentions(shUsageError(cmd), ["--page"], cmd);

    cmd = `pnpm exec niceeval show --history --report reports/x.tsx --record ${root}`;
    assertMentions(shUsageError(cmd), ["mutually exclusive"], cmd);

    cmd = `pnpm exec niceeval show ${locator} --stats --record ${root}`;
    assertMentions(shUsageError(cmd), ["error:", "fix:", "--stats cannot combine with a locator"], cmd);

    cmd = `pnpm exec niceeval show --stats --page report --record ${root}`;
    assertMentions(shUsageError(cmd), ["--stats"], cmd);

    // --- 对照语义(--exp 出现两次以上):每个 --exp 必须恰好命中一个 experiment ---
    // "deliberate" 是 deliberate-fail 与 deliberate-error 的共同前缀:命中 2 个要列出全部候选。
    cmd = `pnpm exec niceeval show --exp deliberate --exp main --record ${root}`;
    assertMentions(shUsageError(cmd), ["error:", "fix:", "matched 2 experiments", "deliberate-fail", "deliberate-error"], cmd);

    cmd = `pnpm exec niceeval show --exp main --exp nosuch --record ${root}`;
    assertMentions(shUsageError(cmd), ["No experiment matched --exp nosuch"], cmd);

    cmd = `pnpm exec niceeval show ${locator} --exp main --exp deliberate-fail --record ${root}`;
    assertMentions(shUsageError(cmd), ["error:", "fix:", "cannot combine with repeated --exp"], cmd);

    // --- --grep / --expand:正则合法性、组合面与单 attempt 要求 ---
    cmd = `pnpm exec niceeval show --execution --grep "(unclosed" --record ${root}`;
    assertMentions(shUsageError(cmd), ["error:", "fix:", "not a valid JS regular expression"], cmd);

    cmd = `pnpm exec niceeval show --grep x --record ${root}`;
    assertMentions(shUsageError(cmd), ["--grep only combines with --execution"], cmd);

    cmd = `pnpm exec niceeval show --execution --grep x --expand t1.c1 --record ${root}`;
    assertMentions(shUsageError(cmd), ["cannot combine"], cmd);

    // main:"tool-call" 有 attempts: 2 的两个真实 attempt——不收窄到单 attempt 时 --expand 必须拒绝。
    cmd = `pnpm exec niceeval show tool-call --execution --expand t1.c1 --record ${root}`;
    assertMentions(shUsageError(cmd), ["resolve to exactly one attempt, got 2"], cmd);

    // --- --report 装载失败与 --page 未命中 ---
    cmd = `pnpm exec niceeval show --report ${join(scratch, "missing.tsx")} --record ${root}`;
    assertMentions(shUsageError(cmd), ["Report file not found"], cmd);

    const badReport = join(scratch, "bad.mjs");
    writeFileSync(badReport, "export default {};\n", "utf8");
    cmd = `pnpm exec niceeval show --report ${badReport} --record ${root}`;
    assertMentions(shUsageError(cmd), ["does not default-export a report", "defineReport"], cmd);

    cmd = `pnpm exec niceeval show --page typo --record ${root}`;
    assertMentions(shUsageError(cmd), ['page "typo" not found in the built-in report', "Available pages"], cmd);

    // --- view 的输入校验:--record/--run 互斥、不存在路径直说 ---
    cmd = `pnpm exec niceeval view --record ${root} --run ${join(root, "nope.json")}`;
    assertMentions(shUsageError(cmd), ["mutually exclusive"], cmd);

    cmd = `pnpm exec niceeval view --record ${join(scratch, "nope")}`;
    assertMentions(shUsageError(cmd), ["Record directory not found"], cmd);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
