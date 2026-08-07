function resolveDiagnostic(
  diagnostic: string | (() => string) | undefined,
  fallback: string,
): string {
  if (diagnostic === undefined) {
    return fallback;
  }
  return typeof diagnostic === "function" ? diagnostic() : diagnostic;
}

/**
 * Return the single element matching `predicate`.
 * Throws when zero or more than one elements match.
 */
export function only<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
  diagnostic?: string | (() => string),
): T {
  const matches = values.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(
      resolveDiagnostic(
        diagnostic,
        `expected exactly one match, got ${matches.length}`,
      ),
    );
  }
  return matches[0] as T;
}

/**
 * Narrow `value` to a defined `T`. Throws when value is null or undefined.
 */
export function defined<T>(
  value: T | null | undefined,
  diagnostic?: string | (() => string),
): T {
  if (value === null || value === undefined) {
    throw new Error(
      resolveDiagnostic(diagnostic, "expected a defined value"),
    );
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Poll `probe` until it returns a defined value or `timeoutMs` elapses.
 * Last probe error (if any) is attached as `cause` on timeout.
 */
export async function pollUntil<T>(
  probe: () => Promise<T | undefined>,
  options: { timeoutMs: number; intervalMs: number; label: string },
): Promise<T> {
  const { timeoutMs, intervalMs, label } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(intervalMs, remaining));
  }

  const message = `${label}: timed out after ${timeoutMs}ms`;
  if (lastError !== undefined) {
    throw new Error(message, { cause: lastError });
  }
  throw new Error(message);
}
