// owner: docs/engineering/testing/e2e/insight.md#view-lifecycle-cleanup
// rerun: pnpm e2e test --repo insight -- --run test/view-lifecycle.test.ts

import { only } from "@niceeval/testkit";
import { createServer, type Server } from "node:http";
import { expect, test } from "vitest";
import {
  assertPortReusable,
  decodeViewLifecycle,
  expectLoopbackReadyUrl,
  insightCaseArtifacts,
  insightE2E,
  waitForViewReady,
} from "./support.ts";

test.concurrent("view 只接受选项：帮助不宣传 Attempt locator，positionals 被拒绝而 plain view 正常启动", async () => {
  await insightE2E.case(
    "view-options-only-navigation",
    { artifacts: insightCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const help = await niceeval.run(["view", "--help"]);
      expect(help.exitCode, help.diagnostic()).toBe(0);
      expect(help.stdout).toContain("niceeval view [--run <run-id>...] [--no-open] [--port <port>] [--json]");
      expect(help.stdout).not.toContain("@<attempt-locator>");

      const produced = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(produced.exitCode, produced.diagnostic()).toBe(0);
      const attempt = only(
        produced.expEvalEvents(),
        (event) => event.evalId === "inspection",
        produced.diagnostic(),
      );
      const locator = attempt.locator.startsWith("@") ? attempt.locator : `@${attempt.locator}`;

      const positional = await niceeval.run(["view", locator, "--no-open", "--json"]);
      expect(positional.exitCode, positional.diagnostic()).toBe(1);
      expect(positional.stdout).toBe("");
      expect(positional.stderr).toContain("niceeval view does not accept positional arguments.");

      const view = niceeval.start([
        "view",
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });
      try {
        const ready = await waitForViewReady(view);
        expect(await fetch(expectLoopbackReadyUrl(ready.url).origin)).toMatchObject({ status: 200 });
      } finally {
        expect(view.signal("SIGTERM")).toBe(true);
        const closed = await view.done;
        expect(closed.timedOut, closed.diagnostic()).toBe(false);
        expect(decodeViewLifecycle(closed.stdout).at(-1)?.event).toBe("closed");
        await view.dispose();
      }
    },
  );
});

test.concurrent("view 启动失败只在 stderr 诊断，不留下 server 或半份 ready", async () => {
  await insightE2E.case(
    "view-startup-failure-cleanup",
    { artifacts: insightCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const produced = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(produced.exitCode, produced.diagnostic()).toBe(0);
      const runId = only(produced.expReceipt().createdRunIds, () => true, produced.diagnostic());
      const occupied = await occupyLoopbackPort();
      try {
        const failed = await niceeval.run([
          "view",
          "--run",
          runId,
          "--no-open",
          "--port",
          String(occupied.port),
          "--json",
        ]);
        expect(failed.exitCode, failed.diagnostic()).not.toBe(0);
        expect(failed.stderr.trim()).not.toBe("");
        expect(decodeViewLifecycle(failed.stdout).some((event) => event.event === "ready")).toBe(false);
      } finally {
        await closeServer(occupied.server);
      }
      await assertPortReusable(occupied.port);
    },
  );
});

registerControlledStop("SIGINT", "SIGINT 受控停止交付 closed，并回收 reader、server、session、watcher 与子进程");
registerControlledStop("SIGTERM", "SIGTERM 受控停止交付 closed，并回收 reader、server、session、watcher 与子进程");

function registerControlledStop(signal: "SIGINT" | "SIGTERM", title: string): void {
  test.concurrent(title, async () => {
    await insightE2E.case(
      `view-${signal.toLowerCase()}-cleanup`,
      { artifacts: insightCaseArtifacts() },
      async ({ paths: { projectRoot }, commands: { niceeval } }) => {
        const produced = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
        expect(produced.exitCode, produced.diagnostic()).toBe(0);
        const runId = only(produced.expReceipt().createdRunIds, () => true, produced.diagnostic());
        const view = niceeval.start([
          "view",
          "--run",
          runId,
          "--no-open",
          "--port",
          "0",
          "--json",
        ], { timeoutMs: 90_000 });

        const ready = await waitForViewReady(view);
        const readyUrl = expectLoopbackReadyUrl(ready.url);
        const health = await fetch(readyUrl.origin);
        expect(health.status).toBeLessThan(500);

        expect(view.signal(signal)).toBe(true);
        const closed = await view.done;
        expect(closed.timedOut, closed.diagnostic()).toBe(false);
        const lifecycle = decodeViewLifecycle(closed.stdout);
        expect(lifecycle.filter((event) => event.event === "ready")).toHaveLength(1);
        expect(lifecycle.filter((event) => event.event === "closed")).toHaveLength(1);
        expect(lifecycle.at(-1)?.event).toBe("closed");
        await view.dispose();

        await expect(fetch(readyUrl.origin)).rejects.toThrow();
        await assertPortReusable(Number(readyUrl.port));

        // A successful public read after process exit proves the long-lived
        // viewer no longer retains its Run reader/watcher.
        const runs = await niceeval.run(["run", "list", "--json"]);
        expect(runs.exitCode, runs.diagnostic()).toBe(0);
      },
    );
  });
}

async function occupyLoopbackPort(): Promise<{ readonly server: Server; readonly port: number }> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("occupied-port fixture did not expose a TCP port");
  }
  return { server, port: address.port };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((done, reject) => {
    server.close((error) => error === undefined ? done() : reject(error));
  });
}
