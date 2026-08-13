import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  configFile: "configs/no-web-search.toml",
});

export default defineExperiment({
  description: "codex-cli configFile 闭环:web_search = \"disabled\" 生效后调不到 web_search(反例)",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["configfile"],
  attempts: 1,
  budget: 3,
});
