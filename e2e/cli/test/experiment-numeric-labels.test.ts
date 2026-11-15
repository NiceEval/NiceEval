// rerun: pnpm e2e test --repo cli --candidate source -- --run test/experiment-numeric-labels.test.ts

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/experiments/README.md
test.concurrent("数值标签经过规划、运行与公开读取后保留原类型", async ({ expect }) => {
  await cliE2E.case("experiment-numeric-labels", async ({ commands: { niceeval }, paths }) => {
    // Human Show prepares the complete current target; this journey owns only its local Agent.
    await rm(join(paths.projectRoot, "experiments"), { recursive: true });
    await mkdir(join(paths.projectRoot, "experiments"));
    await writeFile(
      join(paths.projectRoot, "experiments", "numeric-labels.ts"),
      'import { defineExperiment } from "niceeval";\nimport { deterministicAgent } from "../agents/deterministic.ts";\nexport default defineExperiment({ adapter: deterministicAgent("numeric-labels"), evals: ["greet"], labels: { rank: 0, text: "0" } });\n',
    );

    const dry = await niceeval.run(["exp", "numeric-labels", "--dry"]);
    expect(dry.exitCode, dry.diagnostic()).toBe(0);

    const run = await niceeval.run(["exp", "numeric-labels", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const receipt = run.expReceipt();
    expect(receipt.createdRunIds).toHaveLength(1);

    const shown = await niceeval.run(["show", `run:${receipt.createdRunIds[0]}`, "--json"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.run().run.value.context?.labels).toEqual({ rank: 0, text: "0" });

    const experiment = await niceeval.run(["show", "exp:numeric-labels", "--json"]);
    expect(experiment.exitCode, experiment.diagnostic()).toBe(0);
    expect(experiment.experiment().experiment.experiment.labels).toEqual({
      rank: { state: "available", value: 0 },
      text: { state: "available", value: "0" },
    });

    const human = await niceeval.run(["show", "exp:numeric-labels"]);
    expect(human.exitCode, human.diagnostic()).toBe(0);
    expect(human.stdout, human.diagnostic()).toContain("rank=0");

    const catalog = await niceeval.run(["exp", "list", "numeric-labels"]);
    expect(catalog.exitCode, catalog.diagnostic()).toBe(0);
    expect(catalog.stdout, catalog.diagnostic()).toContain("rank=0");
  });
});
