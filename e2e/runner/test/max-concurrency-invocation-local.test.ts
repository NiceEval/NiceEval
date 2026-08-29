// rerun: pnpm e2e test --repo runner -- --run test/max-concurrency-invocation-local.test.ts
import { only, pollUntil, withTempDir } from "@niceeval/testkit";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

const HOLDING_EVAL_IDS = [
  "max-concurrency/hold-alpha",
  "max-concurrency/hold-beta",
  "max-concurrency/hold-gamma",
] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("并行运行同一 Experiment 时，每次 Invocation 保有自己的并发额度 [necase_YAJ06RV7ZR47KAZD]", async () => {
  await runnerE2E.case(
    "max-concurrency-invocation-local",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      await withTempDir("niceeval-runner-max-concurrency-", async (barrierRoot) => {
        const holders = niceeval.start(
          ["exp", "max-concurrency", "max-concurrency/hold", "--rerun", "all", "--json"],
          {
            env: {
              NICEEVAL_MAX_CONCURRENCY_BARRIER: barrierRoot,
              NICEEVAL_MAX_CONCURRENCY_LIMIT: "3",
            },
            timeoutMs: 60_000,
          },
        );
        let probe: ReturnType<typeof niceeval.start> | undefined;
        let blockedBeforeRelease: unknown;
        let probeEnteredBeforeRelease = false;

        try {
          await pollUntil(
            async () => {
              const entered = await Promise.all(HOLDING_EVAL_IDS.map((evalId) =>
                exists(join(barrierRoot, `${evalId.replaceAll("/", "-")}-entered`)),
              ));
              return entered.every(Boolean) ? true : undefined;
            },
            { timeoutMs: 30_000, intervalMs: 10, label: "larger Invocation fills its Experiment concurrency" },
          );

          probe = niceeval.start(
            ["exp", "max-concurrency", "max-concurrency/probe", "--rerun", "all", "--json"],
            {
              env: {
                NICEEVAL_MAX_CONCURRENCY_BARRIER: barrierRoot,
                NICEEVAL_MAX_CONCURRENCY_LIMIT: "1",
              },
              timeoutMs: 60_000,
            },
          );
          probeEnteredBeforeRelease = await pollUntil(
            async () => (await exists(join(barrierRoot, "probe-agent-entered"))) || undefined,
            {
              // The contract is entry before the holders are released. Leave enough
              // startup headroom for the Runner repo's default parallel test load.
              timeoutMs: 20_000,
              intervalMs: 10,
              label: "smaller Invocation enters its independent Agent before holders release",
            },
          ).then(() => true).catch((error: unknown) => {
            blockedBeforeRelease = error;
            return false;
          });
        } finally {
          await writeFile(join(barrierRoot, "release-holders"), "");
        }

        const holderResult = await holders.done;
        const probeResult = probe === undefined ? undefined : await probe.done;
        if (blockedBeforeRelease !== undefined) throw blockedBeforeRelease;

        expect(probeEnteredBeforeRelease).toBe(true);
        expect(holderResult.exitCode, holderResult.diagnostic()).toBe(0);
        expect(probeResult, "the smaller Invocation starts after the holders enter").toBeDefined();
        expect(probeResult!.exitCode, probeResult!.diagnostic()).toBe(0);

        const holderEvents = holderResult.expEvalEvents();
        expect(holderEvents).toEqual(expect.arrayContaining(
          HOLDING_EVAL_IDS.map((evalId) => expect.objectContaining({ evalId, verdict: "passed" })),
        ));
        const probeEvents = probeResult!.expEvents();
        expect(probeEvents.some((event) => event.event === "lock_wait")).toBe(false);
        expect(
          only(
            probeEvents,
            (event) => event.event === "eval" && event.evalId === "max-concurrency/probe",
            probeResult!.diagnostic(),
          ),
        ).toMatchObject({ verdict: "passed" });
      });
    },
  );
});
