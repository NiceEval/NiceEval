import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
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
  description: "repo-skill:从钉定 Git commit 安装 calibre Skill，并由 Claude 原生发现",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  attempts: 1,
  evals: ["repo-skill"],
});
