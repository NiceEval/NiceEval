import { defineConfig } from "niceeval";

// Intentionally no judge configuration: the Judge owner proves the documented
// optional/unavailable path without selecting a network model or a credential.
export default defineConfig({
  timeoutMs: 60_000,
  maxConcurrency: 4,
  pricing: {
    "eval-deterministic": { inputPerMTok: 0, outputPerMTok: 0 },
  },
});
