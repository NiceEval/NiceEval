import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  skills: [
    { kind: "local", path: "fixtures/skills/e2e-marker" },
    { kind: "local", path: "fixtures/skills/e2e-checklist" },
    { kind: "local", path: "fixtures/skills/e2e-decoy" },
  ],
});

// 同一个 agent 同时装三个互斥 Skill：两条正向 Eval 各选一个，第三个始终作为反选哨兵；
// 普通对话 Eval 则证明一个都没加载。
export default defineExperiment({
  description: "skill:三个互斥本地 Skill 的正选、反选与零加载契约",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  attempts: 1,
  evals: ["skill-used", "skill-checklist", "skill-unused"],
});
