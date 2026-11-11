import { Schema } from "effect";

export const Operation = Schema.Struct({
  id: Schema.String, machineId: Schema.String,
  state: Schema.Literals(["queued", "running", "succeeded", "failed"]),
  error: Schema.NullOr(Schema.Struct({ code: Schema.String })),
});
export type Operation = Schema.Schema.Type<typeof Operation>;
export const Snapshot = Schema.Struct({ id: Schema.String, status: Schema.Literals(["pending", "ready", "failed"]) });
export const Machine = Schema.Struct({
  id: Schema.String, state: Schema.String,
  operationId: Schema.NullOr(Schema.String),
  runtime: Schema.Struct({ ready: Schema.Boolean }),
});
export const SSHToken = Schema.Struct({
  id: Schema.String, machineId: Schema.String, token: Schema.String,
  host: Schema.String, port: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65535 })),
  hostKeyFingerprint: Schema.String.check(Schema.isPattern(/^SHA256:[A-Za-z0-9+/]+={0,2}$/)),
});
export type SSHToken = Schema.Schema.Type<typeof SSHToken>;
const ApiError = Schema.Struct({ error: Schema.Struct({ code: Schema.String, requestId: Schema.optionalKey(Schema.String) }) });

export class InstaboxApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`Instabox API failed: HTTP ${status} (${code})`);
    this.name = "InstaboxApiError";
  }
}

export type InstaboxRequestInit = RequestInit & { readonly timeoutMs?: number };

/** Fixed-origin authenticated transport. Never includes response text in errors. */
export class InstaboxApi {
  constructor(private readonly key: string) {}

  async request(path: string, init: InstaboxRequestInit = {}): Promise<Response> {
    const timeoutMs = init.timeoutMs ?? 30_000;
    const response = await fetch(`https://api.instabox.sh/v1${path}`, {
      ...init, redirect: "error",
      headers: { "Content-Type": "application/json", ...init.headers, "X-API-Key": this.key },
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])]),
    });
    if (!response.ok) {
      let code = "invalid-error-response";
      try { code = Schema.decodeUnknownSync(ApiError)(await response.json()).error.code; } catch { /* Do not echo raw responses. */ }
      throw new InstaboxApiError(response.status, code);
    }
    return response;
  }

  async json<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, path: string, init?: RequestInit): Promise<S["Type"]> {
    const response = await this.request(path, init);
    // Schema errors can include input fragments. Do not leak provider response values.
    try { return Schema.decodeUnknownSync(schema)(await response.json()); }
    catch { throw new Error("Instabox returned an invalid protocol response"); }
  }

  async wait(operation: Operation, signal: AbortSignal): Promise<void> {
    let current = operation;
    while (current.state === "queued" || current.state === "running") {
      signal.throwIfAborted();
      current = await this.json(Operation, `/operations/${encodeURIComponent(operation.id)}?wait=25s`, { signal });
    }
    if (current.state !== "succeeded") throw new Error(`Instabox operation failed (${current.error?.code ?? "unknown"})`);
  }
}
