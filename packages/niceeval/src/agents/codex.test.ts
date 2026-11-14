import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { codexAgent } from "./codex.ts";
import { registerSandboxCapabilities } from "../sandbox/backend.ts";
import type { CommandOptions, Sandbox } from "../types.ts";

describe("codexAgent headers and Cloudflare Access support", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CF_ACCESS_CLIENT_ID;
    delete process.env.CF_ACCESS_CLIENT_SECRET;
    delete process.env.CODEX_API_KEY;
    delete process.env.CODEX_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  function createMockSandbox() {
    const shellCalls: { script: string; options?: CommandOptions }[] = [];
    const sandbox = {
      sandboxId: "mock-sb",
      workdir: "/workspace",
      runShell: vi.fn(async (script: string, options?: CommandOptions) => {
        shellCalls.push({ script, options });
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
      runCommand: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    } as unknown as Sandbox;

    registerSandboxCapabilities(sandbox, {
      rootCommands: { _tag: "Unsupported", reason: "test" },
      appendLog: { _tag: "Unsupported", reason: "test" },
      suspend: { _tag: "Unsupported", reason: "test" },
      ensureLifetime: { _tag: "Unsupported", reason: "test" },
      setCommandDeadline: { _tag: "Unsupported", reason: "test" },
      managedProcess: { _tag: "Supported", value: vi.fn() as never },
    });

    return { sandbox, shellCalls };
  }

  const mockCtx = {
    model: "gpt-5.4",
    signal: new AbortController().signal,
  } as never;

  test("does not generate model_providers.s2a when baseUrl is absent", async () => {
    const { sandbox, shellCalls } = createMockSandbox();
    const agent = codexAgent();

    await (agent as { before: (sb: Sandbox, ctx: unknown) => Promise<void> }).before(sandbox, mockCtx);

    expect(shellCalls.length).toBeGreaterThanOrEqual(1);
    const configFileCall = shellCalls[0]!;
    expect(configFileCall.script).toContain('model = "gpt-5.4"');
    expect(configFileCall.script).not.toContain("[model_providers.s2a]");
  });

  test("generates model_providers.s2a with http_headers and redacts sensitive values", async () => {
    const { sandbox, shellCalls } = createMockSandbox();
    const agent = codexAgent({
      baseUrl: "https://s2a.example.com/v1",
      headers: {
        "X-Custom-Token": "secret-token-123",
        "X-Organization": "org-456",
      },
    });

    await (agent as { before: (sb: Sandbox, ctx: unknown) => Promise<void> }).before(sandbox, mockCtx);

    const configFileCall = shellCalls[0]!;
    expect(configFileCall.script).toContain("[model_providers.s2a]");
    expect(configFileCall.script).toContain('base_url = "https://s2a.example.com/v1"');
    expect(configFileCall.script).toContain("[model_providers.s2a.http_headers]");
    expect(configFileCall.script).toContain('"X-Custom-Token" = "secret-token-123"');
    expect(configFileCall.script).toContain('"X-Organization" = "org-456"');
    expect(configFileCall.script).not.toContain("[model_providers.s2a.env_http_headers]");

    // Sensitive values check
    const sensitive = configFileCall.options?.sensitiveValues ?? [];
    expect(sensitive).toContain("https://s2a.example.com/v1");
    expect(sensitive).toContain("secret-token-123");
    expect(sensitive).toContain("org-456");
  });

  test("generates env_http_headers when CF Access env vars exist and not specified in headers", async () => {
    process.env.CF_ACCESS_CLIENT_ID = "cf-id-xyz";
    process.env.CF_ACCESS_CLIENT_SECRET = "cf-secret-xyz";

    const { sandbox, shellCalls } = createMockSandbox();
    const agent = codexAgent({
      baseUrl: "https://s2a.example.com/v1",
      headers: {
        "X-Trace": "trace-123",
      },
    });

    await (agent as { before: (sb: Sandbox, ctx: unknown) => Promise<void> }).before(sandbox, mockCtx);

    const configFileCall = shellCalls[0]!;
    expect(configFileCall.script).toContain("[model_providers.s2a]");
    expect(configFileCall.script).toContain("[model_providers.s2a.http_headers]");
    expect(configFileCall.script).toContain('"X-Trace" = "trace-123"');
    expect(configFileCall.script).toContain("[model_providers.s2a.env_http_headers]");
    expect(configFileCall.script).toContain('"CF-Access-Client-Id" = "CF_ACCESS_CLIENT_ID"');
    expect(configFileCall.script).toContain('"CF-Access-Client-Secret" = "CF_ACCESS_CLIENT_SECRET"');

    // Both headers and CF access secrets are added to sensitiveValues
    const sensitive = configFileCall.options?.sensitiveValues ?? [];
    expect(sensitive).toContain("trace-123");
    expect(sensitive).toContain("cf-id-xyz");
    expect(sensitive).toContain("cf-secret-xyz");
  });

  test("does not generate env_http_headers if CF headers are explicitly provided", async () => {
    process.env.CF_ACCESS_CLIENT_ID = "cf-id-xyz";
    process.env.CF_ACCESS_CLIENT_SECRET = "cf-secret-xyz";

    const { sandbox, shellCalls } = createMockSandbox();
    const agent = codexAgent({
      baseUrl: "https://s2a.example.com/v1",
      headers: {
        "CF-Access-Client-Id": "custom-cf-id",
        "cf-access-client-secret": "custom-cf-secret",
      },
    });

    await (agent as { before: (sb: Sandbox, ctx: unknown) => Promise<void> }).before(sandbox, mockCtx);

    const configFileCall = shellCalls[0]!;
    expect(configFileCall.script).toContain("[model_providers.s2a.http_headers]");
    expect(configFileCall.script).toContain('"CF-Access-Client-Id" = "custom-cf-id"');
    expect(configFileCall.script).toContain('"cf-access-client-secret" = "custom-cf-secret"');
    expect(configFileCall.script).not.toContain("[model_providers.s2a.env_http_headers]");

    const sensitive = configFileCall.options?.sensitiveValues ?? [];
    expect(sensitive).toContain("custom-cf-id");
    expect(sensitive).toContain("custom-cf-secret");
  });
});
