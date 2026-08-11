import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import {
  command,
  type ExpEvalEvent,
  type ExpEvent,
  type ExpResultEvent,
  type ProcessReceipt,
  waitForOutput,
  withProcess,
  withProjectCopy,
} from "@niceeval/testkit";
import { expect } from "vitest";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";

type OwnerKind = "transport" | "approval" | "disconnect" | "timeout" | "http-error";

interface FixtureReady {
  baseUrl: string;
  port: number;
}

function expectCliShape(receipt: ProcessReceipt): ExpEvent[] {
  return receipt.ndjson<ExpEvent>();
}

function parseReady(output: string): FixtureReady {
  const line = output.split("\n").find((candidate) => candidate.startsWith("NICEEVAL_E2E_READY "));
  if (line === undefined) throw new Error(`fixture readiness receipt missing from ${JSON.stringify(output)}`);
  const value = JSON.parse(line.slice("NICEEVAL_E2E_READY ".length)) as Partial<FixtureReady>;
  if (typeof value.baseUrl !== "string" || !Number.isInteger(value.port)) {
    throw new Error(`fixture readiness receipt is malformed: ${line}`);
  }
  return value as FixtureReady;
}

async function assertPortReusable(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        const probe = createServer();
        probe.once("error", rejectListen);
        probe.listen(port, "127.0.0.1", () => probe.close((error) => error ? rejectListen(error) : resolveListen()));
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

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new Error(`unsafe artifact segment: ${value}`);
  return value;
}

function artifactInvocationId(): string {
  const value = process.env.NICEEVAL_E2E_INVOCATION_ID ?? `local-${process.pid}-${randomUUID()}`;
  return safeSegment(value);
}

function expectFault(events: readonly ExpEvent[], kind: OwnerKind): void {
  const error = events.find((event) => event.event === "error");
  expect(error).toMatchObject({ event: "error", evalId: kind, experimentId: kind });
  expect(["eval.run", "agent.run"]).toContain(error?.phase);
  if (kind === "disconnect") expect(error?.reason).toMatch(/closed|connect|stream|failed|abort|partial/i);
  if (kind === "timeout") expect(error?.reason).toMatch(/timed out|timeout/i);
  if (kind === "http-error") expect(error?.reason).toMatch(/500|failed|POST/i);
}

/** Mechanical isolation/readback shared by five single-outcome owner files. */
export async function proveLocalProtocolOwner(kind: OwnerKind): Promise<void> {
  const invocationId = artifactInvocationId();
  await withProjectCopy(
    {
      from: process.cwd(),
      prefix: `niceeval-local-protocol-${kind}-`,
      omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
      links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
    },
    async ({ root }) => {
      let ready: FixtureReady | undefined;
      let runError: unknown;
      try {
        await withProcess(
          ["pnpm", "exec", "tsx", "src/fixture/server.ts"],
          { cwd: root, timeoutMs: 90_000, processGroup: true },
          async (server) => {
            const output = await waitForOutput(server, "stdout", /NICEEVAL_E2E_READY \{[^\n]+\}/, {
              timeoutMs: 15_000,
              label: `${kind} fixture readiness`,
            });
            ready = parseReady(output);
            const health = await fetch(`${ready.baseUrl}/healthz`);
            expect(health.status).toBe(200);

            const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
            const receipt = await niceeval.run(
              ["exp", kind, "--rerun", "all", "--json"],
              {
                cwd: root,
                env: { [FIXTURE_BASE_URL_ENV]: ready.baseUrl },
                timeoutMs: kind === "timeout" ? 30_000 : 60_000,
              },
            );
            const events = expectCliShape(receipt);
            const result: ExpResultEvent = receipt.expResult();
            if (kind === "transport" || kind === "approval") {
              expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
              expect(result).toMatchObject({
                event: "result",
                status: "passed",
                passed: 1,
                failed: 0,
                errored: 0,
                completion: "complete",
              });
              const evalId = kind === "transport" ? "transport-ok" : "approval-lifecycle";
              const evalEvent = events.find(
                (event): event is ExpEvalEvent => event.event === "eval" && event.evalId === evalId,
              );
              expect(evalEvent, receipt.diagnostic()).toBeDefined();
              const execution = await niceeval.run(["show", evalEvent!.locator, "--execution"], { cwd: root });
              expect(execution.exitCode, execution.diagnostic()).toBe(0);
              if (kind === "transport") expect(execution.stdout).toContain("local-protocol-ok");
              else {
                expect(execution.stdout).toContain("calculate");
                expect(execution.stdout).toContain("local-approval-output");
                expect(execution.stdout).toContain("rejected");
              }
            } else {
              expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
              expect(result).toMatchObject({
                event: "result",
                status: "failed",
                passed: 0,
                failed: 0,
                errored: 1,
                completion: "complete",
              });
              expectFault(events, kind);
            }
          },
        );
      } catch (error) {
        runError = error;
      }
      if (ready !== undefined) await assertPortReusable(ready.port);
      if (runError !== undefined) throw runError;
    },
    {
      stageArtifacts: {
        destinationRoot: process.cwd(),
        entries: [
          { source: ".niceeval", target: join(".niceeval", "e2e-artifacts", invocationId, kind), optional: true },
        ],
        collision: "error",
      },
    },
  );
}
