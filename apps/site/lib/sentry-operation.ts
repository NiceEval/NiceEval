import * as Sentry from "@sentry/nextjs";
export type SiteOperation = "site.docs.open" | "site.install_guide.copy";
const operationSpans = new WeakSet<object>();

// Sentry owns the span's finally; the original callback result/error is unchanged.
export function siteOperation<T>(name: SiteOperation, callback: () => T): T {
  const parent = Sentry.getActiveSpan();
  const topLevel = !parent || !operationSpans.has(parent);
  const started = performance.now();
  return Sentry.startSpan({ name, op: "ui.action" }, (span) => {
    operationSpans.add(span);
    let finished = false;
    const finish = (outcome: "success" | "error" | "cancelled") => {
      if (finished) return;
      finished = true;
      operationSpans.delete(span);
      span.setAttribute("outcome", outcome);
      // Metrics count logical operations independently of trace sampling, never child stages.
      if (topLevel) {
        try {
          const duration_ms = Math.max(0, performance.now() - started);
          const attributes = { operation: name, outcome, duration_ms };
          Sentry.metrics.count("app.operation.count", 1, { attributes });
          Sentry.metrics.distribution("app.operation.duration", duration_ms, { unit: "millisecond", attributes });
          if (outcome === "error") Sentry.logger.error("operation.failed", attributes);
        } catch {
          /* Telemetry cannot replace the business result/error. */
        }
      }
    };
    try {
      const value = callback();
      if (value instanceof Promise)
        return value
          .then((result) => {
            finish("success");
            return result;
          })
          .catch((error: unknown) => {
            finish(error instanceof Error && error.name === "AbortError" ? "cancelled" : "error");
            span.setStatus({
              code: 2,
              message: error instanceof Error && error.name === "AbortError" ? "cancelled" : "internal_error",
            });
            throw error;
          }) as T;
      finish("success");
      return value;
    } catch (error) {
      finish(error instanceof Error && error.name === "AbortError" ? "cancelled" : "error");
      span.setStatus({
        code: 2,
        message: error instanceof Error && error.name === "AbortError" ? "cancelled" : "internal_error",
      });
      throw error;
    }
  });
}
