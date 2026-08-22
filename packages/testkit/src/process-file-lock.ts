import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ProcessFileLockOptions {
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly malformedStaleAfterMs?: number;
  readonly label: string;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

interface ProcessLockState {
  references: number;
  readonly releasePhysical: () => Promise<void>;
  closing?: Promise<void>;
}

const PROCESS_LOCKS = new Map<string, Promise<ProcessLockState>>();

async function moveExactLockAside(
  lockPath: string,
  expected: string,
  suffix: string,
): Promise<void> {
  const current = await readFile(lockPath, "utf8").catch(() => undefined);
  if (current !== expected) return;
  const quarantine = `${lockPath}.${suffix}`;
  await rename(lockPath, quarantine).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error;
  });
  await rm(quarantine, { force: true });
}

/**
 * Acquire an exact host-file lock shared by independent E2E processes.
 *
 * The PID lets a successor recover a lock left by a terminated process. The
 * random token makes release ownership exact, so a stale releaser cannot
 * delete a successor's lock after an atomic rename handoff.
 */
async function acquirePhysicalFileLock(
  lockPath: string,
  options: ProcessFileLockOptions,
): Promise<() => Promise<void>> {
  const intervalMs = options.intervalMs ?? 25;
  const malformedStaleAfterMs = options.malformedStaleAfterMs ?? 5_000;
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + options.timeoutMs;
  await mkdir(dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(token, "utf8");
      } finally {
        await handle.close();
      }
      let release: Promise<void> | undefined;
      return () => release ??= moveExactLockAside(
        lockPath,
        token,
        `released-${randomUUID()}`,
      );
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    const current = await readFile(lockPath, "utf8").catch(() => undefined);
    const ownerPid = current?.match(/^(\d+):/u)?.[1];
    const malformedAgeMs = ownerPid === undefined
      ? await stat(lockPath).then(({ mtimeMs }) => Date.now() - mtimeMs, () => 0)
      : 0;
    if (
      (ownerPid !== undefined && !processIsAlive(Number(ownerPid))) ||
      (ownerPid === undefined && malformedAgeMs > malformedStaleAfterMs)
    ) {
      await moveExactLockAside(lockPath, current ?? "", `stale-${randomUUID()}`);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`${options.label}: timed out after ${options.timeoutMs}ms`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
}

export async function acquireProcessFileLock(
  lockPath: string,
  options: ProcessFileLockOptions,
): Promise<() => Promise<void>> {
  const canonicalPath = resolve(lockPath);

  for (;;) {
    let pending = PROCESS_LOCKS.get(canonicalPath);
    if (pending === undefined) {
      pending = acquirePhysicalFileLock(canonicalPath, options).then((releasePhysical) => ({
        references: 0,
        releasePhysical,
      }));
      PROCESS_LOCKS.set(canonicalPath, pending);
    }

    let state: ProcessLockState;
    try {
      state = await pending;
    } catch (error) {
      if (PROCESS_LOCKS.get(canonicalPath) === pending) {
        PROCESS_LOCKS.delete(canonicalPath);
      }
      throw error;
    }

    if (state.closing !== undefined) {
      await state.closing;
      continue;
    }

    state.references += 1;
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      state.references -= 1;
      if (state.references > 0) return;
      if (state.references < 0) {
        throw new Error(`${options.label}: process file lock reference count underflow`);
      }
      const closing = state.releasePhysical().finally(() => {
        if (PROCESS_LOCKS.get(canonicalPath) === pending) {
          PROCESS_LOCKS.delete(canonicalPath);
        }
      });
      state.closing = closing;
      await closing;
    };
  }
}
