// Entry point 1/3: uiMessageStreamAgent(options) — no-touch HTTP adapter against a
// running AI SDK `useChat` backend (src/backend/server.ts, started by scripts/e2e.ts).
// Covers SSE reducer + full-history replay + tool-approval rewrite-resend.
import { uiMessageStreamAgent } from "niceeval/adapter";

const BASE_URL = process.env.AI_SDK_URL ?? "http://127.0.0.1:34101";

export default uiMessageStreamAgent({
  name: "ai-sdk-ui-message-stream",
  url: `${BASE_URL}/api/chat`,
});
