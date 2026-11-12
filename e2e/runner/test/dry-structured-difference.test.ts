import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @use-case docs/feature/experiments/use-case/selection-dry-preview.md
// @issue docs/issues/dry-structured-difference-hidden.md
test.concurrent("预览区分不完整的结构摘要并明确无法比较的原因", async () => {
  await runnerE2E.case("dry-structured-difference", { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] }, async ({ paths, commands: { niceeval } }) => {
    const initial = await niceeval.run(["exp", "dry-structured", "--json"]);
    expect(initial.exitCode, initial.diagnostic()).toBe(0);
    const path = join(paths.projectRoot, "experiments/dry-structured.ts");
    const source = await readFile(path, "utf8");
    await writeFile(path, source.replace('aRevision: "before"', 'aRevision: "after"'));
    const changed = await niceeval.run(["exp", "dry-structured", "--dry"]);
    expect(changed.exitCode, changed.diagnostic()).toBe(0);
    expect(changed.stdout, changed.diagnostic()).toMatch(/config:flags.payload changed \(summary sha256:[a-f0-9]{12} → summary sha256:[a-f0-9]{12}; structured summaries incomplete\)/u);
    const hashes = [...changed.stdout.matchAll(/summary sha256:([a-f0-9]{12})/gu)].map((match) => match[1]);
    expect(new Set(hashes).size).toBeGreaterThanOrEqual(2);
    await writeFile(path, source.replace('zRevision: "before"', 'zRevision: "after"'));
    const unavailable = await niceeval.run(["exp", "dry-structured", "--dry"]);
    expect(unavailable.exitCode, unavailable.diagnostic()).toBe(0);
    expect(unavailable.stdout).toContain("config:flags.payload changed (comparison unavailable: recorded structured summaries are incomplete and identical)");
    expect(unavailable.stdout).not.toContain("structured value (summary incomplete) → structured value (summary incomplete)");
  });
});
