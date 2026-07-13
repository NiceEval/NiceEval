import { Template } from "e2b";
import { describe, expect, it } from "vitest";
import {
  E2B_OFFICIAL_AGENT_TEMPLATES,
  NICEEVAL_PUBLIC_E2B_TEMPLATES,
  e2bCodingAgentTemplate,
} from "./e2b-agent-template.ts";

describe("e2bCodingAgentTemplate", () => {
  it.each([
    ["claude-code", "claude"],
    ["codex", "codex"],
  ] as const)("extends the E2B official %s template", async (agent, base) => {
    const json = JSON.parse(await Template.toJSON(e2bCodingAgentTemplate(agent)));
    expect(json.fromTemplate).toBe(base);
    expect(E2B_OFFICIAL_AGENT_TEMPLATES[agent]).toBe(base);
    expect(NICEEVAL_PUBLIC_E2B_TEMPLATES[agent]).toContain(`/niceeval-${agent}`);
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
