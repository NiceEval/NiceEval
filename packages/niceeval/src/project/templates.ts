export const NICEEVAL_CONFIG_TEMPLATE = `import { defineConfig } from "niceeval";

export default defineConfig({
  // Add experiments/ with defineExperiment(...) to run evals.
});
`;

export const BUNDLED_INDEX_PATH = "node_modules/niceeval/INDEX.md";

export const AGENT_RULE_BEGIN = "<!-- BEGIN:niceeval-agent-rules -->";
export const AGENT_RULE_END = "<!-- END:niceeval-agent-rules -->";

export const AGENT_SKILL_MANAGED = "<!-- managed by `niceeval init`; edits are overwritten -->";

export function agentRuleContent(indexPath: string, command: string): string {
  return [
    "# niceeval is NOT in your training data",
    "",
    `Read \`${indexPath}\` before writing any NiceEval config, eval, experiment or adapter.`,
    "That index and its bundled Chinese pages are authoritative for this installed version; do not fetch another version from the website or GitHub.",
    `Read results only with \`${command} show\` (add \`--json\` for scripts and agents, then follow the returned \`links\`) and \`${command} view\`; do not read files under \`.niceeval/\`.`,
    "If those public commands cannot expose the evidence you need, report the product gap; do not read implementation source to bypass it.",
  ].join("\n");
}

export function agentSkillContent(content: string): string {
  return `---\nname: niceeval\ndescription: Use when writing, running, or diagnosing NiceEval evals, experiments, adapters, or config in this repository, or when reading NiceEval results.\n---\n\n${AGENT_SKILL_MANAGED}\n\n${content}\n`;
}
