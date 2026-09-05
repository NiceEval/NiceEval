import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type PluginLifecycleEvent = Readonly<Record<string, unknown>> & {
  readonly kind: string;
};

export function appendPluginLifecycleEvent(event: PluginLifecycleEvent): void {
  appendFileSync(join(process.cwd(), "plugin-lifecycle.ndjson"), `${JSON.stringify(event)}\n`, "utf8");
}

/** Each callback stays within its 30s allowance; their ordered chain exceeds it. */
export async function waitForPluginTeardown(signal: AbortSignal): Promise<void> {
  await delay(20_000, undefined, { signal });
}

export function startPluginLifecycleResource(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  child.unref();
  return child;
}

export async function stopPluginLifecycleResource(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const wait = (timeoutMs: number): Promise<boolean> => new Promise((resolve) => {
    const onClose = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolve(false);
    }, timeoutMs);
    child.once("close", onClose);
  });
  child.kill("SIGTERM");
  if (await wait(2_000)) return;
  child.kill("SIGKILL");
  if (!(await wait(2_000))) throw new Error("Eval Plugin managed resource survived SIGKILL.");
}
