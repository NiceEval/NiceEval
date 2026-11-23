import { globSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { createVitest, type Reporter, type TestCase, type TestModule } from "vitest/node";

const costLimits = new Map([
  ["integration", 1000],
  ["cli", 300],
  ["process", 10000],
]);
const containerProcessTest = /\.(?:docker|linux)\.test\.ts$/u;
const processGuarantee =
  /^(?:\/\/[^\n]*\n)*\/\/ 跨进程保证：(进程终止与信号|外部程序与 Provider|文件与锁|运行环境|网络)——\S/u;

function passedDurations(test: TestCase): number[] {
  return test
    .attempts()
    .filter((attempt) => attempt.state === "passed")
    .map((attempt) => attempt.duration);
}

function median(samples: number[]): number {
  const sorted = samples.toSorted((left, right) => left - right);
  return (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2;
}

interface OverBudget {
  test: TestCase;
  samples: number[];
}

// Shared beforeAll fixtures can change during a test (e.g. a partial rerun).
// Recreate the original file selection for each measurement, including earlier sibling tests.
async function confirmHostedCosts(module: TestModule, candidates: OverBudget[]) {
  const original = module.project.vitest;
  const measurement = await createVitest({
    root: original.config.root,
    config: original.vite.config.configFile,
    project: [module.project.name],
    watch: false,
    maxWorkers: 1,
    cache: false,
    reporters: ["default"],
  });
  try {
    await measurement.standalone();
    const testIds = [...module.children.allTests()]
      .filter((test) => test.attempts().length > 0)
      .map((test) => test.id);
    const spec = measurement.getProjectByName(module.project.name).createSpecification(module.moduleId, { testIds });
    for (let round = 0; round < 2; round++) {
      const { testModules, unhandledErrors } = await measurement.runTestSpecifications([spec]);
      const sampled = testModules.find((file) => file.moduleId === module.moduleId);
      if (sampled?.state() !== "passed" || unhandledErrors.length > 0) {
        throw new Error(`Cost confirmation failed in ${module.relativeModuleId}. See the Vitest results above.`);
      }
      const tests = new Map([...sampled.children.allTests()].map((test) => [test.id, test]));
      for (const { test, samples } of candidates) {
        const observed = tests.get(test.id);
        if (observed?.fullName !== test.fullName || observed.result().state !== "passed") {
          throw new Error(`Missing cost sample for ${module.relativeModuleId} > ${test.fullName}`);
        }
        samples.push(...passedDurations(observed));
      }
    }
  } finally {
    await measurement.close();
  }
}

export default function architectureReporter(costScale: number): Reporter {
  return {
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

    async onTestRunEnd(modules, _errors, reason) {
      const exceeded: string[] = [];
      for (const module of modules) {
        const [directory, layer] = relative(module.project.config.root, module.moduleId).split(sep);
        if (directory !== "test" || layer === undefined) continue;
        const baseLimit =
          layer === "process" && containerProcessTest.test(basename(module.moduleId)) ? 30_000 : costLimits.get(layer);
        if (baseLimit === undefined) continue;
        const limit = baseLimit * costScale;
        const candidates: OverBudget[] = [];
        for (const test of module.children.allTests()) {
          const samples = passedDurations(test);
          if (samples.length > 0 && median(samples) > limit) candidates.push({ test, samples });
        }
        const singletons = candidates.filter(({ samples }) => samples.length === 1);
        const hostedDefault = process.env.GITHUB_ACTIONS === "true" && module.project.name === "default";
        if (reason === "passed" && hostedDefault && singletons.length > 0) {
          await confirmHostedCosts(module, singletons);
        }
        for (const { test, samples } of candidates) {
          const p50 = median(samples);
          const times = samples.map((ms) => ms.toFixed(0)).join(", ");
          const result = `${module.relativeModuleId} > ${test.fullName}: p50 ${p50.toFixed(0)}ms (limit ${limit}ms) samples [${times}]ms`;
          if (p50 > limit) exceeded.push(result);
          else module.project.vitest.logger.log(result);
        }
      }
      if (exceeded.length > 0) {
        throw new Error(`Test cost limits exceeded:\n${exceeded.join("\n")}`);
      }
    },
  };
}
