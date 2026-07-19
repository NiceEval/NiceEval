import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "e2e: ai-sdk（三种接入面 + OTel）", en: "e2e: ai-sdk (three entry points + OTel)" },
  // Multi-turn HITL evals (draft -> approve/deny -> resume) can take a few real model
  // round-trips per attempt; 90s keeps headroom without masking genuine hangs.
  timeoutMs: 90_000,
});
