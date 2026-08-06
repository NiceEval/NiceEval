import { defineEvidenceRecipe } from "../support/contracts";

export default defineEvidenceRecipe({
  id: "report-targets-v1",
  version: 1,
  profile: "deterministic",
  backend: "consumer-project",
  producer: {
    module: import.meta.filename,
    export: "default",
    inputs: ["../fixtures/report-targets"],
  },
  capabilities: ["candidate-package", "process", "browser"],
  async prepare(ctx) {
    const project = await ctx.consumerProject("report-targets", {
      fixture: "fixtures/report-targets",
    });
    await project.installCandidate(ctx.candidateTarball);

    const run = await project.cli(
      "pnpm exec niceeval exp report-targets --rerun all --json",
      { pipe: true },
    );
    const view = await project.cli(
      "pnpm exec niceeval view --report reports/targets.tsx --out site",
    );

    return ctx.publishReadOnly({
      resultsRoot: project.path(".niceeval"),
      exports: { site: project.path("site") },
      consumers: { report: project },
      processes: { run, view },
      locators: { failed: project.locator("failed") },
      targets: {
        attempt: {
          pageId: "attempt",
          key: project.locator("failed"),
        },
        experiment: {
          pageId: "experiment",
          key: "report-targets",
        },
        custom: {
          pageId: "case",
          key: "checkout-regression",
        },
      },
    });
  },
});
