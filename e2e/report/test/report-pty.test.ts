// owner: e2e/report long terminal frames — real PTY only
// rerun: pnpm e2e --repo report -- --run test/report-pty.test.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPty } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { PINNED_ENV, PTY_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";
import { expectBoxed, expectPlain } from "./support/frames.ts";
import { classicExpFacts } from "./support/exp.ts";
import { expectTranscript, requiredTranscript, toTranscriptTemplate } from "./support/transcript.ts";

const SITE_OVERVIEW = ["show", "--report", "./reports/site.tsx", "--page", "overview"] as const;

test("PTY site overview draws Section frames; pipe/NO_COLOR stay plain", async () => {
  await reportE2E.case("pty", { artifacts: reportCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
      env: PINNED_ENV,
      timeoutMs: 120_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const facts = classicExpFacts(run.stdout);

    const pipe = await niceeval.run([...SITE_OVERVIEW], { env: PINNED_ENV });
    expect(pipe.exitCode, pipe.diagnostic()).toBe(0);
    expectPlain(pipe.stdout, pipe.diagnostic());

    const noColor = await niceeval.run([...SITE_OVERVIEW], {
      env: { ...PINNED_ENV, NO_COLOR: "1" },
    });
    expect(noColor.exitCode, noColor.diagnostic()).toBe(0);
    expectPlain(noColor.stdout, noColor.diagnostic());

    const ttySpike = await runPty(["node", "-e", "process.stdout.write(String(process.stdout.isTTY))"], {
      cwd: projectRoot,
      columns: 120,
      rows: 40,
      env: PTY_ENV,
      timeoutMs: 15_000,
    });
    expect(ttySpike.exitCode, ttySpike.diagnostic()).toBe(0);
    expect(ttySpike.stdout).toContain("true");

    const pty = await runPty([...niceevalArgv(projectRoot), ...SITE_OVERVIEW], {
      cwd: projectRoot,
      columns: 120,
      rows: 40,
      env: PTY_ENV,
      timeoutMs: 60_000,
    });
    expect(pty.exitCode, pty.diagnostic()).toBe(0);
    expect(pty.argv.slice(0, 2)).toEqual(niceevalArgv(projectRoot));
    expect(pty.argv.slice(2)).toEqual([...SITE_OVERVIEW]);
    expectBoxed(pty.stdout, pty.diagnostic());
    expect(pty.stdout).toMatch(/Run overview|运行总览/);
    expect(pty.stdout).toMatch(/Eval × agent|Eval × Agent/);

    const bindings = { runIds: facts.runIds };
    const fixturePath = join(import.meta.dirname, "fixtures", "transcripts", "show-site-overview.pty.txt");
    if (process.env.NICEEVAL_CAPTURE_TRANSCRIPTS === "1") {
      mkdirSync(join(import.meta.dirname, "fixtures", "transcripts"), { recursive: true });
      writeFileSync(fixturePath, toTranscriptTemplate(pty.stdout, bindings), "utf8");
    }
    expectTranscript(pty.stdout, requiredTranscript(import.meta.dirname, "show-site-overview.pty.txt"), bindings);
  });
});

function niceevalArgv(projectRoot: string): [string, ...string[]] {
  return ["node", `${projectRoot}/node_modules/niceeval/bin/niceeval.js`];
}
