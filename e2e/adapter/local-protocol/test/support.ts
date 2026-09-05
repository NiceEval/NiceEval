import { createServer } from "node:http";
import { join } from "node:path";
import { startProcess, waitForOutput } from "@niceeval/testkit";

interface FixtureReady {
  readonly baseUrl: string;
  readonly port: number;
}

export type LocalProtocolFixtureMode =
  | "ok"
  | "approval"
  | "disconnect"
  | "done-then-late"
  | "error-only"
  | "hang"
  | "live-progress"
  | "error";

interface LocalProtocolFixture extends FixtureReady {
  readonly waitForRequest: (mode: LocalProtocolFixtureMode) => Promise<void>;
  readonly waitForHangClosed: () => Promise<void>;
}

export interface LocalProtocolFixtureOptions {
  readonly errorText?: string;
}

function parseReady(output: string): FixtureReady {
  const line = output.split("\n").find((candidate) => candidate.startsWith("NICEEVAL_E2E_READY "));
  if (line === undefined) {
    throw new Error(`fixture readiness receipt missing from ${JSON.stringify(output)}`);
  }
  const value = JSON.parse(line.slice("NICEEVAL_E2E_READY ".length)) as Partial<FixtureReady>;
  if (typeof value.baseUrl !== "string" || !Number.isInteger(value.port)) {
    throw new Error(`fixture readiness receipt is malformed: ${line}`);
  }
  return { baseUrl: value.baseUrl, port: value.port };
}

async function assertPortReusable(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        const probe = createServer();
        probe.once("error", rejectListen);
        probe.listen(port, "127.0.0.1", () => {
          probe.close((error) => error === undefined ? resolveListen() : rejectListen(error));
        });
      });
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`fixture port ${port} could not be rebound after cleanup`, { cause: error });
      }
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
}

/** Owns only the local server's readiness, lifetime, and dynamic-port cleanup. */
export async function withLocalProtocolFixture<T>(
  cwd: string,
  body: (fixture: LocalProtocolFixture) => Promise<T>,
  options: LocalProtocolFixtureOptions = {},
): Promise<T> {
  const fixtureArgv = ["pnpm", "exec", "tsx", join("src", "fixture", "server.ts")];
  if (options.errorText !== undefined) fixtureArgv.push("--error-text", options.errorText);
  const server = startProcess(
    fixtureArgv,
    { cwd, processGroup: true, timeoutMs: 90_000 },
  );
  let ready: FixtureReady | undefined;
  let bodyError: unknown;
  try {
    const output = await waitForOutput(server, "stdout", /NICEEVAL_E2E_READY \{[^\n]+\}/, {
      timeoutMs: 15_000,
      label: "local-protocol fixture readiness",
    });
    ready = parseReady(output);
    const health = await fetch(`${ready.baseUrl}/healthz`);
    if (health.status !== 200) {
      throw new Error(`local-protocol fixture health check returned ${health.status}`);
    }
    return await body({
      ...ready,
      waitForRequest: async (mode) => {
        await waitForOutput(
          server,
          "stdout",
          new RegExp(`NICEEVAL_E2E_REQUEST \\{[^\\n]*"mode":"${mode}"[^\\n]*\\}`),
          { timeoutMs: 5_000, label: `local-protocol ${mode} request` },
        );
      },
      waitForHangClosed: async () => {
        await waitForOutput(
          server,
          "stdout",
          /NICEEVAL_E2E_HANG_CLOSED/,
          { timeoutMs: 5_000, label: "local-protocol hanging response to close" },
        );
      },
    });
  } catch (error) {
    bodyError = error;
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
      await server.dispose();
      if (ready !== undefined) {
        await assertPortReusable(ready.port);
      }
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError !== undefined) {
      if (bodyError !== undefined) {
        const aggregate = new AggregateError(
          [bodyError, cleanupError],
          "local-protocol fixture body and cleanup both failed",
        );
        aggregate.cause = bodyError;
        throw aggregate;
      }
      throw cleanupError;
    }
  }
}
