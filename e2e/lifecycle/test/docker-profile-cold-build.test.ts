// owner: docs/engineering/testing/e2e/README.md#docker-profile-cold-build
// regression: memory/docker-profile-control-create-migration-incomplete.md
import { appendFile, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  command,
  only,
  pollUntil,
  withProcess,
  withProjectCopy,
  withTempDir,
  type ExpEvent,
} from "@niceeval/testkit";
import { expect, test } from "vitest";

interface HostFixture {
  readonly controlSocket: string;
  readonly descriptor: string;
  readonly hostConfig: string;
  readonly journal: string;
  readonly readyFile: string;
}

interface HostJournalRecord {
  readonly event: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly state?: {
    readonly reservations?: Readonly<Record<string, {
      readonly kind?: string;
      readonly locator?: string;
      readonly builderName?: string;
    }>>;
  };
}

const docker = command(["docker"]);
const sudo = command(["sudo", "-n"]);
const driverImage = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-docker-profile-project-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

async function fileExists(path: string): Promise<true | undefined> {
  try {
    await readFile(path);
    return true;
  } catch {
    return undefined;
  }
}

async function quotaPath(): Promise<string> {
  const candidates = (process.env.PATH ?? "").split(":");
  try {
    for (const name of await readdir("/nix/store")) {
      if (/^[^-]+-quota-[^/]+$/.test(name)) candidates.push(`/nix/store/${name}/bin`);
    }
  } catch {
    // Non-Nix hosts can provide quota-tools on PATH.
  }
  for (const candidate of candidates) {
    if ((await command(["test"]).run(["-x", join(candidate, "setquota")])).exitCode === 0) {
      return [candidate, process.env.PATH ?? ""].filter(Boolean).join(":");
    }
  }
  throw new Error("project-quota tools (setquota/repquota) are required by this E2E");
}

