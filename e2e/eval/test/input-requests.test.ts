import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/eval/README.md
test.concurrent("每轮输入请求按事件顺序深冻结投影且能逐一响应", async () => {
  await evalE2E.case("input-requests", async ({ commands: { niceeval, tsc } }) => {
    const run = await niceeval.run(["exp", "input-requests", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(only(run.expEvalEvents(), event => event.evalId === "input-requests", run.diagnostic()).verdict).toBe("passed");
    const types = await tsc.run(["--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--target", "ES2022", "--allowImportingTsExtensions", "evals/input-requests.eval.ts", "agents/input-requests.ts", "experiments/input-requests.ts"]);
    expect(types.exitCode, types.diagnostic()).toBe(0);
  });
});
