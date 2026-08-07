// feature: docs/engineering/testing/e2e/package.md — 安装后运行时入口 smoke
//
// 纯 raw Node 18 smoke：CI 可直接 `node e2e/package/smoke.mjs` 执行（不经 Vitest/tsx），
// 复用 Journey A 的入口遍历逻辑（fixtures/traverse-entries.mjs）。stdout 输出 JSON
// report，任一 hard failure 时进程以非零退出。

import { traverseInstalledEntries } from "./fixtures/traverse-entries.mjs";

const report = await traverseInstalledEntries({ packageName: "niceeval" });

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) {
  for (const failure of report.failures) {
    const specifier = failure.specifier ? `${failure.specifier}: ` : "";
    process.stderr.write(`[smoke] ${failure.kind} ${specifier}${JSON.stringify(failure.detail)}\n`);
  }
  process.exitCode = 1;
}
