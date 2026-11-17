import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent("directory actions and Sandbox uploads exclude gitignored host files", async () => {
  await runnerE2E.case("directory-upload", {}, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const fixture = join(projectRoot, "fixtures/directory-upload");
    await mkdir(join(fixture, "nested"), { recursive: true });
    await mkdir(join(fixture, "node_modules"), { recursive: true });
    await mkdir(join(fixture, ".git"), { recursive: true });
    await writeFile(join(fixture, ".gitignore"), "node_modules/\n*.tmp\n!keep.tmp\n");
    await writeFile(join(fixture, "keep.tmp"), "kept");
    await writeFile(join(fixture, "drop.tmp"), "ignored");
    await writeFile(join(fixture, "node_modules/large"), "ignored");
    await writeFile(join(fixture, ".git/config"), "ignored");
    await writeFile(join(fixture, "nested/.gitignore"), "local.txt\n!keep.tmp\n");
    await writeFile(join(fixture, "nested/local.txt"), "ignored");
    await writeFile(join(fixture, "nested/keep.tmp"), "kept");
    await writeFile(join(projectRoot, "experiments/directory-upload.ts"), `
import { defineExperiment } from "niceeval";
import { uploadDirectory, shell } from "niceeval/sandbox";
import { defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
const deterministicAgent = defineSandboxAgent({ name: "directory-upload", evidenceCoverage: completeEvidenceCoverage, install: { identity: { agent: "directory-upload", version: "1", revision: "1" }, probe: shell("true") }, async send() { return { status: "completed", events: [] }; } });
import { controlledExclusiveSandbox } from "../agents/controlled-exclusive-sandbox.ts";
export default defineExperiment({ adapter: deterministicAgent, sandbox: controlledExclusiveSandbox.before(uploadDirectory({ id: "fixture", source: new URL("../fixtures/directory-upload/", import.meta.url), to: "uploaded-action" })), evals: ["directory-upload"] });
`);
    await writeFile(join(projectRoot, "evals/directory-upload.eval.ts"), `
import { strictEqual } from "node:assert";
import { defineEval } from "niceeval";
export default defineEval({ async test(t) {
  await t.sandbox.uploadDirectory(new URL("../fixtures/directory-upload/", import.meta.url), "uploaded-method", { ignore: ["keep.tmp"] });
  const check = await t.sandbox.runShell("test -f uploaded-action/keep.tmp && test -f uploaded-action/nested/keep.tmp && test ! -e uploaded-action/node_modules && test ! -e uploaded-action/.git && test ! -e uploaded-action/drop.tmp && test ! -e uploaded-action/nested/local.txt && test ! -e uploaded-method/node_modules && test ! -e uploaded-method/.git && test ! -e uploaded-method/keep.tmp && test ! -e uploaded-method/nested/keep.tmp");
  strictEqual(check.exitCode, 0, check.stderr);
} });
`);
    const run = await niceeval.run(["exp", "directory-upload", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expEvalEvents().map((event) => ({ evalId: event.evalId, verdict: event.verdict })), run.diagnostic()).toEqual([{ evalId: "directory-upload", verdict: "passed" }]);
  });
});
