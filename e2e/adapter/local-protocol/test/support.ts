import { createServer } from "node:http";
import { join, resolve } from "node:path";
import {
  assertExpEvalOutcomes,
  createE2EContext,
  waitForOutput,
} from "@niceeval/testkit";
import { expect } from "vitest";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";

type OwnerKind = "transport" | "approval" | "disconnect" | "timeout" | "http-error";

interface FixtureReady {
  baseUrl: string;
  port: number;
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

/** 每个 kind 的 (experiment, eval) 身份与期望终局；五个 owner 文件各取一行。 */
const KIND_EXPECTATIONS: Readonly<Record<OwnerKind, { evalId: string; verdict: "passed" | "errored" }>> = {
  transport: { evalId: "transport-ok", verdict: "passed" },
  approval: { evalId: "approval-lifecycle", verdict: "passed" },
  disconnect: { evalId: "disconnect", verdict: "errored" },
  timeout: { evalId: "timeout", verdict: "errored" },
  "http-error": { evalId: "http-error", verdict: "errored" },
};

const e2e = createE2EContext({
  repoId: "local-protocol",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-local-protocol-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "junit", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

/** Mechanical isolation/readback shared by five single-outcome owner files. */
export async function proveLocalProtocolOwner(kind: OwnerKind): Promise<void> {
  await e2e.case(
    kind,
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, start }) => {
      const server = start(["pnpm", "exec", "tsx", "src/fixture/server.ts"], {
        timeoutMs: 90_000,
      });
      let ready: FixtureReady | undefined;
      try {
        const output = await waitForOutput(server, "stdout", /NICEEVAL_E2E_READY \{[^\n]+\}/, {
          timeoutMs: 15_000,
          label: `${kind} fixture readiness`,
        });
        ready = parseReady(output);
        const health = await fetch(`${ready.baseUrl}/healthz`);
        expect(health.status).toBe(200);

        const receipt = await niceeval.run(
          ["exp", kind, "--rerun", "all", "--json"],
          {
            env: { [FIXTURE_BASE_URL_ENV]: ready.baseUrl },
            timeoutMs: kind === "timeout" ? 30_000 : 60_000,
          },
        );
        // receipt 只承载 Invocation 级完成事实(见 docs/feature/experiments/cli.md「结束反馈与
        // receipt」)：completion 与 runIds。pass/fail 由下面带身份的 eval 事件精确断言，不从
        // receipt 猜成败，也不在 receipt 上断言计数。
        const inv = receipt.expReceipt();
        expect(inv.completion, receipt.diagnostic()).toBe("completed");
        expect(inv.runIds, receipt.diagnostic()).toHaveLength(1);
        // 每个 kind 恰好一个 Experiment / 一个 Eval；eval 事件是中间的身份事件，严格断言
        // evalId / experimentId / verdict / attempts——成功与故障的确定性路径都由此判定。
        const { evalId, verdict } = KIND_EXPECTATIONS[kind];
        const evalEvents = assertExpEvalOutcomes(
          receipt.expEvalEvents(),
          [{ evalId, experimentId: kind, verdict, attempts: 1 }],
          () => receipt.diagnostic(),
        );
        const evalEvent = evalEvents[0]!;
        if (verdict === "passed") {
          expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
        } else {
          // 故障路径的公开失败结果：非零退出 + 归属于本 Eval 的 errored 结论行
          // (旧的 error 事件与 result 事件一同退役，见 .agents/friction-log 里
          // show 执行证据的已知产品缺口)。
          expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
        }
        // receipt 的 runId 驱动公开读回(adapter/README.md「Live 验收说明」第 3 步)：
        // 运行已发布为完整 Run——成功与受控 errored 都随 Run 发布(record/cli.md「exp 与
        // dry run」)且 Member 可读，slot 状态为 included。
        const shown = await niceeval.run(["show", "--run", inv.runIds[0]!, "--json"]);
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        const selection = shown
          .json<{ sample: { selection: { runIds: readonly string[] } } }>()
          .sample.selection;
        expect(selection.runIds, shown.diagnostic()).toEqual([inv.runIds[0]!]);
        expect(shown.stdout, shown.diagnostic()).toContain('"included"');

        // tracing 缺席不代表 runner 阶段也丢失了 timing：已落盘的阶段树仍
        // 必须可从公开 timing 页面读出 Eval 与首轮 Turn。此 direct Agent 没有
        // 声明 setup，runner 不应凭空补一个 agent.setup 阶段。
        const timing = await niceeval.run(
          ["show", evalEvent!.locator, "--timing"],
        );
        expect(timing.exitCode, timing.diagnostic()).toBe(0);
        expect(timing.stdout, timing.diagnostic()).toContain("eval.run");
        expect(timing.stdout, timing.diagnostic()).toMatch(/turn\s+turn1\b/);
      } finally {
        // 端口复用检查必须在 fixture 进程真正结束后执行；这里先显式回收，
        // case 结束时 ctx 还会兜底再回收一次(dispose 幂等)。
        if (ready !== undefined) {
          await server.dispose();
          await assertPortReusable(ready.port);
        }
      }
    },
  );
}
