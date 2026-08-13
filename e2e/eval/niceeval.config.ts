import { defineConfig } from "niceeval";

// Intentionally no judge configuration: the Judge owner proves the documented
// optional/unavailable path without selecting a network model or a credential.
export default defineConfig({
  locale: "en",
  timeoutMs: 60_000,
  maxConcurrency: 4,
});
