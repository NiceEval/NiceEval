import { Data, Schema } from "effect";
import { normalizeExternalCause, type ExternalCause } from "../../shared/external-cause.ts";

const ErrorFields = Schema.Struct({
  status: Schema.optionalKey(Schema.Unknown),
  code: Schema.optionalKey(Schema.Unknown),
  requestId: Schema.optionalKey(Schema.Unknown),
  retryable: Schema.optionalKey(Schema.Unknown),
  retryAfterSeconds: Schema.optionalKey(Schema.Unknown),
  reason: Schema.optionalKey(Schema.Unknown),
  message: Schema.optionalKey(Schema.Unknown),
});
const ApiError = Schema.Struct({ error: ErrorFields });
const decodeApiError = Schema.decodeUnknownSync(ApiError);
const rateLimitReasons = ["creates_per_day", "starts_per_day", "starts_per_hour", "starts_per_minute"] as const;
type RateLimitReason = (typeof rateLimitReasons)[number];

export interface InstaboxErrorDetail {
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryable?: boolean;
  readonly retryAfterSeconds?: number;
  readonly retryDelaySeconds?: number;
  readonly reason?: RateLimitReason;
  readonly message?: string;
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

export const Operation = Schema.Struct({
  id: Schema.String,
  machineId: Schema.String,
  state: Schema.Literals(["queued", "running", "succeeded", "failed"]),
  error: Schema.NullOr(ErrorFields),
});
export type Operation = Schema.Schema.Type<typeof Operation>;
const PositiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
export const Snapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["pending", "ready", "failed"]),
  sizeLocked: Schema.optionalKey(Schema.Boolean),
  defaultSpec: Schema.optionalKey(Schema.Struct({ vcpus: PositiveInteger, memMiB: PositiveInteger })),
});
export const Machine = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  operationId: Schema.NullOr(Schema.String),
  runtime: Schema.Struct({ ready: Schema.Boolean, hostUnreachable: Schema.optionalKey(Schema.Boolean) }),
  lastError: Schema.optionalKey(Schema.NullOr(ErrorFields)),
});
export const SSHToken = Schema.Struct({
  id: Schema.String,
  machineId: Schema.String,
  token: Schema.String,
  host: Schema.String,
  port: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65535 })),
  hostKeyFingerprint: Schema.String.check(Schema.isPattern(/^SHA256:[A-Za-z0-9+/]+={0,2}$/)),
});
export type SSHToken = Schema.Schema.Type<typeof SSHToken>;
export type InstaboxApiFailure =
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "OperationConflict" }
  | { readonly _tag: "RequestRejected" }
  | { readonly _tag: "ServiceUnavailable" };

function apiFailure(status: number, code: string): InstaboxApiFailure {
  if (status === 404) return { _tag: "NotFound" };
  if (code === "operation_conflict") return { _tag: "OperationConflict" };
  if (status < 500) return { _tag: "RequestRejected" };
  return { _tag: "ServiceUnavailable" };
}

export class InstaboxApiError extends Data.TaggedError("InstaboxApiError")<{
  readonly reason: InstaboxApiFailure;
  readonly detail: InstaboxErrorDetail;
}> {
  readonly status: number;
  readonly code: string;
  constructor(status: number, detail: InstaboxErrorDetail) {
    const code = detail.code ?? "invalid-error-response";
    super({ reason: apiFailure(status, code), detail });
    this.status = status;
    this.code = code;
    this.message = `Instabox API failed: HTTP ${status} (${code})`;
    this.name = "InstaboxApiError";
  }
}

export class InstaboxProtocolError extends Data.TaggedError("InstaboxProtocolError")<{}> {
  constructor() {
    super();
    this.name = "Error";
    this.message = "Instabox returned an invalid protocol response";
  }
}

export class InstaboxTransportError extends Data.TaggedError("InstaboxTransportError")<{
  readonly cause: ExternalCause;
}> {
  constructor(cause: ExternalCause) {
    super({ cause });
    this.name = cause._tag === "ThrownValue" ? "Error" : cause.name;
    this.message = cause.message;
  }
}

export type InstaboxRequestError = InstaboxApiError | InstaboxProtocolError | InstaboxTransportError;

/** Only the SDK boundary may accept arbitrary thrown values. */
export function instaboxRequestError(cause: unknown): InstaboxRequestError {
  if (cause instanceof InstaboxApiError) return cause;
  if (cause instanceof InstaboxProtocolError) return cause;
  if (cause instanceof InstaboxTransportError) return cause;
  return new InstaboxTransportError(normalizeExternalCause(cause));
}

