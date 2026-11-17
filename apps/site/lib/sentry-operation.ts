import * as Sentry from "@sentry/nextjs";
export type SiteOperation = "site.docs.open" | "site.install_guide.copy";
export type SiteOperationContext = { run: <T>(callback: () => T) => T };

// Never return a Promise from the SDK scope callback: browser scopes are a stack.
function runInSpan<T>(span: Sentry.Span, callback: () => T): T {
  let value!: T;
  Sentry.withActiveSpan(span, () => {
    value = callback();
  });
  return value;
}

const operationSpans = new WeakSet<object>();

// After an await, use context.run at the request boundary to retain ownership.
export function siteOperation<T>(name: SiteOperation, callback: (context: SiteOperationContext) => T): T {
  const parent = Sentry.getActiveSpan();
  const topLevel = !parent || !operationSpans.has(parent);
  const started = performance.now();
  const execute = (span: Sentry.Span, manual: boolean): T => {
    const context: SiteOperationContext = { run: (work) => runInSpan(span, work) };
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
          context.run(() => {
            Sentry.metrics.count("app.operation.count", 1, { attributes });
            Sentry.metrics.distribution("app.operation.duration", duration_ms, { unit: "millisecond", attributes });
            if (outcome === "error") Sentry.logger.error("operation.failed", attributes);
          });
        } catch {
          /* Telemetry cannot replace the business result/error. */
        }
      }
      if (manual) span.end();
    };
    const fail = (error: unknown) => {
      const cancelled = error instanceof Error && error.name === "AbortError";
      span.setStatus({ code: 2, message: cancelled ? "cancelled" : "internal_error" });
      finish(cancelled ? "cancelled" : "error");
    };
    try {
      const value = manual ? context.run(() => callback(context)) : callback(context);
      if (value instanceof Promise)
        return value
          .then((result) => {
            finish("success");
            return result;
          })
          .catch((error: unknown) => {
            fail(error);
            throw error;
          }) as T;
      finish("success");
      return value;
    } catch (error) {
      fail(error);
      throw error;
    }
  };
  // Keep the server's async-context provider and its span lifecycle unchanged.
  return typeof window === "undefined"
    ? Sentry.startSpan({ name, op: "ui.action" }, (span) => execute(span, false))
    : execute(Sentry.startInactiveSpan({ name, op: "ui.action" }), true);
}
