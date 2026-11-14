// rerun: pnpm e2e test --repo record -- --run test/record-migration.test.ts

import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createE2EContext } from "@niceeval/testkit";
import { expect, test } from "vitest";

const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-record-migration-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")] },
});

// @feature docs/feature/run/README.md
test.concurrent("旧 Record 明确拒绝且保留原件", async () => {
  await e2e.case("old-record-rejected", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const fixture = join(projectRoot, "fixtures", "record-migration", "predecessors", "0.18", "record.sqlite");
    const root = join(projectRoot, ".niceeval");
    await mkdir(root, { recursive: true });
    const record = join(root, "record.sqlite");
    await copyFile(fixture, record);
    const original = await readFile(record);
    for (const argv of [
      ["show", "runs", "--json"],
      ["exp", "migration-agent", "--dry", "--json"],
    ]) {
      const result = await niceeval.run(argv);
      expect(result.exitCode, result.diagnostic()).not.toBe(0);
      expect(result.stdout + result.stderr, result.diagnostic()).toMatch(/old(er)? version|previous version/i);
      expect(result.stdout + result.stderr, result.diagnostic()).toMatch(/rerun|re-run/i);
      expect(await readFile(record)).toEqual(original);
    }
    expect((await readdir(root)).sort()).toEqual(["record.sqlite"]);
  });
});
