// cases: docs/engineering/testing/unit/eval.md
// 覆盖「隐藏输入登记与泄题门」里交叉检查与 BuildKey 过滤规则面。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNoHiddenInputLeaks,
  filterRulesForBuildKey,
  findHiddenInputLeaks,
  isIgnoredByDockerignore,
  listFilteredBuildContextFiles,
} from "./leak-gate.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-leak-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("dockerignore 求值", () => {
  it("默认全收;pattern 排除;! 例外;后写覆盖先写", () => {
    expect(isIgnoredByDockerignore("secret.txt", [])).toBe(false);
    expect(isIgnoredByDockerignore("secret.txt", ["secret.txt"])).toBe(true);
    expect(isIgnoredByDockerignore("secret.txt", ["secret.txt", "!secret.txt"])).toBe(false);
    expect(isIgnoredByDockerignore("secret.txt", ["*", "!Dockerfile"])).toBe(true);
    expect(isIgnoredByDockerignore("Dockerfile", ["*", "!Dockerfile"])).toBe(false);
  });

  it("目录规则排除子孙", () => {
    expect(isIgnoredByDockerignore("tests/a.py", ["tests/"])).toBe(true);
    expect(isIgnoredByDockerignore("tests", ["tests/"])).toBe(true);
    expect(isIgnoredByDockerignore("other/a.py", ["tests/"])).toBe(false);
  });
});

describe("泄题门 · build context", () => {
  it("verifier 仍在 context 闭包内时报泄漏", async () => {
    const root = await makeRoot();
    const contextDir = join(root, "ctx");
    await mkdir(contextDir, { recursive: true });
    const hidden = join(contextDir, "tests", "hidden.py");
    await mkdir(join(contextDir, "tests"), { recursive: true });
    await writeFile(hidden, "assert False\n", "utf-8");

    const findings = await findHiddenInputLeaks({
      hidden: [{ path: hidden, kind: "verifier" }],
      buildContexts: [{ contextDir, label: "client" }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.via).toBe("build-context");
    expect(findings[0]!.kind).toBe("verifier");
  });

  it("extraIgnoreRules 排除后不报;规则面进入 BuildKey 输入", async () => {
    const root = await makeRoot();
    const contextDir = join(root, "ctx");
    await mkdir(contextDir, { recursive: true });
    const hidden = join(contextDir, "secret.txt");
    await writeFile(hidden, "x\n", "utf-8");
    await writeFile(join(contextDir, "app.txt"), "ok\n", "utf-8");

    const spec = {
      contextDir,
      extraIgnoreRules: ["secret.txt"],
      label: "client",
    };
    await expect(
      assertNoHiddenInputLeaks({
        hidden: [{ path: hidden, kind: "private" }],
        buildContexts: [spec],
      }),
    ).resolves.toBeUndefined();

    const rules = await filterRulesForBuildKey(spec);
    expect(rules).toEqual(["secret.txt"]);
    const files = await listFilteredBuildContextFiles(spec);
    expect(files).toEqual(["app.txt"]);

    const { buildContextIdentityContribution, serializeContextFilterRules } = await import("./leak-gate.ts");
    const contrib = await buildContextIdentityContribution(spec);
    expect(contrib.contextFilterRules).toBe(serializeContextFilterRules(rules));
    expect(contrib.contextDigest).toHaveLength(64);

    const again = await buildContextIdentityContribution(spec);
    expect(again.contextDigest).toBe(contrib.contextDigest);
  });

  it("改 .dockerignore 在内容未变时仍改变规则面", async () => {
    const root = await makeRoot();
    const contextDir = join(root, "ctx");
    await mkdir(contextDir, { recursive: true });
    await writeFile(join(contextDir, "app.txt"), "ok\n", "utf-8");
    await writeFile(join(contextDir, ".dockerignore"), "secret.txt\n", "utf-8");

    const before = await filterRulesForBuildKey({ contextDir });
    await writeFile(join(contextDir, ".dockerignore"), "secret.txt\n*.pyc\n", "utf-8");
    const after = await filterRulesForBuildKey({ contextDir });
    expect(before).toEqual(["secret.txt"]);
    expect(after).toEqual(["secret.txt", "*.pyc"]);
    expect(after).not.toEqual(before);
  });
});

describe("泄题门 · bind mount", () => {
  it("private 任何阶段挂入都报", async () => {
    const root = await makeRoot();
    const privateFile = join(root, "reference", "solution.sh");
    await mkdir(join(root, "reference"), { recursive: true });
    await writeFile(privateFile, "#!/bin/sh\n", "utf-8");

    const findings = await findHiddenInputLeaks({
      hidden: [{ path: privateFile, kind: "private" }],
      buildContexts: [],
      bindMounts: [
        {
          source: join(root, "reference"),
          phase: "assertions",
          agentReachable: false,
          label: "reference-vol",
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.via).toBe("bind-mount");
    expect(findings[0]!.kind).toBe("private");
  });

  it("verifier 仅供断言求值且非 Agent 可达时放行;Agent 阶段可达时报", async () => {
    const root = await makeRoot();
    const verifier = join(root, "tests", "check.py");
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(verifier, "assert True\n", "utf-8");

    const assertionsOnly = await findHiddenInputLeaks({
      hidden: [{ path: verifier, kind: "verifier" }],
      buildContexts: [],
      bindMounts: [
        {
          source: join(root, "tests"),
          phase: "assertions",
          agentReachable: true,
          label: "tests",
        },
      ],
    });
    expect(assertionsOnly).toEqual([]);

    const agentPhase = await findHiddenInputLeaks({
      hidden: [{ path: verifier, kind: "verifier" }],
      buildContexts: [],
      bindMounts: [
        {
          source: join(root, "tests"),
          phase: "agent",
          agentReachable: true,
          label: "tests",
        },
      ],
    });
    expect(agentPhase).toHaveLength(1);
    expect(agentPhase[0]!.kind).toBe("verifier");
  });
});

describe("泄题门 · attachLeakGateHints 接线面", () => {
  it("getLeakGateHints 读回 attach 的 buildContexts，供 discover 同口径调用 assert", async () => {
    const { attachLeakGateHints, getLeakGateHints } = await import("./leak-gate.ts");
    const root = await makeRoot();
    const contextDir = join(root, "ctx");
    await mkdir(contextDir, { recursive: true });
    const secret = join(contextDir, "secret.txt");
    await writeFile(secret, "x\n", "utf-8");

    const source = attachLeakGateHints(
      { kind: "compose" },
      { buildContexts: [{ contextDir, label: "client" }] },
    );
    const hints = getLeakGateHints(source);
    expect(hints?.buildContexts).toHaveLength(1);

    await expect(
      assertNoHiddenInputLeaks({
        hidden: [{ path: secret, kind: "private" }],
        buildContexts: hints!.buildContexts,
        evalId: "task",
      }),
    ).rejects.toThrow(/Hidden input leak gate failed for eval task/);
  });
});