export type InstaboxRequestInit = RequestInit & { readonly timeoutMs?: number };

/** Fixed-origin authenticated transport. Only allowlisted error fields can leave the provider. */
export class InstaboxApi {
  private readonly key: string;
  constructor(key: string) {
    this.key = key;
  }

  errorDetail(
    fields: typeof ErrorFields.Type | null | undefined,
    response?: Pick<Response, "status" | "headers">,
  ): InstaboxErrorDetail {
    const code = fields?.code;
    const requestId = fields?.requestId;
    const retryable = fields?.retryable;
    const reason = rateLimitReasons.find((reason) => code === "rate_limited" && fields?.reason === reason);
    const bodyDelay = fields?.retryAfterSeconds;
    const headerDelay = retryAfterSeconds(response?.headers.get("Retry-After") ?? null);
    const seconds =
      typeof bodyDelay === "number" && Number.isSafeInteger(bodyDelay) && bodyDelay >= 0 ? bodyDelay : headerDelay;
    const delay = Math.max(seconds ?? 0, headerDelay ?? 0);
    const reportedStatus = fields?.status;
    const status =
      response?.status ??
      (typeof reportedStatus === "number" &&
      Number.isInteger(reportedStatus) &&
      reportedStatus >= 400 &&
      reportedStatus <= 599
        ? reportedStatus
        : undefined);
    const firstLine =
      typeof fields?.message === "string"
        ? fields.message
            .split(/[\r\n\u0085\u2028\u2029]/, 1)[0]
            ?.replace(/[\p{Cc}\p{Cf}]/gu, "")
            .trim()
        : undefined;
    // Free-form provider messages may contain credential values with no label. Retain only known
    // plain-text phrases and let callers describe every other response using its classification.
    const message =
      firstLine !== undefined &&
      firstLine.length <= 96 &&
      !firstLine.includes(this.key) &&
      /^(?:bad request|forbidden|not found|service unavailable|internal server error|permission denied|(?:snapshot|machine) (?:not found|is not ready)|(?:no|not enough) (?:host |available )?capacity|host (?:is )?unavailable|rate limit(?:ed| exceeded)|too many requests|(?:the )?(?:requested )?spec(?:ification)? is not allowed|(?:the )?operation failed)[.!]?$/i.test(
        firstLine,
      )
        ? firstLine
        : undefined;
    const visibleIdentifier = (value: unknown, pattern: RegExp): value is string =>
      typeof value === "string" &&
      pattern.test(value) &&
      !value.includes(this.key) &&
      !/^(?:bearer|instabox_(?:api|key|token)|ibx_(?:key|token)|sk[-_]|eyJ)/i.test(value);
    return {
      ...(status === undefined ? {} : { status }),
      ...(visibleIdentifier(code, /^[a-z][a-z0-9_-]{0,63}$/) ? { code } : {}),
      ...(visibleIdentifier(requestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/) ? { requestId } : {}),
      ...(typeof retryable === "boolean" ? { retryable } : {}),
      ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
      ...(delay > (seconds ?? 0) ? { retryDelaySeconds: delay } : {}),
      ...(reason === undefined ? {} : { reason }),
      ...(message === undefined ? {} : { message }),
    };
  }

  async request(path: string, init: InstaboxRequestInit = {}): Promise<Response> {
    const timeoutMs = init.timeoutMs ?? 30_000;
    const response = await fetch(`https://api.instabox.sh/v1${path}`, {
      ...init,
      redirect: "error",
      headers: { "Content-Type": "application/json", ...init.headers, "X-API-Key": this.key },
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])]),
    });
    if (!response.ok) {
      let fields: typeof ErrorFields.Type | undefined;
      try {
        fields = decodeApiError(await response.json()).error;
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "TimeoutError") fields = { code: "error-body-timeout" };
      }
      throw new InstaboxApiError(response.status, this.errorDetail(fields, response));
    }
    return response;
  }

  async json<S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    path: string,
    init?: InstaboxRequestInit,
  ): Promise<S["Type"]> {
    const response = await this.request(path, init);
    // Schema errors can include input fragments. Do not leak provider response values.
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      if (cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError")) throw cause;
      // A failed fetch body stream is a transport failure. Syntax and schema
      // errors may contain response data, so neither may escape this boundary.
      if (cause instanceof TypeError) throw new TypeError("fetch failed");
      throw new InstaboxProtocolError();
    }
    try {
      return Schema.decodeUnknownSync(schema)(body);
    } catch {
      throw new InstaboxProtocolError();
    }
  }
}
