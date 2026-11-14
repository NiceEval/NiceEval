import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent.each(["verify-only", "install-failed", "recheck-missed"])("Agent 安装 %s 保留具名原因、阶段与身份", async (reason) => {
  await runnerE2E.case(`agent-install-${reason}`, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "diagnostic-fidelity", "--json"], { env: { NICEEVAL_DIAGNOSTIC_SCENARIO: reason } });
    expect(result.exitCode, result.diagnostic()).toBe(1);
    const locator = only(result.expEvalEvents(), () => true).locator;
    const trace = await niceeval.run(["query", "run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.trace", locator } })]);
    expect(trace.exitCode, trace.diagnostic()).toBe(0);
    const diagnostic = only(trace.attemptTrace().trace.diagnostics.items, item => item.kind === "execution-error");
    expect(diagnostic).toMatchObject({ code: `agent.install.${reason}`, phase: "agent.install" });
    expect(diagnostic.summary).toContain("diagnostic-fixture");
    expect(diagnostic.summary).toContain("1.2.3");
    expect(diagnostic.summary).toContain("revision-7");
    if (reason === "install-failed") {
      expect(diagnostic.summary).toContain("phase=install");
      expect(diagnostic.summary).not.toContain("phase=recheck");
    }
  });
});

// @feature docs/feature/sandbox/README.md
test.concurrent("Sandbox 实际平台不符保留具名类别与计划及实际平台", async () => {
  await runnerE2E.case("sandbox-target-diagnostic", async ({ commands: { niceeval }, paths }) => {
    const provider = join(paths.projectRoot, "agents/controlled-exclusive-sandbox.ts");
    await writeFile(provider, (await readFile(provider, "utf8")).replace('arch: process.arch === "arm64" ? "arm64" : "x64"', 'arch: process.arch === "arm64" ? "x64" : "arm64"'));
    const source = join(paths.projectRoot, "experiments/diagnostic-fidelity.ts");
    await writeFile(source, `import { controlledExclusiveSandbox } from "../agents/controlled-exclusive-sandbox.ts";\n${(await readFile(source, "utf8")).replace(/sandbox: dockerSandbox\([^\n]+\),/, "sandbox: controlledExclusiveSandbox,")}`);
    const result = await niceeval.run(["exp", "diagnostic-fidelity", "--json"], { env: { NICEEVAL_DIAGNOSTIC_SCENARIO: "target" } });
    expect(result.exitCode, result.diagnostic()).toBe(1);
    const locator = only(result.expEvalEvents(), () => true).locator;
    const trace = await niceeval.run(["query", "run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.trace", locator } })]);
    expect(trace.exitCode, trace.diagnostic()).toBe(0);
    expect(trace.attemptTrace().trace.diagnostics.items).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "sandbox-target-platform-mismatch", summary: expect.stringMatching(/Sandbox platform .* does not match planned target/),
    })]));
  });
});
