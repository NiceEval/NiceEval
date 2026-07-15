import { Template } from "e2b";
import { describe, expect, it } from "vitest";
import {
  E2B_OFFICIAL_AGENT_TEMPLATES,
  NICEEVAL_BUB_E2B_TEMPLATE,
  NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE,
  NICEEVAL_CODEX_E2B_TEMPLATE,
  e2bCodingAgentTemplate,
} from "./e2b-agent-template.ts";

const publicTemplates = {
  "claude-code": NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE,
  codex: NICEEVAL_CODEX_E2B_TEMPLATE,
  bub: NICEEVAL_BUB_E2B_TEMPLATE,
} as const;

describe("e2bCodingAgentTemplate", () => {
  it("exports complete public refs pinned to one verified release", () => {
    const releases = Object.values(publicTemplates).map((template) => template.split(":").at(-1));

    expect(new Set(releases).size).toBe(1);
    for (const template of Object.values(publicTemplates)) {
      expect(template).toMatch(/^correctroads-default-team\/.+:v\d+\.\d+\.\d+$/);
    }
  });

  it.each([
    ["claude-code", "claude"],
    ["codex", "codex"],
  ] as const)("extends the E2B official %s template", async (agent, base) => {
    const json = JSON.parse(await Template.toJSON(e2bCodingAgentTemplate(agent)));
    expect(json.fromTemplate).toBe(base);
    expect(E2B_OFFICIAL_AGENT_TEMPLATES[agent]).toBe(base);
    expect(publicTemplates[agent]).toContain(`/niceeval-${agent}`);
    expect(JSON.stringify(json)).toContain(
      agent === "claude-code" ? "claude.ai/install.sh" : "npm install -g",
    );
  });

  it("builds Bub from the pinned NiceEval recipe and writes its marker", async () => {
    const json = await Template.toJSON(e2bCodingAgentTemplate("bub", {
      bubPythonPackages: ["bub-plugin-memory==1.3.0"],
    }));
    expect(json).toContain("86fbd0febc1665353f5131173554e1f513e66b4c");
    expect(json).toContain("add4a6a133c5658aec8f167ef50804d9ee55d22e");
    expect(json).toContain("bub-install-hash");
    expect(json).toContain("bub-plugin-memory==1.3.0");
  });
});
