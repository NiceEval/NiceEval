// feature: docs/feature/error-classification/library.md
import { resolve } from "node:path";
import { command, only, withHttpServer, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// Adapter 兼容性 Repo；exp/show 只是公开证据读回手段，不承担通用功能矩阵。
// NiceEval 根目录：pnpm e2e --repo adapter/local-protocol
// 已安装候选包的独立 local-protocol Repo 根：pnpm test

interface InvocationReceiptRecord {
  type: "receipt";
  receipt: {
    completion: "complete" | "incomplete" | "interrupted";
    record: { state: "complete" | "partial" | "not-recorded" };
  };
}

type InvocationMachineRecord =
  | { type: "snapshot" | "observation" | "claim" | "heartbeat" }
  | InvocationReceiptRecord;

interface HistoryAttempt {
  locator: string;
  verdict: string;
}

interface HistorySection {
  experimentId: string;
  evalId: string;
  attempts: HistoryAttempt[];
}

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: { sections: HistorySection[] };
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-local-backend-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

function invocationReceipt(records: readonly InvocationMachineRecord[], diagnostic: string): InvocationReceiptRecord {
  const receipts = records.filter((record): record is InvocationReceiptRecord => record.type === "receipt");
  return only(receipts, () => true, diagnostic);
}

// 本地 backend 的 5xx 是 Repo 自己的 fixture：它只证明 NiceEval 经真实 adapter
// 边界（uiMessageStreamAgent → HTTP）传输并分类错误，不冒充 live 兼容性
// （89ba8e64 把伪 E2E 与真实边界分开的裁决）。
test("本地 backend 返回 5xx 时 Attempt 形成 errored Verdict Claim，公开读回同样可见", async () => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    await withHttpServer(
      async () => new Response("provider exploded", { status: 502 }),
      async (backend) => {
        const run = await niceeval.run(["exp", "local", "--rerun", "all", "--json"], {
          cwd: root,
          env: { LOCAL_BACKEND_URL: backend.url },
        });
        expect(run.exitCode, run.diagnostic()).toBe(1);

        expect(invocationReceipt(run.ndjson<InvocationMachineRecord>(), run.diagnostic())).toMatchObject({
          type: "receipt",
          receipt: { completion: "complete", record: { state: "complete" } },
        });

        // 公开读回：errored 同样落进 history，verdict 可被 show 读到（不读 .niceeval）。
        const history = await niceeval.run(["show", "local/roundtrip", "--history", "--json"], { cwd: root });
        expect(history.exitCode, history.diagnostic()).toBe(0);
        const historyDocument = history.json<HistoryDocument>();
        const section = only(
          historyDocument.data.sections,
          (item) => item.evalId === "local/roundtrip",
          history.diagnostic(),
        );
        // 这个私有项目副本只有本次执行；读取的 Verdict Claim 来自同一份固定 Record 事实。
        const latest = only(section.attempts, () => true, history.diagnostic());
        expect(latest.verdict).toBe("errored");
        expect(latest.locator).toMatch(/^@[0-9A-HJKMNP-TV-Z]{26}$/);
      },
    );
  });
});
