import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/experiments/README.md
test.concurrent("升级 Agent 安装版本产生普通身份 gap，并显示 Agent 与新旧版本", async () => {
  await runnerE2E.case("agent-install-identity", {}, async ({ commands: { niceeval }, paths }) => {
    const baseline = await niceeval.run(["exp", "agent-install-identity", "--json"]);
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    const source = join(paths.projectRoot, "experiments", "agent-install-identity.ts");
    await writeFile(
      source,
      (await readFile(source, "utf8")).replace('const version = "0.144.1"', 'const version = "0.167.2"'),
    );
    const dry = await niceeval.run(["exp", "agent-install-identity", "--dry", "--json"]);
    expect(dry.exitCode, dry.diagnostic()).toBe(0);
    const plan = decodeExpPlanDocument(dry.json());
    expect(plan.reused).toBe(0);
    expect(plan.matrix[0]!.slots).toMatchObject([{ state: "gap", reason: "identity-mismatch" }]);
    expect(dry.stdout).toContain("config:agentInstalls");
    expect(dry.stdout).not.toContain("identity-domain-unregistered");
    expect(dry.stdout).not.toContain("unversioned-identity-change");
    const human = await niceeval.run(["exp", "agent-install-identity", "--dry"]);
    expect(human.exitCode, human.diagnostic()).toBe(0);
    expect(human.stdout).toContain("codex 0.144.1");
    expect(human.stdout).toContain("codex 0.167.2");
  });
});
