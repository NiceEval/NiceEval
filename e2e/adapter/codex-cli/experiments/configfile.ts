import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

const agent = codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  configFile: "configs/no-web-search.toml",
});

export default defineExperiment({
  description: "codex-cli configFile 闭环:web_search = \"disabled\" 生效后调不到 web_search(反例)",
  agent,
  model: "gpt-5.4-mini",
  evals: ["configfile"],
  attempts: 2,
  earlyExit: true,
  budget: 3,
});
