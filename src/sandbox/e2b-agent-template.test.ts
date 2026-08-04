// cases: docs/engineering/testing/unit/sandbox.md
import { Template } from "e2b";
import { describe, expect, it } from "vitest";
import {
  BUB_INSTALL_MARKER,
  DEFAULT_BUB_OTEL_PLUGIN,
  DEFAULT_BUB_REQUIREMENT,
} from "../agents/bub-install-spec.ts";
import {
  E2B_NODE_TOOL_PREFIX,
  E2B_OFFICIAL_AGENT_TEMPLATES,
  NICEEVAL_E2B_TEMPLATE_NAME,
  e2bCodingAgentTemplate,
  verifyE2BNodeToolContract,
} from "./e2b-agent-template.ts";

/** Template.toJSON() 的 RUN 步骤是 `{ type, args: [command, user] }`。 */
async function runSteps(template: Parameters<typeof Template.toJSON>[0]) {
  const json = JSON.parse(await Template.toJSON(template)) as {
    steps: { type: string; args: string[] }[];
  };
  return json.steps
    .filter((step) => step.type === "RUN")
    .map((step) => ({ command: step.args[0]!, user: step.args[1] }));
}

describe("e2bCodingAgentTemplate", () => {
  it.each([
    ["claude-code", "claude"],
    ["codex", "codex"],
  ] as const)("extends the E2B official %s template", async (agent, base) => {
    const json = JSON.parse(await Template.toJSON(e2bCodingAgentTemplate(agent)));
    expect(json.fromTemplate).toBe(base);
    expect(E2B_OFFICIAL_AGENT_TEMPLATES[agent]).toBe(base);
    expect(NICEEVAL_E2B_TEMPLATE_NAME[agent]).toContain(`/niceeval-${agent}`);
    expect(JSON.stringify(json)).toContain(
      agent === "claude-code" ? "claude.ai/install.sh" : "npm install -g",
    );
  });

  it.each(["claude-code", "codex", "bub"] as const)(
    "normalizes the run user's npm global prefix on the %s baseline",
    async (agent) => {
      const steps = await runSteps(e2bCodingAgentTemplate(agent));
      const bin = `${E2B_NODE_TOOL_PREFIX}/bin`;
      const modules = `${E2B_NODE_TOOL_PREFIX}/lib/node_modules`;

      // 目录准备必须由 root 做:官方 claude 起点的 /usr/local 归 root,运行用户改不了属主。
      const prepare = steps.find((step) => step.command.includes("chown"));
      expect(prepare?.user).toBe("root");
      expect(prepare?.command).toContain(bin);
      expect(prepare?.command).toContain(modules);

      // prefix 写在运行用户自己的 npmrc 里:user config 优先级最高,且不依赖登录 shell。
      const prefix = steps.find((step) => step.command.startsWith("npm config set prefix"));
      expect(prefix?.user).toBe("user");
      expect(prefix?.command).toBe(`npm config set prefix ${E2B_NODE_TOOL_PREFIX}`);

      // Agent 安装步骤仍是各自那套,横切层不接管它们。
      expect(steps.indexOf(prepare!)).toBeLessThan(steps.length - 1);
      expect(steps.indexOf(prepare!)).toBeLessThan(steps.indexOf(prefix!));

      // 跨 provider 基线工具面:官方起点若带 yarn 实体就移除(root,可能装在系统目录),
      // 并断言 python3 存在(运行用户,只 fail fast 不安装)。两步都在 prefix 之后、
      // Agent 自己的安装步骤之前。
      const yarnRemoval = steps.find((step) => step.command.includes("yarnpkg"));
      expect(yarnRemoval?.user).toBe("root");
      expect(yarnRemoval?.command).toContain("command -v");
      expect(steps.indexOf(prefix!)).toBeLessThan(steps.indexOf(yarnRemoval!));

      const python3Assert = steps.find((step) => step.command.includes("python3"));
      expect(python3Assert?.user).toBe("user");
      expect(python3Assert?.command).toContain("exit 1");
      expect(steps.indexOf(yarnRemoval!)).toBeLessThan(steps.indexOf(python3Assert!));
      expect(steps.indexOf(python3Assert!)).toBeLessThan(steps.length - 1);
    },
  );

  it("asserts prefix, PATH, writability and the baseline tool surface as the run user before a build publishes", async () => {
    const steps = await runSteps(verifyE2BNodeToolContract(e2bCodingAgentTemplate("claude-code")));
    const check = steps.at(-1)!;

    expect(check.user).toBe("user");
    expect(check.command).toContain("npm config get prefix");
    expect(check.command).toContain("$PATH");
    expect(check.command).toContain(`test -w ${E2B_NODE_TOOL_PREFIX}/bin`);
    expect(check.command).toContain(`test -w ${E2B_NODE_TOOL_PREFIX}/lib/node_modules`);
    // 跨 provider 基线工具面收在同一份最终自检里:不存在 yarn、python3 可用。
    expect(check.command).toContain("command -v yarn");
    expect(check.command).toContain("command -v python3");
    // 漂移必须让 build 失败,不能只打印一行警告。
    expect(check.command).toContain("exit 1");
  });

  it("builds Bub from the pinned NiceEval recipe and writes its marker", async () => {
    const json = await Template.toJSON(e2bCodingAgentTemplate("bub", {
      bubPythonPackages: ["bub-plugin-memory==1.3.0"],
    }));
    // pin 的单源在 bub-install-spec.ts;这里只证明 spec → 模板 recipe 的传播,不复刻 pin 值。
    // requirement 必须经 override 文件落进 recipe:少了它,构建会拉 Bub 主干而不是钉死的版本。
    expect(json).toContain(DEFAULT_BUB_REQUIREMENT);
    expect(json).toContain("--overrides");
    expect(json).toContain(DEFAULT_BUB_OTEL_PLUGIN.split("@").at(-1)!.split("#")[0]!);
    expect(json).toContain(BUB_INSTALL_MARKER.split("/").at(-1)!);
    expect(json).toContain("bub-plugin-memory==1.3.0");
  });
});
