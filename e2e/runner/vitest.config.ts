import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const criticalPathOwners = [
  "shared-state-recovery.test.ts",
  "shared-state-lifecycle.test.ts",
  "shared-state-startup-authority.test.ts",
] as const;

class RunnerSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    return sorted.sort((left, right) => {
      const priority = (moduleId: string) => {
        const index = criticalPathOwners.findIndex((file) => moduleId.endsWith(`/${file}`));
        return index === -1 ? criticalPathOwners.length : index;
      };
      return priority(left.moduleId) - priority(right.moduleId);
    });
  }
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Start long child-process journeys first, then keep concurrency at the
    // public runner's four-vCPU capacity so individual Agent deadlines remain
    // meaningful under load.
    sequence: { sequencer: RunnerSequencer },
    maxWorkers: 4,
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
