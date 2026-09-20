const MAX_SUMMARY_LENGTH = 512;
const SECRET_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*([^\s,;]+)/giu;
const BEARER = /\bBearer\s+[^\s,;]+/giu;
const URL_USERINFO = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu;

function ownDataString(value: object, key: string): string | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    return typeof descriptor.value === "string" ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeErrorText(text: string): string {
  const bounded = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .replace(BEARER, "Bearer <redacted>")
    .replace(URL_USERINFO, "$1<redacted>@")
    .replace(SECRET_ASSIGNMENT, "$1=<redacted>")
    .split(/\r?\n/gu)
    .map((line) => line.replace(/[\t ]+/gu, " ").trimEnd())
    .join("\n")
    .trim();
  if (bounded.length <= MAX_SUMMARY_LENGTH) return bounded;
  return `${bounded.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}

/**
 * Convert an untrusted thrown value into a bounded safe summary.
 * This deliberately does not call getters, `toJSON`, `toString`, inspect
 * `cause`, or serialize object graphs.
 */
export function summarizeUnknownError(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "An unexpected non-Error value was thrown.";
  }
  const code = ownDataString(value, "code");
  const message = ownDataString(value, "message");
  if (message !== undefined && message.trim() !== "") {
    const summary = code === undefined || code.trim() === "" || code === message
      ? message
      : `${code}: ${message}`;
    const safe = sanitizeErrorText(summary);
    return safe === "" ? "An unexpected error occurred." : safe;
  }
  const operation = ownDataString(value, "operation");
  const tag = ownDataString(value, "_tag");
  const safeIdentity = [code ?? tag, operation]
    .filter((part): part is string => part !== undefined && part.trim() !== "")
    .map(sanitizeErrorText)
    .join(": ");
  return safeIdentity === "" ? "An unexpected error occurred." : safeIdentity;
}

export function ownErrorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const code = ownDataString(value, "code");
  return code === undefined ? undefined : sanitizeErrorText(code);
}
