import { only, pollUntil } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { decodeSessionListDocument, decodeSessionShowDocument } from "niceeval/experiment/host";

// @feature docs/feature/adapters/README.md
test.concurrent("install 就地修复后复检，成功时不准备或上传 staged payload", async () => {
  await runnerE2E.case("install-repair", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "install-repair", "--rerun", "all", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(only(result.expEvalEvents(), () => true)).toMatchObject({ evalId: "install-repair", verdict: "passed" });
    expect(result.expReceipt().completion).toBe("completed");
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("invocation show 显示清洗并按 Unicode 截断的探测原因与修复失败原因", async () => {
  await runnerE2E.case("install-repair-detail", {}, async ({ commands: { niceeval }, paths }) => {
    const source = join(paths.projectRoot, "experiments/install-repair.ts");
    await writeFile(source, (await readFile(source, "utf8")).replace('const scenario: string = "repaired"', 'const scenario: string = "repair-detail"'));
    const running = niceeval.start(["exp", "install-repair", "--rerun", "all", "--json"], { timeoutMs: 120_000 });
    try {
      await Promise.race([
        pollUntil(async () => existsSync(join(paths.projectRoot, "ensure-install-entered")) ? true : undefined, { timeoutMs: 45_000, intervalMs: 50, label: "installer ready for inspection" }),
        running.done.then(result => { throw new Error(result.diagnostic()); }),
      ]);
      const list = await niceeval.run(["invocation", "list", "--json"]);
      expect(list.exitCode, list.diagnostic()).toBe(0);
      const invocation = only(decodeSessionListDocument(list.json()).sessions, () => true);
      const detail = await pollUntil(async () => {
        const shown = await niceeval.run(["invocation", "show", invocation.sessionId, "--json"]);
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        const { session } = decodeSessionShowDocument(shown.json());
        if (!("experiments" in session)) throw new Error("active invocation missing");
        const text = session.experiments.flatMap(item => item.activeAttempts ?? []).find(item => item.phase === "agent.install")?.detail?.text;
        return text?.startsWith("probe miss:") ? text : undefined;
      }, { timeoutMs: 10_000, intervalMs: 50, label: "ensure detail is visible" });
      expect(detail).toBe(`probe miss: missing ${"x".repeat(191)}😀; repair failed: fixture repair failed`);
    } finally { await writeFile(join(paths.projectRoot, "ensure-install-release"), "release"); }
    const result = await running.done;
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(only(result.expEvalEvents(), () => true)).toMatchObject({ verdict: "passed" });
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent.each(["repair-throws", "repair-misses"])("install 的 %s 保留安装回退路径", async (scenario) => {
  await runnerE2E.case(scenario, {}, async ({ commands: { niceeval }, paths }) => {
    const source = join(paths.projectRoot, "experiments/install-repair.ts");
    await writeFile(source, (await readFile(source, "utf8")).replace('const scenario: string = "repaired"', `const scenario: string = "${scenario}"`));
    const result = await niceeval.run(["exp", "install-repair", "--rerun", "all", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.stderr).toContain("install-repair-callback-entered");
    expect(only(result.expEvalEvents(), () => true)).toMatchObject({ verdict: "passed" });
  });
});

// @feature docs/feature/adapters/README.md
test.concurrent("verify-only 的 install 不执行 repair", async () => {
  await runnerE2E.case("ensure-verify-only", {}, async ({ commands: { niceeval }, paths }) => {
    const source = join(paths.projectRoot, "experiments/install-repair.ts");
    await writeFile(source, (await readFile(source, "utf8")).replace('const scenario: string = "repaired"', 'const scenario: string = "verify-only"'));
    const result = await niceeval.run(["exp", "install-repair", "--rerun", "all", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(1);
    expect(result.stderr).not.toContain("install-repair-callback-entered");
    expect(only(result.expEvalEvents(), () => true)).toMatchObject({ verdict: "errored" });
  });
});