test("profile-bound Dockerfile cold build starts the Attempt through the public CLI", async () => {
  const scripts = process.env.NICEEVAL_E2E_DOCKER_PROFILE_HOST_SCRIPTS;
  expect(scripts, "runner must inject the actual Docker profile host scripts").toBeTruthy();
  const fixtureScript = resolve("fixtures/profile-host-fixture.py");
  const dockerInfo = await docker.run(["info", "--format", "{{.DockerRootDir}}"]);
  expect(dockerInfo.exitCode, dockerInfo.diagnostic()).toBe(0);
  const hostPath = await quotaPath();
  const user = process.env.USER ?? process.env.LOGNAME;
  expect(user, "E2E runner user must be named for the quota-slot owner").toBeTruthy();
  const id = await command(["id"]).run(["-gn", user!]);
  expect(id.exitCode, id.diagnostic()).toBe(0);

  await withProjectCopy(projectCopy, async ({ root: projectRoot }) => {
    // The unique context byte keeps this owner a real cold build even when the
    // daemon already carries an image from an earlier reliability repetition.
    await appendFile(
      join(projectRoot, "fixtures/profile-cold-build/Dockerfile"),
      `\n# cold-build-owner ${crypto.randomUUID()}\n`,
    );
    await withTempDir("niceeval-e2e-docker-profile-", async (hostRoot) => {
      let fixture: HostFixture | undefined;
      let primaryError: unknown;
      try {
        const setup = await sudo.run([
          "env", `PATH=${hostPath}`,
          "python3", fixtureScript, "setup",
          "--root", hostRoot,
          "--scripts", scripts!,
          "--docker-root", dockerInfo.stdout.trim(),
          "--user", user!,
          "--group", id.stdout.trim(),
        ], { timeoutMs: 60_000 });
        expect(setup.exitCode, setup.diagnostic()).toBe(0);
        fixture = JSON.parse(setup.stdout.trim().split("\n").at(-1)!) as HostFixture;
        const activeFixture = fixture;

        await withProcess(
          [
            "sudo", "-n", "env", `PATH=${hostPath}`, "PYTHONDONTWRITEBYTECODE=1",
            "python3", join(scripts!, "watchdog.py"),
            "--control-socket", activeFixture.controlSocket,
            "--descriptor", activeFixture.descriptor,
            "--host-config", activeFixture.hostConfig,
            "--docker-socket", "/run/docker.sock",
            "--journal", activeFixture.journal,
            "--ready-file", activeFixture.readyFile,
            "--socket-mode", "0o600",
          ],
          { processGroup: true, timeoutMs: 180_000, graceMs: 5_000 },
          async (watchdog) => {
            await Promise.race([
              pollUntil(() => fileExists(activeFixture.readyFile), {
                timeoutMs: 15_000,
                intervalMs: 100,
                label: "isolated real watchdog ready file",
              }),
              watchdog.done.then((receipt) => {
                throw new Error(`watchdog exited before readiness\n${receipt.diagnostic()}`);
              }),
            ]);

            const driver = await docker.run([
              "run", "--rm", "--user", "0:0",
              "--mount", `type=bind,src=${process.cwd()},dst=${process.cwd()},readonly`,
              "--mount", `type=bind,src=${projectRoot},dst=${projectRoot}`,
              "--mount", `type=bind,src=${hostRoot},dst=${hostRoot}`,
              "--mount", "type=bind,src=/run/docker.sock,dst=/run/docker.sock",
              "--workdir", projectRoot,
              "--env", "NICEEVAL_E2E_DOCKER_PROFILE_ALIAS=e2e-cold-build",
              driverImage,
              "sh", "-ec",
              `trap 'chown -R ${process.getuid!()}:${process.getgid!()} ${projectRoot}/.niceeval 2>/dev/null || true' EXIT
mkdir -p /etc/niceeval/docker-profiles
cp '${activeFixture.descriptor}' /etc/niceeval/docker-profiles/e2e-cold-build.json
chown root:root /etc/niceeval/docker-profiles/e2e-cold-build.json
chmod 600 /etc/niceeval/docker-profiles/e2e-cold-build.json
set +e
node_modules/.bin/niceeval exp docker-profile-cold-build --rerun all --json >/tmp/niceeval-exp.ndjson
status=$?
set -e
cat /tmp/niceeval-exp.ndjson
run_id=$(node -e 'const fs=require("fs"); const lines=fs.readFileSync("/tmp/niceeval-exp.ndjson","utf8").trim().split("\\n"); const receipt=JSON.parse(lines.at(-1)); process.stdout.write(receipt.receipt.runIds[0])')
if [ "$status" -ne 0 ]; then
  locator=$(node -e 'const fs=require("fs"); for (const line of fs.readFileSync("/tmp/niceeval-exp.ndjson","utf8").trim().split("\\n")) { const value=JSON.parse(line); if (value.locator) { process.stdout.write(value.locator); break } }')
  if [ -n "$locator" ]; then
    node_modules/.bin/niceeval show "$locator" --execution
  else
    node_modules/.bin/niceeval show --run "$run_id" --json
  fi
fi
exit "$status"`,
            ], { cwd: projectRoot, timeoutMs: 150_000 });
            expect(driver.exitCode, driver.diagnostic()).toBe(0);
            const evals = driver.ndjson<ExpEvent>().filter(
              (event): event is Extract<ExpEvent, { event: "eval" }> =>
                "event" in event && event.event === "eval",
            );
            expect(only(evals, (event) => event.evalId === "docker-profile-cold-build"), driver.diagnostic())
              .toMatchObject({ verdict: "passed" });
          },
        );

        const journal = await sudo.run(["cat", fixture.journal]);
        expect(journal.exitCode, journal.diagnostic()).toBe(0);
        const records = journal.stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as HostJournalRecord);
        const events = records.map((record) => record.event);
        expect(events).toContain("reservation-granted");
        expect(events).toContain("build-terminated");
        expect(events).toContain("container-active");
        expect(events).toContain("reservation-released");
        const buildLocator = records.find((record) => record.event === "build-terminated")?.detail.locator;
        expect(typeof buildLocator).toBe("string");
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        const cleanupErrors: unknown[] = [];
        if (fixture !== undefined) {
          try {
            const journal = await sudo.run(["cat", fixture.journal]);
            if (journal.exitCode !== 0) throw new Error(journal.diagnostic());
            const records = journal.stdout
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line) as HostJournalRecord);
            const locators = new Set<string>();
            const builderNames = new Set<string>();
            for (const record of records) {
              if (record.event === "build-terminated" && typeof record.detail.locator === "string") {
                locators.add(record.detail.locator);
              }
              if (record.event === "build-builder-created" && typeof record.detail.builderName === "string") {
                builderNames.add(record.detail.builderName);
              }
              for (const reservation of Object.values(record.state?.reservations ?? {})) {
                if (reservation.kind === "build" && typeof reservation.locator === "string") {
                  locators.add(reservation.locator);
                }
                if (reservation.kind === "build" && typeof reservation.builderName === "string") {
                  builderNames.add(reservation.builderName);
                }
              }
            }
            for (const locator of locators) {
              const removeImage = await docker.run(["image", "rm", "--force", locator]);
              if (removeImage.exitCode !== 0 && !/No such image/i.test(removeImage.diagnostic())) {
                throw new Error(removeImage.diagnostic());
              }
            }
            for (const builderName of builderNames) {
              if (!/^niceeval-build-[a-f0-9]{24}$/.test(builderName)) {
                throw new Error(`watchdog journal contains a non-derived builder name: ${builderName}`);
              }
              const volumeName = `buildx_buildkit_${builderName}0_state`;
              const inspectVolume = await docker.run(["volume", "inspect", volumeName]);
              if (inspectVolume.exitCode === 0) {
                const removeVolume = await docker.run(["volume", "rm", "--force", volumeName]);
                throw new Error(
                  `watchdog leaked Buildx state volume ${volumeName}; cleanup: ${removeVolume.diagnostic()}`,
                );
              }
              if (!/No such volume/i.test(inspectVolume.diagnostic())) {
                throw new Error(inspectVolume.diagnostic());
              }
            }
          } catch (error) {
            cleanupErrors.push(error);
          }
          try {
            const cleanup = await sudo.run([
              "env", `PATH=${hostPath}`,
              "python3", fixtureScript, "cleanup", "--root", hostRoot,
            ], { timeoutMs: 30_000 });
            if (cleanup.exitCode !== 0) throw new Error(cleanup.diagnostic());
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        if (cleanupErrors.length > 0) {
          if (primaryError !== undefined) {
            console.error(new AggregateError(cleanupErrors, "Docker profile E2E cleanup also failed"));
          } else {
            throw new AggregateError(cleanupErrors, "Docker profile E2E cleanup failed");
          }
        }
      }
    });
  });
}, 240_000);
