// owner: e2e/report show DX — complete exp → show text + public niceeval.show JSON
// rerun: pnpm e2e --repo report -- --run test/report-show.test.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  CLASSIC_RECALL_EVAL_IDS,
  classicExpectedVerdict,
  classicMemoryOf,
} from "../agents/classic.ts";
import { CLASSIC_EXPERIMENTS, PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";
import { classicExpFacts } from "./support/exp.ts";
import { assertPublicShowJson } from "./support/show-json.ts";
import { expectTranscript, toTranscriptTemplate } from "./support/transcript.ts";

test("exp classic → show text and public niceeval.show JSON", async () => {
  await reportE2E.case("show", { artifacts: reportCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
      env: PINNED_ENV,
      timeoutMs: 120_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const facts = classicExpFacts(run.stdout);
    expect(facts.evals.map((event) => [event.experimentId, event.evalId]).sort()).toEqual(
      expectedEvalKeys(),
    );
    for (const event of facts.evals) {
      const memory = memoryFromExperiment(event.experimentId);
      expect(event.verdict, `${event.experimentId} ${event.evalId}`).toBe(
        classicExpectedVerdict(memory, event.evalId),
      );
      expect(event.locator.startsWith("@")).toBe(true);
    }

    const shown = await niceeval.run(["show", "--report", "./reports/classic.tsx"], {
      env: PINNED_ENV,
    });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("MemoryBench Classic");
    expect(shown.stdout).toContain("Leaderboard");
    for (const experimentId of CLASSIC_EXPERIMENTS) {
      expect(shown.stdout).toContain(experimentId);
    }

    const forbidden = await niceeval.run(
      ["show", "--report", "./reports/classic.tsx", "--json"],
      { env: PINNED_ENV },
    );
    expect(forbidden.exitCode, forbidden.diagnostic()).not.toBe(0);
    expect(forbidden.stderr).toContain("--json cannot combine with --report");

    const json = await niceeval.run(["show", "--json"], { env: PINNED_ENV });
    expect(json.exitCode, json.diagnostic()).toBe(0);
    const document = assertPublicShowJson(json.json());
    expect(document.view).toBe("leaderboard");
    expect(document.sample.experiments.sort()).toEqual([...CLASSIC_EXPERIMENTS].sort());

    const locators = Object.fromEntries(
      facts.evals.map((event) => [`${event.experimentId}:${event.evalId}`, event.locator]),
    );
    const fixturePath = join(import.meta.dirname, "fixtures", "transcripts", "show-classic.pipe.txt");
    if (process.env.NICEEVAL_CAPTURE_TRANSCRIPTS === "1") {
      mkdirSync(join(import.meta.dirname, "fixtures", "transcripts"), { recursive: true });
      writeFileSync(fixturePath, toTranscriptTemplate(shown.stdout, { locators }), "utf8");
    }
    const fixture = tryReadTranscript("show-classic.pipe.txt");
    expect(fixture, "checked-in show-classic.pipe.txt transcript").toBeDefined();
    expectTranscript(shown.stdout, fixture!, { locators });
    expect(projectRoot.length).toBeGreaterThan(0);
  });
});

function expectedEvalKeys(): string[][] {
  const evals = [...CLASSIC_RECALL_EVAL_IDS, "source-snapshot"];
  return CLASSIC_EXPERIMENTS.flatMap((experimentId) => evals.map((evalId) => [experimentId, evalId])).sort();
}

function memoryFromExperiment(experimentId: string) {
  return classicMemoryOf({ memory: experimentId.split("/").at(-1) });
}

function tryReadTranscript(name: string): string | undefined {
  try {
    return readFileSync(join(import.meta.dirname, "fixtures", "transcripts", name), "utf8");
  } catch {
    return undefined;
  }
}
