import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("同一 Invocation 中不同结构化安装身份分别准备并共享各自的 staged payload", async () => {
  await runnerE2E.case("staged-identity-isolation", async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "staged-identities", "--json"]);
    expect(result.expEvalEvents(), result.diagnostic()).toEqual(expect.arrayContaining([
      expect.objectContaining({ experimentId: "staged-identities/a", verdict: "passed", attempts: 2, passed: 2 }),
      expect.objectContaining({ experimentId: "staged-identities/b", verdict: "passed", attempts: 2, passed: 2 }),
    ]));
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.stderr.match(/prepared staged identity A/g)).toHaveLength(1);
    expect(result.stderr.match(/prepared staged identity B/g)).toHaveLength(1);
  });
});
