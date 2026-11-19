import { globSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Reporter } from "vitest/node";

const costLimits = new Map([
  ["integration", 1000],
  ["cli", 300],
  ["process", 10000],
]);
const processGuarantee =
  /^(?:\/\/[^\n]*\n)*\/\/ 跨进程保证：(进程终止与信号|外部程序与 Provider|文件与锁|运行环境|网络)——\S/u;

export default {
  onInit(ctx) {
    const root = ctx.config.root;
    const missing = globSync("test/process/**/*.{ts,tsx,mts,cts}", { cwd: root }).filter((file) => {
      const header = readFileSync(join(root, file), "utf8").trimStart();
      return !processGuarantee.test(header.split(/\r?\n\s*\r?\n/u, 1)[0] ?? "");
    });
    if (missing.length > 0) {
      throw new Error(`Missing or invalid cross-process guarantee:\n${missing.join("\n")}`);
    }
  },

  onTestRunEnd(modules) {
    const exceeded: string[] = [];
    for (const module of modules) {
      const [directory, layer] = relative(module.project.config.root, module.moduleId).split(sep);
      const limit = directory === "test" && layer !== undefined ? costLimits.get(layer) : undefined;
      if (limit === undefined) continue;
      for (const test of module.children.allTests()) {
        const durations = test
          .attempts()
          .filter((attempt) => attempt.state === "passed")
          .map((attempt) => attempt.duration)
          .sort((left, right) => left - right);
        if (durations.length === 0) continue;
        const median =
          (durations[Math.floor((durations.length - 1) / 2)]! + durations[Math.floor(durations.length / 2)]!) / 2;
        if (median > limit) {
          exceeded.push(`${module.relativeModuleId} > ${test.fullName}: p50 ${median.toFixed(0)}ms (limit ${limit}ms)`);
        }
      }
    }
    if (exceeded.length > 0) {
      throw new Error(`Test cost limits exceeded:\n${exceeded.join("\n")}`);
    }
  },
} satisfies Reporter;
