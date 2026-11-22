import type { ErrorEvent } from "@sentry/nextjs";

const filtered = "[Filtered]";
const credentialName =
  /(?:^|[_-])(?:token|secret|password|passwd|api[_-]?key|signature|sig)$|^(?:code|(?:auth|authorization|oauth)[_-]?code|session(?:[_-]?id)?)$/i;
const credentialHeader = /^(?:authorization|proxy-authorization|cookie|set-cookie)$|token|secret|key|password/i;
const credentialFields = /^(?:authorization|proxy-authorization|cookie|set-cookie)$/i;

export function isRequestAbort(name: string | undefined): boolean {
  return name === "AbortError" || name === "ResponseAborted";
}

function queryKey(raw: string): string {
  try {
    return decodeURIComponent(raw).replace(/\[.*\]$/, "");
  } catch {
    return raw;
  }
}

function isCredentialName(key: string): boolean {
  return credentialName.test(key.replace(/([a-z\d])([A-Z])/g, "$1_$2"));
}

function hasJwtHeader(encoded: string): boolean {
  try {
    const header = atob(encoded.replace(/-/g, "+").replace(/_/g, "/")).trimStart();
    return header.startsWith("{") && typeof JSON.parse(header)?.alg === "string";
  } catch {
    return false;
  }
}

export function filterErrorCredentials(dsn: string) {
  let publicKey = "";
  try {
    publicKey = new URL(dsn).username;
  } catch {
    // A malformed DSN has no public key to match in event text.
  }
  const escapedKey = publicKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dsnKey = publicKey ? new RegExp(`(?<![\\w-])${escapedKey}(?![\\w-])`, "g") : undefined;

  function cleanText(value: string): string {
    const clean = value
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#"'<>\x60\[\]\\]+@/gi, `$1${filtered}@`)
      .replace(/\b(Bearer\s+)(?!\[Filtered\])[^\s"'<>;,\x60)\]}]+/gi, `$1${filtered}`)
      .replace(/\b(?:sk|pk)-[a-z0-9_-]+\b/gi, filtered)
      .replace(/(?<![\w-])([\w-]+)\.[\w-]+\.[\w-]*(?![\w-])/g, (match, header) =>
        hasJwtHeader(header) ? filtered : match,
      )
      .replace(/([?&])([^=&#?\s"'<>\x60]+)=([^&#\s"'<>\x60]*)/g, (match, separator, key) =>
        isCredentialName(queryKey(key)) ? `${separator}${key}=${filtered}` : match,
      );
    return dsnKey ? clean.replace(dsnKey, filtered) : clean;
  }

  function cleanValue(value: unknown, inHeaders = false): unknown {
    if (typeof value === "string") return cleanText(value);
    if (Array.isArray(value)) return value.map((item) => cleanValue(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const field = key.split(".").at(-1) ?? key;
        const headerField = /(?:^|\.)http\.(?:request|response)\.headers?\.(.+)$/i.exec(key)?.[1];
        const sensitive =
          inHeaders || headerField
            ? credentialHeader.test(headerField ?? key)
            : isCredentialName(field) || credentialFields.test(field);
        return [cleanText(key), sensitive ? filtered : cleanValue(item, key.toLowerCase() === "headers")];
      }),
    );
  }

  return (event: ErrorEvent): ErrorEvent => {
    const { data: _body, cookies: _cookies, query_string: query, ...request } = event.request ?? {};
    const { data: _responseBody, body: _bodyField, ...response } = event.contexts?.response ?? {};
    return cleanValue({
      ...event,
      ...(event.request
        ? {
            request: {
              ...request,
              ...(typeof query === "string" ? { query_string: cleanText(`?${query}`).slice(1) } : {}),
            },
          }
        : {}),
      ...(event.contexts?.response ? { contexts: { ...event.contexts, response } } : {}),
    }) as ErrorEvent;
  };
}

export function httpStatus(...values: unknown[]): number | undefined {
  for (const value of values) {
    const status = typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : value;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return undefined;
}

export function errorHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  return httpStatus(statusCode, status);
}
