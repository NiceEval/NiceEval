import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent("旧用户数据库被拒绝，保留缓存登记并说明清理位置", async () => {
  await cliE2E.case("old-user-database", {}, async ({ commands: { niceeval }, paths }) => {
    const home = join(paths.projectRoot, "old-home");
    const database = join(home, "niceeval.sqlite");
    const original = await readFile(join(paths.projectRoot, "fixtures/old-user-database/niceeval.sqlite"));
    await mkdir(home);
    await writeFile(database, original);
    const result = await niceeval.run(["docker", "cache", "inventory", "--json"], {
      env: {
        NICEEVAL_HOME: home,
        XDG_STATE_HOME: join(paths.projectRoot, "xdg-state"),
        PATH: `${join(paths.projectRoot, "fixtures/cache-inventory/bin")}:${process.env.PATH ?? ""}`,
      },
    });
    expect(result.exitCode, result.diagnostic()).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("written by an older NiceEval");
    expect(`${result.stdout}\n${result.stderr}`).toContain(database);
    expect(`${result.stdout}\n${result.stderr}`).toContain("rerun");
    expect(await readFile(database)).toEqual(original);
  });
});
