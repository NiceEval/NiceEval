// 候选发布包的消费方边界回归：niceeval 自己拥有的 report 运行时与内建组件必须使用包内
// 预编译 ESM，不能让消费方 cwd 的 tsconfig JSX 设置接管 package-owned TSX。这个故障只有
// 「候选 tarball 安装后 + 外部 cwd + 独立进程」能观察；同仓源码 import 或 report 仓库自身
// 的 react-jsx tsconfig 都会把它掩盖。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Evidence } from "./evidence.ts";

interface ConsumerScenario {
  name: string;
  tsconfig?: object;
}

const SCENARIOS: readonly ConsumerScenario[] = [
  { name: "no tsconfig" },
  {
    name: "classic JSX",
    tsconfig: {
      compilerOptions: {
        jsx: "react",
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
      },
    },
  },
  {
    name: "react-jsx",
    tsconfig: {
      compilerOptions: {
        jsx: "react-jsx",
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
      },
    },
  },
];

export function verifyPackageConsumer(evidence: Evidence): void {
  const repoRoot = process.cwd();
  const installedNiceeval = resolve(repoRoot, "node_modules", "niceeval");
  const resultsRoot = resolve(repoRoot, evidence.resultsRoot);
  const consumerRoot = mkdtempSync(join(tmpdir(), "niceeval-e2e-package-consumer-"));

  try {
    mkdirSync(join(consumerRoot, "node_modules"), { recursive: true });
    symlinkSync(installedNiceeval, join(consumerRoot, "node_modules", "niceeval"), "dir");
    writeFileSync(
      join(consumerRoot, "report.mjs"),
      'export { default } from "niceeval/report/built-in";\n',
      "utf8",
    );
    const niceevalBin = join(consumerRoot, "node_modules", "niceeval", "bin", "niceeval.js");

    for (const scenario of SCENARIOS) {
      const tsconfigPath = join(consumerRoot, "tsconfig.json");
      rmSync(tsconfigPath, { force: true });
      if (scenario.tsconfig !== undefined) {
        writeFileSync(tsconfigPath, `${JSON.stringify(scenario.tsconfig, null, 2)}\n`, "utf8");
      }

      const result = spawnSync(
        process.execPath,
        [niceevalBin, "show", "--record", resultsRoot, "--report", "report.mjs"],
        {
          cwd: consumerRoot,
          encoding: "utf8",
          env: { ...process.env, NICEEVAL_LANG: "en" },
        },
      );
      const exit = result.status ?? -1;
      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      const combined = `${stdout}\n${stderr}`;

      assert.equal(
        exit,
        0,
        `candidate package failed from a consumer cwd with ${scenario.name} (exit ${exit}):\n${combined.slice(-3000)}`,
      );
      assert.doesNotMatch(combined, /ReferenceError|React is not defined/);
      assert.match(stdout, /tool-call/, `built-in report did not render real evidence with ${scenario.name}`);
      // 内建 standard 首页含 Report 导航页与 SampleOverview；断言包内 ESM 真的执行了 render。
      assert.match(
        stdout,
        /Pass rate|通过率|Attempts|Traces/,
        `built-in report components were not evaluated with ${scenario.name}`,
      );
    }
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true });
  }
}
