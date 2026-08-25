// owner: docs/engineering/testing/e2e/migrate.md#os-user-service-state

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly diagnostic: () => string;
};

type ManagedProcess = {
  readonly done: Promise<{
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly diagnostic: () => string;
  }>;
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
      readonly run: (argv: readonly [string, ...string[]]) => Promise<CommandResult>;
      readonly start: (
        argv: readonly [string, ...string[]],
        options?: { readonly env?: NodeJS.ProcessEnv },
      ) => ManagedProcess;
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

function json<T>(receipt: CommandResult | Awaited<ManagedProcess["done"]>): T {
  const line = receipt.stdout.trim().split("\n").at(-1);
  if (line === undefined || line.length === 0) throw new Error(`State fixture emitted no JSON: ${receipt.diagnostic()}`);
  return JSON.parse(line) as T;
}

test("Service state 以静态声明在 OS-user 边界迁移、并发写入并 fail closed", async () => {
  await e2e.case(
    "os-user-service-state",
    async ({ paths, commands: { candidate }, run, start }) => {
      const home = join(paths.projectRoot, "isolated-user-home");
      const fixture = join(paths.projectRoot, "fixtures", "state-host.mjs");
      const env = { NICEEVAL_HOME: home };

      const first = start([process.execPath, fixture, "put", home, "first"], { env });
      const second = start([process.execPath, fixture, "put", home, "second"], { env });
      const [firstReceipt, secondReceipt] = await Promise.all([first.done, second.done]);
      expect(firstReceipt.exitCode, firstReceipt.diagnostic()).toBe(0);
      expect(secondReceipt.exitCode, secondReceipt.diagnostic()).toBe(0);
      expect(json<{ readonly found: { readonly key: string; readonly value: string } }>(firstReceipt).found).toEqual({ key: "first", value: "value-first" });
      expect(json<{ readonly found: { readonly key: string; readonly value: string } }>(secondReceipt).found).toEqual({ key: "second", value: "value-second" });

      const listed = await run([process.execPath, fixture, "list", home]);
      expect(listed.exitCode, listed.diagnostic()).toBe(0);
      expect(json<{ readonly entries: readonly { readonly key: string; readonly value: string }[] }>(listed).entries).toEqual([
        { key: "first", value: "value-first" },
        { key: "second", value: "value-second" },
      ]);

      const undeclared = await run([process.execPath, fixture, "invalid-operation", home]);
      expect(undeclared.exitCode, undeclared.diagnostic()).toBe(0);
      expect(json<{ readonly code: string }>(undeclared).code).toBe("service-state-invalid");
      const invalidSchema = await run([process.execPath, fixture, "invalid-schema", home]);
      expect(invalidSchema.exitCode, invalidSchema.diagnostic()).toBe(0);
      expect(json<{ readonly rejected: boolean }>(invalidSchema).rejected).toBe(true);

      const migrated = await candidate.run(["state", "migrate", "--all"], { env });
      expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
      expect(existsSync(join(home, "state.sqlite"))).toBe(true);
      expect(readdirSync(home).sort()).toEqual(["state.sqlite"]);
      expect(existsSync(join(paths.projectRoot, ".niceeval", "record"))).toBe(false);
      expect(existsSync(join(paths.projectRoot, ".niceeval", "cache"))).toBe(false);
    },
  );
});
