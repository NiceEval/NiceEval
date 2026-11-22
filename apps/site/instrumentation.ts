import * as Sentry from "@sentry/nextjs";
import { errorHttpStatus, isRequestAbort } from "./lib/sentry-error";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

export const onRequestError: typeof Sentry.captureRequestError = (error, request, context) => {
  if (error instanceof Error && isRequestAbort(error.name)) return;
  const status = errorHttpStatus(error);
  if (status !== undefined && status >= 400 && status < 500) return;

  Sentry.withScope((scope) => {
    scope.setTag("route", context.routePath);
    scope.setTag("http.method", request.method);
    if (status !== undefined) scope.setTag("http.status_code", status);
    scope.addEventProcessor((event) => ({
      ...event,
      request: { ...event.request, url: request.path, method: request.method },
    }));
    Sentry.captureRequestError(error, request, context);
  });
};
