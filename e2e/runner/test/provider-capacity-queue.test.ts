// rerun: pnpm e2e test --repo runner -- --run test/provider-capacity-queue.test.ts
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command, pollUntil, withTempDir } from "@niceeval/testkit";
import { decodeSessionListDocument, decodeSessionShowDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

const DRIVER_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";
const PROFILE_EXPERIMENT = "provider-capacity/base/00-profile";
const INDEPENDENT_EXPERIMENT = "provider-capacity/base/10-independent";
const PROFILE_QUEUED_EVAL = "provider-capacity-profile/02-second";
const PROFILE_QUEUED_ATTEMPT = 0;
const DRIVER_DEADLINE_MS = 230_000;
const OWNER_DEADLINE_MS = 235_000;
const docker = command(["docker"]);

interface PublicObservation {
  readonly sessionListJson: string;
  readonly sessionShowJson: string;
  readonly sessionShowHuman: string;
  readonly liveHuman: string;
}

interface MatrixObservation {
  readonly edgeBlocked: { readonly sessionShowJson: string; readonly control: Record<string, any>; readonly liveHuman: string };
  readonly edgeAbnormal: { readonly sessionShowJson: string; readonly control: Record<string, any>; readonly liveHuman: string };
  readonly cancelled: {
    readonly cancelControl: Record<string, any>;
    readonly cancelHuman: string;
    readonly cancelPublic: { readonly sessionShowJson: string };
    readonly reuse: { readonly sessionShowJson: string; readonly exitCode: number | null; readonly control: Record<string, any>; readonly liveHuman: string };
  };
  readonly capacityOne: {
    readonly control: Record<string, any>;
    readonly sessionShowJson: string;
    readonly exitCode: number | null;
    readonly lifecycle: { readonly containerCreates: number; readonly activeContainers: number; readonly maxActiveContainers: number };
  };
  readonly groupReuse: {
    readonly control: Record<string, any>;
    readonly sessionShowJson: string;
    readonly exitCode: number | null;
    readonly lifecycle: { readonly containerCreates: number; readonly activeContainers: number; readonly maxActiveContainers: number };
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function terminalText(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/gu, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replaceAll("\r", "")
    .replaceAll("\b", "");
}

async function removeOwnedDockerObjects(label: string, cleanupErrors: unknown[]): Promise<void> {
  const kinds = [
    { list: ["ps", "--all", "--quiet", "--filter", `label=${label}`], remove: ["rm", "--force", "--volumes"] },
    { list: ["network", "ls", "--quiet", "--filter", `label=${label}`], remove: ["network", "rm"] },
    { list: ["volume", "ls", "--quiet", "--filter", `label=${label}`], remove: ["volume", "rm", "--force"] },
  ] as const;
  for (const kind of kinds) {
    const listed = await docker.run(kind.list);
    if (listed.exitCode !== 0) {
      cleanupErrors.push(new Error(listed.diagnostic()));
      continue;
    }
    const ids = listed.stdout.split("\n").map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) continue;
    const removed = await docker.run([...kind.remove, ...ids], { timeoutMs: 30_000 });
    if (removed.exitCode !== 0) cleanupErrors.push(new Error(removed.diagnostic()));
  }
}

async function restoreBindMountPermissions(
  label: string,
  projectRoot: string,
  controlRoot: string,
): Promise<void> {
  const restored = await docker.run([
    "run", "--rm", "--network", "none",
    "--label", label,
    "--mount", `type=bind,src=${projectRoot},dst=/project`,
    "--mount", `type=bind,src=${controlRoot},dst=/control-root`,
    DRIVER_IMAGE,
    "sh", "-ceu",
    'owner="$1"; shift; for target do if [ -e "$target" ]; then chown -R "$owner" "$target"; fi; done',
    "provider-capacity-permission-recovery",
    `${process.getuid!()}:${process.getgid!()}`,
    "/project/.niceeval",
    "/control-root",
  ], { timeoutMs: 30_000 });
  if (restored.exitCode !== 0) throw new Error(restored.diagnostic());
}

async function removeOwnedDockerResources(
  runId: string,
  image: string,
  projectRoot: string,
  controlRoot: string,
  restorePermissions: boolean,
): Promise<void> {
  const label = `niceeval.e2e.provider-capacity=${runId}`;
  const cleanupErrors: unknown[] = [];
  await removeOwnedDockerObjects(label, cleanupErrors);
  if (restorePermissions) {
    try {
      await restoreBindMountPermissions(label, projectRoot, controlRoot);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  // A timed-out permission helper can outlive its Docker client. Sweep the
  // same owned label again before removing the fixture image.
  await removeOwnedDockerObjects(label, cleanupErrors);
  const removedImage = await docker.run(["image", "rm", "--force", image], { timeoutMs: 30_000 });
  if (removedImage.exitCode !== 0 && !/No such image/u.test(removedImage.diagnostic())) {
    cleanupErrors.push(new Error(removedImage.diagnostic()));
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "provider-capacity Docker fixture cleanup failed");
  }
}

test("等待 Docker profile 容量时保持排队且不阻塞其它 Provider [necase_VXE9ARZNBMZ6V0JT]", async () => {
  await runnerE2E.case(
    "provider-capacity-queue",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths, start }) => {
      await withTempDir("niceeval-runner-provider-capacity-", async (controlRoot) => {
        const runId = crypto.randomUUID();
        const image = `niceeval-e2e-provider-capacity:${runId}`;
        let observation: PublicObservation | undefined;
        let driverStarted = false;
        let primaryError: unknown;
        try {
          const built = await docker.run([
            "build",
            "--tag", image,
            join(paths.projectRoot, "fixtures/provider-capacity"),
          ], { timeoutMs: 120_000 });
          expect(built.exitCode, built.diagnostic()).toBe(0);

          const driver = start([
            "docker", "run", "--rm", "--init", "--network", "none",
            "--label", `niceeval.e2e.provider-capacity=${runId}`,
            "--mount", `type=bind,src=${paths.sourceRoot},dst=${paths.sourceRoot},readonly`,
            "--mount", `type=bind,src=${paths.projectRoot},dst=${paths.projectRoot}`,
            "--mount", `type=bind,src=${controlRoot},dst=${controlRoot}`,
            "--mount", "type=bind,src=/run/docker.sock,dst=/run/docker.sock",
            "--workdir", paths.projectRoot,
            "--env", `NICEEVAL_E2E_PROVIDER_CAPACITY_CONTROL_ROOT=${controlRoot}`,
            "--env", `NICEEVAL_E2E_PROVIDER_CAPACITY_IMAGE=${image}`,
            "--env", `NICEEVAL_E2E_PROVIDER_CAPACITY_RUN_ID=${runId}`,
            "--env", `NICEEVAL_E2E_HOST_UID=${process.getuid!()}`,
            "--env", `NICEEVAL_E2E_HOST_GID=${process.getgid!()}`,
            DRIVER_IMAGE,
            "node", "fixtures/provider-capacity/driver.mjs",
          ], { timeoutMs: DRIVER_DEADLINE_MS, graceMs: 10_000 });
          driverStarted = true;

          const ready = join(controlRoot, "observation-ready");
          await Promise.race([
            pollUntil(
              async () => await exists(ready) ? true : undefined,
              { timeoutMs: 90_000, intervalMs: 50, label: "public provider-capacity observation" },
            ),
            driver.done.then((receipt) => {
              throw new Error(`provider-capacity driver exited before observation\n${receipt.diagnostic()}`);
            }),
          ]);
          try {
            observation = JSON.parse(
              await readFile(join(controlRoot, "public-observation.json"), "utf8"),
            ) as PublicObservation;
          } finally {
            await writeFile(join(controlRoot, "release-profile-first"), "");
          }
          const driverReceipt = await driver.done;
          expect(driverReceipt.exitCode, driverReceipt.diagnostic()).toBe(0);
          const matrix = JSON.parse(
            await readFile(join(controlRoot, "matrix-observation.json"), "utf8"),
          ) as MatrixObservation;
          const assertNoCreate = (scenario: string, observation: { readonly sessionShowJson: string; readonly control: Record<string, any>; readonly liveHuman: string }) => {
            expect(observation.control.reservations, `${scenario} reservations must be released`).toEqual([]);
            expect(observation.control.used, `${scenario} provider capacity must be zero`).toEqual({ containers: 0, builds: 0 });
            expect(observation.control.events?.containerCreates, `${scenario} must not call container.create`).toBe(0);
            expect(
              (observation.control.events?.reservationReleases ?? 0) +
              (observation.control.events?.reservationCancels ?? 0),
              `${scenario} must relinquish its reservation`,
            ).toBeGreaterThanOrEqual(1);
            expect(observation.liveHuman, `${scenario} must not expose sandbox creation`).not.toMatch(/creating sandbox|sandbox\.create/u);
            expect(observation.sessionShowJson, `${scenario} public session must not expose sandbox.create`).not.toContain("sandbox.create");
          };
          assertNoCreate("immediate blocked", matrix.edgeBlocked);
          assertNoCreate("abnormal non-granted", matrix.edgeAbnormal);
          expect(matrix.edgeBlocked.control.events?.acquiredStates).toContain("blocked");
          expect(matrix.edgeBlocked.control.events?.reservationCancels).toBeGreaterThanOrEqual(1);
          expect(matrix.edgeAbnormal.control.events?.acquiredStates).toContain("provisioning");
          expect(matrix.edgeAbnormal.control.events?.reservationReleases).toBeGreaterThanOrEqual(1);
          assertNoCreate("grant/reacquire cancellation", {
            sessionShowJson: matrix.cancelled.cancelPublic.sessionShowJson,
            control: matrix.cancelled.cancelControl,
            liveHuman: matrix.cancelled.cancelHuman,
          });
          expect(matrix.cancelled.cancelControl.events?.acquiredStates).toEqual(expect.arrayContaining(["queued", "granted"]));
          expect(matrix.cancelled.reuse.control.events?.containerCreates).toBe(1);
          expect(matrix.cancelled.reuse.control.reservations).toEqual([]);
          expect(matrix.cancelled.reuse.exitCode).toBe(0);
          expect(matrix.capacityOne.lifecycle).toMatchObject({ containerCreates: 2, activeContainers: 0, maxActiveContainers: 1 });
          expect(matrix.capacityOne.control.reservations).toEqual([]);
          expect(matrix.capacityOne.control.used).toEqual({ containers: 0, builds: 0 });
          expect(matrix.capacityOne.exitCode).toBe(0);
          expect(matrix.groupReuse.lifecycle).toMatchObject({ containerCreates: 2, activeContainers: 0, maxActiveContainers: 1 });
          expect(matrix.groupReuse.control.reservations).toEqual([]);
          expect(matrix.groupReuse.control.used).toEqual({ containers: 0, builds: 0 });
          expect(matrix.groupReuse.exitCode).toBe(0);
          const groupSession = decodeSessionShowDocument(JSON.parse(matrix.groupReuse.sessionShowJson));
          expect("status" in groupSession.session).toBe(true);
          if (!("status" in groupSession.session)) throw new Error("group reuse Session unexpectedly expired");
          expect(groupSession.session.status).toBe("completed");
        } catch (error) {
          primaryError = error;
          throw error;
        } finally {
          try {
            await removeOwnedDockerResources(
              runId,
              image,
              paths.projectRoot,
              controlRoot,
              driverStarted,
            );
          } catch (cleanupError) {
            if (primaryError !== undefined) {
              throw new AggregateError(
                [primaryError, cleanupError],
                "provider-capacity owner and Docker fixture cleanup both failed",
              );
            }
            throw cleanupError;
          }
        }

        expect(observation, "driver must capture public status while the first reservation is gated").toBeDefined();
        const session = decodeSessionShowDocument(JSON.parse(observation!.sessionShowJson));
        expect(session).toMatchObject({ format: "niceeval.session", session: { status: "active" } });
        expect("experiments" in session.session).toBe(true);
        if (!("experiments" in session.session)) throw new Error("observed Session unexpectedly expired");
        const experiments = session.session.experiments;
        const profile = experiments.find((experiment) => experiment.experimentId === PROFILE_EXPERIMENT);
        expect(profile, "public Session must include the profile-bound Experiment").toBeDefined();
        expect(profile).toMatchObject({ running: 1, queued: 1 });
        const independent = experiments.find(
          (experiment) => experiment.experimentId === INDEPENDENT_EXPERIMENT,
        );
        expect(
          independent,
          "the same public Session snapshot must show the unrelated Provider Attempt completed",
        ).toMatchObject({ running: 0, queued: 0, elsewhere: 0 });

        const aggregate = experiments.reduce(
          (counts, experiment) => ({
            running: counts.running + (experiment.running ?? 0),
            queued: counts.queued + (experiment.queued ?? 0),
          }),
          { running: 0, queued: 0 },
        );
        expect(aggregate).toEqual({ running: 1, queued: 1 });

        expect(profile?.attempts).toBeDefined();
        const waiter = profile!.attempts!.find((attempt) =>
          attempt.evalId === PROFILE_QUEUED_EVAL &&
          attempt.attempt === PROFILE_QUEUED_ATTEMPT &&
          attempt.state === "queued" &&
          attempt.reason === "provider-capacity"
        );
        expect(waiter, "the queued Attempt must expose reason=provider-capacity").toBeDefined();
        expect(JSON.stringify(waiter)).not.toContain("sandbox.create");
        expect(JSON.stringify(waiter)).not.toContain("creating sandbox");

        const listed = decodeSessionListDocument(JSON.parse(observation!.sessionListJson));
        expect(listed.sessions.some((candidate) => candidate.sessionId === session.session.sessionId)).toBe(true);

        expect(observation!.sessionShowHuman).toMatch(
          /provider-capacity\/base\/00-profile[^\n]*1 running · 1 queued/u,
        );
        const liveHuman = terminalText(observation!.liveHuman);
        const statusLine = liveHuman.split("\n").filter((line) => line.includes("total ·")).at(-1);
        expect(statusLine, liveHuman).toMatch(/3 total.*1 running.*1 queued.*1 passed/u);
        const waiterLine = liveHuman.split("\n").find((line) => line.includes("waiting for provider capacity"));
        expect(waiterLine, liveHuman).toBeDefined();
        expect(waiterLine).not.toContain("creating sandbox");
      });
    },
  );
}, OWNER_DEADLINE_MS);
