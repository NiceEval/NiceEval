// owner: docs/engineering/testing/e2e/README.md#process-group-terminal-state
// Rerun: pnpm e2e --repo lifecycle -- --run test/process-group-zombie-cleanup.test.ts -t "owned Linux process group"
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { defined, pollUntil, startProcess, withProcess, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ZombieFixture {
  readonly groupId: number;
  readonly helperPid: number;
  readonly zombiePid: number;
}

interface ProcfsScanRaceFixture {
  readonly groupId: number;
  readonly paddingPid: number;
  readonly raceParentPid: number;
}

interface ProcfsScanRaceChild {
  readonly childPid: number;
  readonly groupId: number;
}

interface ProcessGroupMember {
  readonly pid: number;
  readonly processGroup: number;
  readonly state: string;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseFixture(stdout: string): ZombieFixture {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`zombie fixture did not emit JSON: ${stdout}\n${String(error)}`);
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`zombie fixture did not emit an object: ${stdout}`);
  }
  const fixture = value as Record<string, unknown>;
  return {
    groupId: positiveInteger(fixture.groupId, "fixture groupId"),
    helperPid: positiveInteger(fixture.helperPid, "fixture helperPid"),
    zombiePid: positiveInteger(fixture.zombiePid, "fixture zombiePid"),
  };
}

function parseProcfsScanRaceFixture(stdout: string): ProcfsScanRaceFixture {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`procfs scan race fixture did not emit JSON: ${stdout}\n${String(error)}`);
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`procfs scan race fixture did not emit an object: ${stdout}`);
  }
  const fixture = value as Record<string, unknown>;
  return {
    groupId: positiveInteger(fixture.groupId, "race fixture groupId"),
    paddingPid: positiveInteger(fixture.paddingPid, "race fixture paddingPid"),
    raceParentPid: positiveInteger(fixture.raceParentPid, "race fixture raceParentPid"),
  };
}

function parseProcfsScanRaceChild(stdout: string): ProcfsScanRaceChild {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`procfs scan race child did not emit JSON: ${stdout}\n${String(error)}`);
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`procfs scan race child did not emit an object: ${stdout}`);
  }
  const child = value as Record<string, unknown>;
  return {
    childPid: positiveInteger(child.childPid, "race childPid"),
    groupId: positiveInteger(child.groupId, "race child groupId"),
  };
}

function parseLinuxStat(pid: number, stat: string): ProcessGroupMember {
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0 || stat[commandEnd + 1] !== " ") {
    throw new Error(`cannot parse /proc/${pid}/stat`);
  }
  const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
  const state = fields[0];
  const processGroup = Number(fields[2]);
  if (state === undefined || !Number.isSafeInteger(processGroup)) {
    throw new Error(`cannot parse process state/group from /proc/${pid}/stat`);
  }
  return { pid, state, processGroup };
}

async function processGroupMembers(groupId: number): Promise<readonly ProcessGroupMember[]> {
  const entries = await readdir("/proc", { withFileTypes: true });
  const observed = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map(async (entry) => {
        const pid = Number(entry.name);
        try {
          const member = parseLinuxStat(pid, await readFile(`/proc/${entry.name}/stat`, "utf8"));
          return member.processGroup === groupId ? member : undefined;
        } catch (error) {
          if (errorCode(error) === "ENOENT" || errorCode(error) === "ESRCH") return undefined;
          throw error;
        }
      }),
  );
  return observed.filter((member): member is ProcessGroupMember => member !== undefined);
}

async function processGone(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return true;
    throw error;
  }
}

async function processGroupGone(groupId: number): Promise<boolean> {
  try {
    process.kill(-groupId, 0);
    return false;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return true;
    throw error;
  }
}

async function killProcessGroup(groupId: number): Promise<void> {
  try {
    process.kill(-groupId, "SIGKILL");
  } catch (error) {
    if (errorCode(error) !== "ESRCH") throw error;
  }
}

async function stopFixtureHelper(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (errorCode(error) !== "ESRCH") throw error;
  }
  await pollUntil(
    async () => await processGone(pid) ? true : undefined,
    { timeoutMs: 5_000, intervalMs: 25, label: `zombie fixture helper ${pid} to exit` },
  );
}

// This controls the exact lost-wakeup boundary: the legacy SIGCHLD + pause
// loop releases its child after checking status, while the waitpid loop
// releases only after Linux reports that it is blocked in do_wait.
const subreaperWakeupProbe = String.raw`
import os
from pathlib import Path
import signal
import sys
import threading
import time

runner = sys.argv[1]
release_read, release_write = os.pipe()
os.set_inheritable(release_read, True)
child = (
    "import os; "
    "fd = int(os.environ['SUBREAPER_RACE_RELEASE_FD']); "
    "os.read(fd, 1); "
    "os._exit(17)"
)

def release_when_waitpid_blocks() -> None:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if Path("/proc/self/wchan").read_text().strip() == "do_wait":
            os.write(release_write, b"x")
            return
        time.sleep(0.001)

threading.Thread(target=release_when_waitpid_blocks, daemon=True).start()
original_pause = signal.pause

def release_inside_old_pause() -> None:
    os.write(release_write, b"x")
    time.sleep(0.05)
    return original_pause()

signal.pause = release_inside_old_pause
os.environ["SUBREAPER_RACE_RELEASE_FD"] = str(release_read)
source = Path(runner).read_text()
sys.argv = [runner, sys.executable, "-c", child]
namespace = {"__name__": "__main__", "__file__": runner}
exec(compile(source, runner, "exec"), namespace)
`;

