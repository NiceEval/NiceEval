import { command, only, withHttpServer } from "@niceeval/testkit";
import { expect, test } from "vitest";

// Adapter 兼容性 Repo；exp/show 只是公开证据读回手段，不承担通用功能矩阵。
// NiceEval 根目录：pnpm e2e --repo adapter/local-protocol
// 已安装候选包的独立 local-protocol Repo 根：pnpm test
// feature: docs/feature/error-classification/library.md

interface ErrorEvent {
  event: "error";
  locator: string;
  evalId: string;
  experimentId: string;
  phase: string;
  reason: string;
}

interface ExpEvent {
  event: string;
  status?: string;
}

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

// 本地 backend 的 5xx 是 Repo 自己的 fixture：它只证明 NiceEval 经真实 adapter
// 边界（uiMessageStreamAgent → HTTP）传输并分类错误，不冒充 live 兼容性
// （89ba8e64 把伪 E2E 与真实边界分开的裁决）。
test("本地 backend 返回 5xx 时实验 errored 且错误带阶段与原因，公开读回同样可见", async () => {
  await withHttpServer(
    async () => new Response("provider exploded", { status: 502 }),
    async (backend) => {
      const run = await niceeval.run(["exp", "local", "--rerun", "all", "--json"], {
        env: { LOCAL_BACKEND_URL: backend.url },
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);

      const events = run.ndjson<ExpEvent>();
      const errorEvents = events.filter((item): item is ErrorEvent & ExpEvent =>
        item.event === "error" &&
        typeof (item as ErrorEvent).phase === "string" &&
        typeof (item as ErrorEvent).reason === "string",
      );
      const errored = only(errorEvents, (item) => item.evalId === "local/roundtrip", run.diagnostic());
      // 阶段归因：agent 传输失败在顶层 eval.run 阶段收束（send 在飞时的嵌套 agent.run
      // 归因只在超时/scope 路径使用，见 runner 的 LifecyclePhase 注释）。
      expect(errored.phase).toBe("eval.run");
      expect(errored.reason).toContain("502");
      expect(events.at(-1)).toMatchObject({ event: "result", status: "failed" });

      // 公开读回：errored 同样落进 history，verdict 可被 show 读到（不读 .niceeval）。
      const history = await niceeval.run(["show", "local/roundtrip", "--history", "--json"]);
      expect(history.exitCode, history.diagnostic()).toBe(0);
      const historyDocument = history.json<HistoryDocument>();
      const section = only(
        historyDocument.data.sections,
        (item) => item.evalId === "local/roundtrip",
        history.diagnostic(),
      );
      // 最新一条 attempt 就是本次运行产出的那条：verdict 与 locator 都与 exp 事件流同源。
      const latest = section.attempts.at(-1);
      expect(latest?.verdict).toBe("errored");
      expect(latest?.locator).toBe(errored.locator);
    },
  );
});
