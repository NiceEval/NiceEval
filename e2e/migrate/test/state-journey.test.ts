
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly diagnostic: () => string;
};

type E2EContext = {
  readonly case: (
    name: string,
    body: (input: {
      readonly paths: { readonly projectRoot: string };
      readonly commands: {
        readonly candidate: {
          readonly run: (
            argv: readonly string[],
            options?: { readonly env?: NodeJS.ProcessEnv },
          ) => Promise<CommandResult>;
        };
      };
    }) => Promise<void>,
  ) => Promise<void>;
};

const testkitModule = "@niceeval/" + "testkit";
const { createE2EContext } = await import(testkitModule) as unknown as {
  readonly createE2EContext: (input: unknown) => E2EContext;
};

const installedNiceeval = [
  process.execPath,
  join(process.cwd(), "node_modules", "niceeval", "bin", "niceeval.js"),
] as const;

const e2e = createE2EContext({
  repoId: "migrate",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-state-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { candidate: installedNiceeval },
});

test("state migrate 初始化唯一 OS-user database 并可重复执行 [necase_YP96MY4EQKVRFD24]", async () => {
  await e2e.case("os-user-database", async ({ paths, commands: { candidate } }) => {
    const home = join(paths.projectRoot, "maintenance-home");
    const env = { NICEEVAL_HOME: home };

    const migrated = await candidate.run(["state", "migrate", "--all"], { env });
    expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
    expect(migrated.stdout, migrated.diagnostic()).toBe(
      `State migration bootstrapped baseline 0.14.0 at version 1: ${join(home, "niceeval.sqlite")}\n`,
    );

    const repeated = await candidate.run(["state", "migrate", "--all"], { env });
    expect(repeated.exitCode, repeated.diagnostic()).toBe(0);
    expect(repeated.stdout, repeated.diagnostic()).toBe(
      `State migration current at baseline 0.14.0 version 1 (no-op): ${join(home, "niceeval.sqlite")}\n`,
    );

    expect(existsSync(join(home, "niceeval.sqlite"))).toBe(true);
    expect(readdirSync(home).filter((name) => name.endsWith(".sqlite"))).toEqual([
      "niceeval.sqlite",
    ]);
    expect(existsSync(join(paths.projectRoot, ".niceeval"))).toBe(false);
  });
});
