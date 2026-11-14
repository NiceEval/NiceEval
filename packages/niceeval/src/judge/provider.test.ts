import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  OpenAIProvider,
  OpenRouterProvider,
  TypesafeProvider,
  VercelProvider,
  resolveJudgeProvider,
} from "./provider.ts";
import { requestScoreMatchProvider } from "../assertions/judge.ts";

describe("Judge Provider headers and Cloudflare Access", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CF_ACCESS_CLIENT_ID;
    delete process.env.CF_ACCESS_CLIENT_SECRET;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("context windows are explicit identity inputs and reject invalid or TypeSafe settings", () => {
    const ordinary = resolveJudgeProvider(OpenAIProvider({ model: "gpt-4o", apiKey: "test-key" }));
    expect(ordinary).not.toHaveProperty("contextWindow");
    expect(resolveJudgeProvider(OpenAIProvider({ model: "gpt-4o", apiKey: "test-key", contextWindow: 32768 })).contextWindow).toBe(32768);
    for (const contextWindow of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => OpenAIProvider({ model: "gpt-4o", contextWindow })).toThrow("contextWindow");
    expect(() => TypesafeProvider({ model: "system-one", contextWindow: 32768 } as never)).toThrow("contextWindow");
  });

  describe("exactOptions and headers validation", () => {
    test("rejects non-object headers", () => {
      expect(() =>
        OpenAIProvider({
          model: "gpt-4o",
          apiKey: "test-key",
          headers: "not-an-object" as never,
        }),
      ).toThrow("headers must be an object");

      expect(() =>
        OpenAIProvider({
          model: "gpt-4o",
          apiKey: "test-key",
          headers: ["a", "b"] as never,
        }),
      ).toThrow("headers must be an object");
    });

    test("rejects headers with accessors or non-enumerable properties", () => {
      const accessorHeaders = {};
      Object.defineProperty(accessorHeaders, "X-Custom", {
        get: () => "val",
        enumerable: true,
      });
      expect(() =>
        OpenAIProvider({
          model: "gpt-4o",
          apiKey: "test-key",
          headers: accessorHeaders as never,
        }),
      ).toThrow("must be an enumerable data property");

      const nonEnumerableHeaders = {};
      Object.defineProperty(nonEnumerableHeaders, "X-Custom", {
        value: "val",
        enumerable: false,
      });
      expect(() =>
        OpenAIProvider({
          model: "gpt-4o",
          apiKey: "test-key",
          headers: nonEnumerableHeaders as never,
        }),
      ).toThrow("must be an enumerable data property");
    });

    test("rejects empty or control-character keys", () => {
      expect(() =>
        OpenAIProvider({
          model: "gpt-4o",
          apiKey: "test-key",
          headers: { "   ": "value" },
        }),
      ).toThrow("keys must be non-empty and control-free");

      expect(() =>
        OpenAIProvider({
          model: "gpt-4o",
          apiKey: "test-key",
          headers: { "X-Custom\nHeader": "value" },
        }),
      ).toThrow("keys must be non-empty and control-free");
    });

    test("rejects non-string, empty, or control-character values", () => {
      expect(() =>
        OpenAIProvider({
          model: "gpt-4o",
          apiKey: "test-key",
          headers: { "X-Custom": 123 as never },
        }),
      ).toThrow("must be a non-empty and control-free string");

      expect(() =>
        OpenAIProvider({
          model: "gpt-4o",
          apiKey: "test-key",
          headers: { "X-Custom": "" },
        }),
      ).toThrow("must be a non-empty and control-free string");

      expect(() =>
        OpenAIProvider({
          model: "gpt-4o",
          apiKey: "test-key",
          headers: { "X-Custom": "line1\nline2" },
        }),
      ).toThrow("must be a non-empty and control-free string");
    });
  });

  describe("identity and CF Access auto-detection", () => {
    test("retains valid custom headers in provider identity and freeze", () => {
      const provider = OpenAIProvider({
        model: "gpt-4o",
        apiKey: "test-key",
        headers: {
          "X-Tenant-Id": "tenant-123",
          "X-Custom-Env": "prod",
        },
      });

      const resolved = resolveJudgeProvider(provider);
      expect(resolved.headers).toEqual({
        "X-Tenant-Id": "tenant-123",
        "X-Custom-Env": "prod",
      });
      expect(Object.isFrozen(resolved.headers)).toBe(true);
    });

    test("auto-injects Cloudflare Access headers when env vars exist and not specified", () => {
      process.env.CF_ACCESS_CLIENT_ID = "cf-id-12345";
      process.env.CF_ACCESS_CLIENT_SECRET = "cf-secret-67890";

      const provider = OpenAIProvider({
        model: "gpt-4o",
        apiKey: "test-key",
        headers: {
          "X-Extra": "extra-value",
        },
      });

      const resolved = resolveJudgeProvider(provider);
      expect(resolved.headers).toEqual({
        "X-Extra": "extra-value",
        "CF-Access-Client-Id": "cf-id-12345",
        "CF-Access-Client-Secret": "cf-secret-67890",
      });
    });

    test("auto-injects Cloudflare Access headers when headers option is omitted", () => {
      process.env.CF_ACCESS_CLIENT_ID = "cf-id-12345";
      process.env.CF_ACCESS_CLIENT_SECRET = "cf-secret-67890";

      const provider = TypesafeProvider({
        model: "system-one",
        apiKey: "test-key",
      });

      const resolved = resolveJudgeProvider(provider);
      expect(resolved.headers).toEqual({
        "CF-Access-Client-Id": "cf-id-12345",
        "CF-Access-Client-Secret": "cf-secret-67890",
      });
    });

    test("does not overwrite explicit CF Access headers (case-insensitive check)", () => {
      process.env.CF_ACCESS_CLIENT_ID = "env-id";
      process.env.CF_ACCESS_CLIENT_SECRET = "env-secret";

      const provider = VercelProvider({
        model: "gpt-4o",
        apiKey: "test-key",
        headers: {
          "cf-access-client-id": "explicit-id",
          "CF-Access-Client-Secret": "explicit-secret",
        },
      });

      const resolved = resolveJudgeProvider(provider);
      expect(resolved.headers).toEqual({
        "cf-access-client-id": "explicit-id",
        "CF-Access-Client-Secret": "explicit-secret",
      });
    });

    test("does not auto-inject if only one CF Access env var is present", () => {
      process.env.CF_ACCESS_CLIENT_ID = "only-id";

      const provider = OpenRouterProvider({
        model: "meta-llama/llama-3-70b",
        apiKey: "test-key",
      });

      const resolved = resolveJudgeProvider(provider);
      expect(resolved.headers).toBeUndefined();
    });
  });

  describe("requestScoreMatchProvider merges custom headers into fetch", () => {
    test("passes custom and CF headers in HTTP request", async () => {
      let capturedHeaders: HeadersInit | undefined;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const controller = new AbortController();
      await requestScoreMatchProvider({
        baseUrl: "https://api.openai.com/v1",
        endpoint: "chat/completions",
        apiKey: "sk-mock-key",
        headers: {
          "CF-Access-Client-Id": "cf-id-999",
          "CF-Access-Client-Secret": "cf-secret-999",
          "X-Trace-Id": "trace-abc",
        },
        body: JSON.stringify({ model: "gpt-4o" }),
        maxBytes: 16_384,
        signal: controller.signal,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(capturedHeaders).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer sk-mock-key",
        "CF-Access-Client-Id": "cf-id-999",
        "CF-Access-Client-Secret": "cf-secret-999",
        "X-Trace-Id": "trace-abc",
      });
    });
  });
});
