// owner: e2e/report long terminal frames — real PTY only
// rerun: pnpm e2e --repo report -- --run test/report-pty.test.ts

import { expect, test } from "vitest";
import { PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";
import { expectBoxed, expectPlain } from "./support/frames.ts";
import { runPty } from "./support/testkit.ts";

test("PTY show --report draws frames; pipe/NO_COLOR stay plain", async () => {
  await reportE2E.case("pty", { artifacts: reportCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
      env: PINNED_ENV,
      timeoutMs: 120_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(1);

    const pipe = await niceeval.run(["show", "--report", "./reports/classic.tsx"], { env: PINNED_ENV });
    expect(pipe.exitCode, pipe.diagnostic()).toBe(0);
    expectPlain(pipe.stdout, pipe.diagnostic());

    const noColor = await niceeval.run(["show", "--report", "./reports/classic.tsx"], {
      env: { ...PINNED_ENV, NO_COLOR: "1" },
    });
    expect(noColor.exitCode, noColor.diagnostic()).toBe(0);
    expectPlain(noColor.stdout, noColor.diagnostic());

    const ttySpike = await runPty(
      ["env", "-u", "NO_COLOR", "-u", "FORCE_COLOR", "node", "-e", "process.stdout.write(String(process.stdout.isTTY))"],
      {
        cwd: projectRoot,
        columns: 120,
        env: { TERM: "dumb" },
        timeoutMs: 15_000,
      },
    );
    expect(ttySpike.exitCode, ttySpike.diagnostic()).toBe(0);
    expect(ttySpike.stdout).toContain("true");

    const pty = await runPty(
      ["env", "-u", "NO_COLOR", "-u", "FORCE_COLOR", ...niceevalArgv(projectRoot), "show", "--report", "./reports/classic.tsx"],
      {
        cwd: projectRoot,
        columns: 120,
        rows: 40,
        env: { ...PINNED_ENV, TERM: "dumb" },
        timeoutMs: 60_000,
      },
    );
    expect(pty.exitCode, pty.diagnostic()).toBe(0);
    expectBoxed(pty.stdout, pty.diagnostic());
    expect(pty.stdout).toContain("MemoryBench Classic");
    expect(pty.stdout).toContain("Leaderboard");
  });
});

function niceevalArgv(projectRoot: string): [string, ...string[]] {
  return ["node", `${projectRoot}/node_modules/niceeval/bin/niceeval.js`];
}
