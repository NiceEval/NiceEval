import { defineExperiment } from "niceeval";
import agent from "../agents/codex-configfile.ts";

export default defineExperiment({
  description: "codex-cli configFile 闭环:web_search = \"disabled\" 生效后调不到 web_search(反例)",
  agent,
  model: "gpt-5.4-mini",
  evals: ["configfile"],
  runs: 2,
  earlyExit: true,
  budget: 3,
});
