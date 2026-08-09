import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  skills: [
    {
      kind: "repo",
      source: "CorrectRoadH/skills",
      ref: "74c5f3cad7e7f2d6d1c35aea79ad2a1a1b5ac54e",
      skills: ["calibre"],
    },
  ],
});

export default defineExperiment({
  description: "codex-cli Repo Skill:从钉定 Git commit 安装 calibre 并按发现指引读取",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["repo-skill"],
  attempts: 1,
  budget: 2,
});
