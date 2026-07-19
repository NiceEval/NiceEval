// skill 实验专用:同一个 claude-code adapter,只挂一个本地 Skill fixture
// (fixtures/skills/e2e-marker,本仓库自带,不依赖第三方 repo 内容漂移)。触发条件在
// SKILL.md 里写得极窄(要求消息里出现一个不会自然出现的精确短语),装/触发都稳定。
import { claudeCodeAgent } from "niceeval/adapter";

export default claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  skills: [{ kind: "local", path: "fixtures/skills/e2e-marker" }],
});
