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

test("第一方 Repository 在唯一 OS-user database 中按需迁移并 fail closed", async () => {
  await e2e.case(
    "os-user-database",
    async ({ paths, commands: { candidate }, run, start }) => {
      const fixture = join(paths.projectRoot, "fixtures", "state-host.mjs");

      const removedSdk = await run([process.execPath, "--input-type=module", "--eval", "await import('niceeval/state')"]);
      expect(removedSdk.exitCode, removedSdk.diagnostic()).not.toBe(0);
      expect(removedSdk.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");

      const lazyHome = join(paths.projectRoot, "lazy-home");
      const opened = await run([process.execPath, fixture, "open", lazyHome]);
      expect(opened.exitCode, opened.diagnostic()).toBe(0);
      expect(json<{ readonly path: string }>(opened).path).toBe(join(lazyHome, "niceeval.sqlite"));
      const beforeUse = await run([process.execPath, fixture, "inspect", lazyHome]);
      expect(beforeUse.exitCode, beforeUse.diagnostic()).toBe(0);
      expect(json<{ readonly repositories: readonly unknown[]; readonly hasDurableState: boolean }>(beforeUse)).toMatchObject({ repositories: [], hasDurableState: false });

      const first = start([process.execPath, fixture, "put", lazyHome, "first"]);
      const second = start([process.execPath, fixture, "put", lazyHome, "second"]);
      const [firstReceipt, secondReceipt] = await Promise.all([first.done, second.done]);
      expect(firstReceipt.exitCode, firstReceipt.diagnostic()).toBe(0);
      expect(secondReceipt.exitCode, secondReceipt.diagnostic()).toBe(0);
      expect(json<{ readonly found: { readonly key: string; readonly value: string } }>(firstReceipt).found).toEqual({ key: "first", value: "value-first" });
      expect(json<{ readonly found: { readonly key: string; readonly value: string } }>(secondReceipt).found).toEqual({ key: "second", value: "value-second" });

      const listed = await run([process.execPath, fixture, "list", lazyHome]);
      expect(listed.exitCode, listed.diagnostic()).toBe(0);
      expect(json<{ readonly entries: readonly { readonly key: string; readonly value: string }[] }>(listed).entries).toEqual([
        { key: "first", value: "value-first" },
        { key: "second", value: "value-second" },
      ]);
      const afterUse = await run([process.execPath, fixture, "inspect", lazyHome]);
      expect(json<{ readonly repositories: readonly unknown[]; readonly journalMode: string }>(afterUse)).toMatchObject({
        repositories: [{ repository_id: "durable-state", revision: 1 }],
        journalMode: "wal",
      });
      const userDatabaseFiles = readdirSync(lazyHome).sort();
      expect(userDatabaseFiles).toContain("niceeval.sqlite");
      expect(userDatabaseFiles.every((name) =>
        name === "niceeval.sqlite" || name === "niceeval.sqlite-shm" || name === "niceeval.sqlite-wal"
      )).toBe(true);
      expect(userDatabaseFiles.filter((name) => name.endsWith(".sqlite"))).toEqual(["niceeval.sqlite"]);

      const emptyHome = join(paths.projectRoot, "empty-existing-home");
      const empty = await run([process.execPath, fixture, "prepare-empty", emptyHome]);
      expect(empty.exitCode, empty.diagnostic()).toBe(0);
      const rejectedEmpty = await candidate.run(["state", "migrate", "--all"], { env: { NICEEVAL_HOME: emptyHome } });
      expect(rejectedEmpty.exitCode, rejectedEmpty.diagnostic()).not.toBe(0);
      expect(rejectedEmpty.stderr).toContain("format identity");

      const maintenanceHome = join(paths.projectRoot, "maintenance-home");
      const migrated = await candidate.run(["state", "migrate", "--all"], { env: { NICEEVAL_HOME: maintenanceHome } });
      expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
      expect(migrated.stdout).toContain(join(maintenanceHome, "niceeval.sqlite"));
      const maintained = await run([process.execPath, fixture, "inspect", maintenanceHome]);
      expect(maintained.exitCode, maintained.diagnostic()).toBe(0);
      expect(json<{ readonly repositories: readonly unknown[]; readonly entries: readonly unknown[] }>(maintained)).toMatchObject({
        repositories: [
          { repository_id: "docker-cache", revision: 1 },
          { repository_id: "durable-state", revision: 1 },
          { repository_id: "e2b-cache", revision: 1 },
          { repository_id: "incus", revision: 2 },
        ],
        entries: [],
      });

      for (const [name, repository, revision, expected] of [
        ["future-home", "durable-state", 2, "durable-state"],
        ["unknown-home", "unknown-first-party", 1, "unknown-first-party"],
      ] as const) {
        const home = join(paths.projectRoot, name);
        const seeded = await run([process.execPath, fixture, "put", home, "seed"]);
        expect(seeded.exitCode, seeded.diagnostic()).toBe(0);
        const prepared = await run([process.execPath, fixture, "prepare-revision", home, repository, String(revision)]);
        expect(prepared.exitCode, prepared.diagnostic()).toBe(0);
        const failed = await candidate.run(["state", "migrate", "--all"], { env: { NICEEVAL_HOME: home } });
        expect(failed.exitCode, failed.diagnostic()).not.toBe(0);
        expect(failed.stderr).toContain(expected);
      }

      const cacheFutureHome = join(paths.projectRoot, "cache-future-home");
      const cacheSeed = await run([process.execPath, fixture, "put", cacheFutureHome, "durable"]);
      expect(cacheSeed.exitCode, cacheSeed.diagnostic()).toBe(0);
      const cacheFuture = await run([process.execPath, fixture, "prepare-revision", cacheFutureHome, "docker-cache", "2"]);
      expect(cacheFuture.exitCode, cacheFuture.diagnostic()).toBe(0);
      const durableStateStillWorks = await run([process.execPath, fixture, "list", cacheFutureHome]);
      expect(durableStateStillWorks.exitCode, durableStateStillWorks.diagnostic()).toBe(0);
      expect(json<{ readonly entries: readonly { readonly key: string; readonly value: string }[] }>(durableStateStillWorks).entries).toEqual([
        { key: "durable", value: "value-durable" },
      ]);
      const cacheFutureMaintenance = await candidate.run(["state", "migrate", "--all"], { env: { NICEEVAL_HOME: cacheFutureHome } });
      expect(cacheFutureMaintenance.exitCode, cacheFutureMaintenance.diagnostic()).not.toBe(0);
      expect(cacheFutureMaintenance.stderr).toContain("docker-cache");

      for (const kind of ["constraint", "index", "trigger"] as const) {
        const home = join(paths.projectRoot, `docker-${kind}-replacement-home`);
        const initialized = await candidate.run(["state", "migrate", "--all"], { env: { NICEEVAL_HOME: home } });
        expect(initialized.exitCode, initialized.diagnostic()).toBe(0);
        const seeded = await run([process.execPath, fixture, "put", home, kind]);
        expect(seeded.exitCode, seeded.diagnostic()).toBe(0);
        const replaced = await run([process.execPath, fixture, "replace-docker-schema", home, kind]);
        expect(replaced.exitCode, replaced.diagnostic()).toBe(0);

        const rejected = await candidate.run(["state", "migrate", "--all"], { env: { NICEEVAL_HOME: home } });
        expect(rejected.exitCode, rejected.diagnostic()).not.toBe(0);
        expect(rejected.stderr).toContain("docker-cache");

        const durableState = await run([process.execPath, fixture, "list", home]);
        expect(durableState.exitCode, durableState.diagnostic()).toBe(0);
        expect(json<{ readonly entries: readonly { readonly key: string; readonly value: string }[] }>(durableState).entries).toEqual([
          { key: kind, value: `value-${kind}` },
        ]);
      }

      const renamedLegacyHome = join(paths.projectRoot, "renamed-legacy-home");
      const renamedLegacy = await run([process.execPath, fixture, "prepare-renamed-legacy", renamedLegacyHome]);
      expect(renamedLegacy.exitCode, renamedLegacy.diagnostic()).toBe(0);
      const rejectedRenamedLegacy = await candidate.run(["state", "migrate", "--all"], { env: { NICEEVAL_HOME: renamedLegacyHome } });
      expect(rejectedRenamedLegacy.exitCode, rejectedRenamedLegacy.diagnostic()).not.toBe(0);
      expect(rejectedRenamedLegacy.stderr).toContain("format identity");

      const extraObjectHome = join(paths.projectRoot, "extra-object-home");
      const extraObjectSeed = await run([process.execPath, fixture, "put", extraObjectHome, "seed"]);
      expect(extraObjectSeed.exitCode, extraObjectSeed.diagnostic()).toBe(0);
      const extraObject = await run([process.execPath, fixture, "prepare-extra-object", extraObjectHome]);
      expect(extraObject.exitCode, extraObject.diagnostic()).toBe(0);
      const rejectedExtraObject = await candidate.run(["state", "migrate", "--all"], { env: { NICEEVAL_HOME: extraObjectHome } });
      expect(rejectedExtraObject.exitCode, rejectedExtraObject.diagnostic()).not.toBe(0);
      expect(rejectedExtraObject.stderr).toContain("foreign_user_database_object");

      for (const [name, preparation] of [["legacy-home", "prepare-legacy"], ["both-home", "prepare-both"]] as const) {
        const home = join(paths.projectRoot, name);
        const prepared = await run([process.execPath, fixture, preparation, home]);
        expect(prepared.exitCode, prepared.diagnostic()).toBe(0);
        const failed = await candidate.run(["state", "migrate", "--all"], { env: { NICEEVAL_HOME: home } });
        expect(failed.exitCode, failed.diagnostic()).not.toBe(0);
        expect(failed.stderr).toContain("state.sqlite");
      }

      expect(existsSync(join(paths.projectRoot, ".niceeval", "record"))).toBe(false);
      expect(existsSync(join(paths.projectRoot, ".niceeval", "cache"))).toBe(false);
    },
  );
});
