import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { expectDisplayColumns, expectPlain } from "../support/frames.ts";
import { PINNED_ENV } from "../support/context.ts";
import { runPty } from "../support/testkit.ts";
import { expectTranscript, requiredTranscript } from "../support/transcript.ts";
import { withClassicWorld } from "../support/world.ts";

const SITE_OVERVIEW = ["show", "--report", "./reports/site.tsx", "--page", "overview"] as const;
const PTY_LAYOUT_REPORT = ["show", "--report", "./reports/pty-layout.tsx", "--page", "overview"] as const;
const TEST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PTY_COLUMNS = 60;

test("show keeps independent pipe output and a short character-exact PTY layout witness", async () => {
  await withClassicWorld("show-pty-layout", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const pipe = await niceeval.run([...SITE_OVERVIEW], { env: PINNED_ENV });
    expect(pipe.exitCode, pipe.diagnostic()).toBe(0);
    expectPlain(pipe.stdout, pipe.diagnostic());

    const noColor = await niceeval.run([...SITE_OVERVIEW], { env: { ...PINNED_ENV, NO_COLOR: "1" } });
    expect(noColor.exitCode, noColor.diagnostic()).toBe(0);
    expectPlain(noColor.stdout, noColor.diagnostic());

    const pty = await runPty([...niceevalArgv(projectRoot), ...PTY_LAYOUT_REPORT], {
      cwd: projectRoot,
      columns: PTY_COLUMNS,
      rows: 40,
      env: {
        ...PINNED_ENV,
        // GitHub's Ubuntu image guarantees the C UTF-8 locale, but does not
        // install zh_CN.UTF-8. The report itself supplies the CJK witness;
        // locale selection must not add a shell warning to the PTY frame.
        LC_ALL: "C.UTF-8",
        LANG: "C.UTF-8",
        LANGUAGE: "C",
        TERM: "xterm-256color",
        NO_COLOR: undefined,
        FORCE_COLOR: undefined,
      },
      timeoutMs: 60_000,
    });
    expect(pty.exitCode, pty.diagnostic()).toBe(0);
    expectDisplayColumns(pty.stdout.split("\n").filter((line) => line.length > 0), PTY_COLUMNS, pty.diagnostic());
    const template = requiredTranscript(TEST_ROOT, "show-pty-layout.pty.txt");
    expect(template.split("\n").every((line) => !/[ \t]+$/.test(line)), "PTY fixture must spell padding with directives").toBe(
      true,
    );
    // This fixture is intentionally only four physical rows, so compare the
    // original PTY bytes. In particular, do not reconstruct its EOF: the
    // {{eof-newlines:N}} directive must observe what the process emitted.
    expectTranscript(pty.stdout, template, {});
  });
});

function niceevalArgv(projectRoot: string): [string, ...string[]] {
  return ["node", `${projectRoot}/node_modules/niceeval/bin/niceeval.js`];
}