test("Lifecycle subreaper returns a child exit observed at its blocking wait boundary", async () => {
  const runner = join(process.cwd(), "fixtures", "subreaper-runner.py");
  await withProcess(
    ["python3", "-c", subreaperWakeupProbe, runner],
    { cwd: process.cwd(), processGroup: true, graceMs: 100, timeoutMs: 2_000 },
    async (probe) => {
      const result = await probe.done;
      expect(result.exitCode, result.diagnostic()).toBe(17);
      expect(result.signal, result.diagnostic()).toBeNull();
      expect(result.timedOut, result.diagnostic()).toBe(false);
    },
  );
});

// regression: memory/testkit-zombie-only-process-group.md
test("ProcessHandle cleanup completes when an owned Linux process group contains only terminal zombies", async () => {
  const handle = startProcess(
    ["python3", join(process.cwd(), "fixtures", "zombie-only-process-group.py")],
    { cwd: process.cwd(), processGroup: true, graceMs: 100, timeoutMs: 10_000 },
  );
  let groupId: number | undefined;
  let helperPid: number | undefined;
  let disposeAttempted = false;

  try {
    const root = await handle.done;
    expect(root.exitCode, root.diagnostic()).toBe(0);
    expect(root.signal, root.diagnostic()).toBeNull();

    const fixture = parseFixture(root.stdout);
    groupId = defined(handle.pid, "zombie fixture root did not expose its process-group ID");
    helperPid = fixture.helperPid;
    expect(fixture.groupId).toBe(groupId);

    const onlyMember = await pollUntil(
      async () => {
        const members = await processGroupMembers(groupId!);
        return members.length === 1 && members[0]?.state === "Z" ? members[0] : undefined;
      },
      { timeoutMs: 5_000, intervalMs: 25, label: `owned process group ${groupId} to contain only a zombie` },
    );
    expect(onlyMember).toEqual({
      pid: fixture.zombiePid,
      processGroup: groupId,
      state: "Z",
    });
    // signal 0 is the old implementation's only liveness probe. It still sees
    // the kernel's terminal zombie even though TERM and KILL cannot change it.
    expect(() => process.kill(-groupId, 0)).not.toThrow();

    disposeAttempted = true;
    await handle.dispose();
  } finally {
    if (!disposeAttempted) await handle.dispose().catch(() => {});
    if (helperPid !== undefined) await stopFixtureHelper(helperPid);
    if (groupId !== undefined) {
      await pollUntil(
        async () => (await processGroupMembers(groupId!)).length === 0 ? true : undefined,
        { timeoutMs: 5_000, intervalMs: 25, label: `owned process group ${groupId} to be physically reaped` },
      );
    }
  }
});

// regression: PR #64 procfs process-group scan race
test("ProcessHandle cleanup does not leave a descendant forked during its procfs terminal-state scan", async () => {
  await withTempDir("niceeval-process-group-procfs-race-", async (tempRoot) => {
    const statusPath = join(tempRoot, "descendant.json");
    const handle = startProcess(
      [
        "python3",
        join(process.cwd(), "fixtures", "process-group-procfs-scan-race.py"),
        statusPath,
      ],
      { cwd: process.cwd(), processGroup: true, graceMs: 100, timeoutMs: 10_000 },
    );
    let groupId: number | undefined;
    let paddingPid: number | undefined;
    let raceParentPid: number | undefined;
    let childPid: number | undefined;
    let disposeAttempted = false;

    try {
      const root = await handle.done;
      expect(root.exitCode, root.diagnostic()).toBe(0);
      expect(root.signal, root.diagnostic()).toBeNull();

      const fixture = parseProcfsScanRaceFixture(root.stdout);
      groupId = defined(handle.pid, "procfs scan race root did not expose its process-group ID");
      paddingPid = fixture.paddingPid;
      raceParentPid = fixture.raceParentPid;
      expect(fixture.groupId).toBe(groupId);

      // This synchronously releases the group parent immediately before
      // ProcessHandle snapshots /proc. Its child is therefore born after that
      // snapshot, while padding keeps the parent's stale entry late in the scan.
      process.kill(raceParentPid, "SIGUSR1");
      disposeAttempted = true;
      await handle.dispose();

      const child = await pollUntil(
        async () => {
          try {
            return parseProcfsScanRaceChild(await readFile(statusPath, "utf8"));
          } catch (error) {
            if (errorCode(error) === "ENOENT") return undefined;
            throw error;
          }
        },
        { timeoutMs: 5_000, intervalMs: 10, label: "procfs scan race descendant to report" },
      );
      childPid = child.childPid;
      expect(child.groupId).toBe(groupId);

      await pollUntil(
        async () => await processGone(childPid!) ? true : undefined,
        {
          timeoutMs: 1_000,
          intervalMs: 10,
          label: `procfs scan race descendant ${childPid} to be terminated`,
        },
      );
      await pollUntil(
        async () => await processGroupGone(groupId!) ? true : undefined,
        {
          timeoutMs: 1_000,
          intervalMs: 10,
          label: `procfs scan race group ${groupId} to disappear`,
        },
      );
    } finally {
      if (!disposeAttempted) await handle.dispose().catch(() => {});
      if (groupId !== undefined) await killProcessGroup(groupId).catch(() => {});
      if (paddingPid !== undefined) await stopFixtureHelper(paddingPid).catch(() => {});
      if (childPid !== undefined) {
        await pollUntil(
          async () => await processGone(childPid!) ? true : undefined,
          {
            timeoutMs: 5_000,
            intervalMs: 25,
            label: `procfs scan race descendant ${childPid} cleanup`,
          },
        ).catch(() => {});
      }
    }
  });
});
