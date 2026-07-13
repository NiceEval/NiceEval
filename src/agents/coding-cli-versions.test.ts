import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLAUDE_CODE_CLI_VERSION,
  DEFAULT_CODEX_CLI_VERSION,
} from "./coding-cli-versions.ts";

describe("official coding-agent versions", () => {
  it("keeps the non-TypeScript Docker recipe in sync", async () => {
    const dockerfile = await readFile(new URL("../../sandbox/docker/Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain(`ARG CODEX_VERSION=${DEFAULT_CODEX_CLI_VERSION}`);
    expect(dockerfile).toContain(`ARG CLAUDE_CODE_VERSION=${DEFAULT_CLAUDE_CODE_CLI_VERSION}`);
  });
});
