import * as Sentry from "@sentry/nextjs";
import {
  privacyTransport,
  installEnvelopePrivacy,
  sentryOptions,
  productionEnabled,
  SITE_SENTRY_DSN,
} from "./lib/sentry";

if (productionEnabled(process.env.NODE_ENV, process.env.VERCEL_ENV) && !Sentry.getClient()) {
  try {
    Sentry.init({
      ...sentryOptions(SITE_SENTRY_DSN, process.env.SENTRY_ENVIRONMENT, process.env.SENTRY_RELEASE),
      transport: privacyTransport(
        (options) =>
          Sentry.createTransport(options, async ({ body }) => {
            const response = await fetch(options.url, {
              method: "POST",
              body: body as BodyInit,
              headers: options.headers,
            });
            return {
              statusCode: response.status,
              headers: {
                "x-sentry-rate-limits": response.headers.get("x-sentry-rate-limits"),
                "retry-after": response.headers.get("retry-after"),
              },
            };
          }),
        SITE_SENTRY_DSN,
        process.env.SENTRY_ENVIRONMENT,
        process.env.SENTRY_RELEASE,
      ),
    });
    installEnvelopePrivacy(Sentry.getClient(), process.env.SENTRY_ENVIRONMENT, process.env.SENTRY_RELEASE);
  } catch {
    /* Monitoring must not prevent serving requests. */
  }
}
