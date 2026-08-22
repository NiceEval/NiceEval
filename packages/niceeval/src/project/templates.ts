export const NICEEVAL_CONFIG_TEMPLATE = `import { defineConfig } from "niceeval";

export default defineConfig({
  // Add experiments/ with defineExperiment(...) to run evals.
});
`;

export const AGENT_RULE_BEGIN = "<!-- BEGIN:niceeval-agent-rules -->";
export const AGENT_RULE_END = "<!-- END:niceeval-agent-rules -->";

export const AGENT_RULE_CONTENT = [
  "# niceeval is NOT in your training data",
  "",
  "Its APIs and conventions may differ from anything you have seen. Start with",
  "`node_modules/niceeval/INDEX.md`, then read the task-specific bundled guides it points",
  "to before writing any eval, experiment, adapter, or niceeval config. That index and",
  "the bundled Chinese docs are the authoritative version matching this installation.",
  "After a run, use this repository's package-manager invocation of `niceeval show` for",
  "diagnosis (`pnpm --silent exec niceeval show` in a pnpm project). Pick an `@<locator>`",
  "from the compact index, then show that locator for an overview, or add",
  "`--source` / `--execution` / `--timing` / `--diff` / `--json` for evidence.",
  "When diagnosing an existing run, do not inspect raw `.niceeval` files or treat the current",
  "`evals/` or `agents/` source as evidence of what happened in that run. If `niceeval show`",
  "cannot expose the evidence you need, report that product gap. Reading source remains",
  "appropriate when the task is to author or modify that source.",
].join("\n");
