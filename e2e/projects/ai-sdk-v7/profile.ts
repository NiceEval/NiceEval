import type { AgentProfile } from "../../shared/profile.ts";

// UI Message Stream 协议:裸工具名;协议帧里没有 usage(见 docs/engineering/e2e-ci/README.md 第 2 节)。
export default {
  weatherToolName: "get_weather",
  calcToolName: "calculate",
  searchToolName: "web_search",
  usage: false,
  sandboxTools: false,
} satisfies AgentProfile;
