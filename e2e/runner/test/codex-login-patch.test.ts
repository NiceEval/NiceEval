import { command, only, withProjectCopy } from "@niceeval/testkit";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
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

// @feature docs/feature/adapters/README.md
// @issue docs/issues/codex-ensure-reuploads-when-only-link-missing.md
test.concurrent("npm 预装的锁定 Codex 只修复 apply_patch，重复 ensure 不上传发行包", async () => {
  const docker = command(["docker"]);
  const image = `niceeval-e2e-codex-repair:${randomUUID()}`;
  const built = await docker.run(["build", "-t", image, "fixtures/codex-npm"], { timeoutMs: 240_000 });
  expect(built.exitCode, built.diagnostic()).toBe(0);
  try {
    await withProjectCopy({ from: process.cwd(), prefix: "niceeval-codex-npm-repair-", omitTopLevel: [".niceeval", "node_modules", "test"], links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }] }, async ({ root }) => {
      await writeFile(resolve(root, "experiments/codex-login-patch.ts"), `
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { dockerSandbox } from "niceeval/sandbox";
const adapter = codexAgent({ apiKey: "unused-no-model-call" });
if (adapter.kind !== "sandbox") throw new Error("expected Sandbox Agent");
export default defineExperiment({
  adapter: { ...adapter, installers: adapter.installers.map(installer => ({ ...installer,
    prepareArtifact() { throw new Error("REGRESSION: preinstalled Codex must not prepare or upload a payload"); },
  })) },
  sandbox: dockerSandbox({ source: { type: "image", image: ${JSON.stringify(image)} }, user: "node" }),
  evals: ["codex-login-patch"],
});
`);
      const result = await command([resolve("node_modules/.bin/niceeval")]).run(["exp", "codex-login-patch", "--rerun", "all", "--json"], { cwd: root, timeoutMs: 120_000 });
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(only(result.expEvalEvents(), () => true, result.diagnostic())).toMatchObject({ evalId: "codex-login-patch", verdict: "passed" });
      expect(result.expReceipt().completion).toBe("completed");
    });
  } finally {
    const removed = await docker.run(["image", "rm", image]);
    expect(removed.exitCode, removed.diagnostic()).toBe(0);
  }
});
