import claudeCodeDefault from "./claude-code.ts";
import codexDefault from "./codex.ts";
import bubDefault from "./bub.ts";
import openCodeDefault from "./opencode.ts";
import hermesDefault from "./hermes.ts";
import openClawDefault from "./openclaw.ts";
import type { Agent } from "../types.ts";

export const BUILTIN_AGENTS: readonly Agent[] = [
  claudeCodeDefault,
  codexDefault,
  bubDefault,
  openCodeDefault,
  hermesDefault,
  openClawDefault,
];
