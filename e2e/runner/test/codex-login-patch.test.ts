import { command, only, withProjectCopy } from "@niceeval/testkit";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// @feature docs/feature/adapters/README.md
// @issue docs/issues/codex-login-patch.md
test.concurrent("Codex 准备完成后，非 root 用户在登录 shell 中使用原生 apply_patch", async () => {
  await withProjectCopy({ from: process.cwd(), prefix: "niceeval-codex-login-patch-", omitTopLevel: [".niceeval", "node_modules", "test"], links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }] }, async ({ root }) => {
    const result = await command([resolve("node_modules/.bin/niceeval")]).run(["exp", "codex-login-patch", "--rerun", "all", "--json"], { cwd: root, timeoutMs: 240_000 });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(only(result.expEvalEvents(), () => true, result.diagnostic())).toMatchObject({ evalId: "codex-login-patch", verdict: "passed" });
    expect(result.expReceipt().completion).toBe("completed");
  });
});
